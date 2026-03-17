// DO PostgreSQL uses a self-signed cert — required for local dev
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0'

import express from 'express'
import pg from 'pg'
import cors from 'cors'
import Anthropic from '@anthropic-ai/sdk'
import { readFileSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))

// Load .env from project root
const envPath = resolve(__dirname, '../.env')
const envVars = {}
try {
  readFileSync(envPath, 'utf8').split('\n').forEach(line => {
    const trimmed = line.trim()
    if (trimmed && !trimmed.startsWith('#') && trimmed.includes('=')) {
      const [k, ...rest] = trimmed.split('=')
      envVars[k.trim()] = rest.join('=').trim()
    }
  })
} catch (e) {
  console.error('Could not load .env:', e.message)
}

const DATABASE_URL = envVars.DATABASE_URL || process.env.DATABASE_URL
const PORT = envVars.PORT || process.env.PORT || 3001

const anthropic = new Anthropic({ apiKey: envVars.ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY })

const pool = new pg.Pool({
  connectionString: DATABASE_URL,
  ssl: { rejectUnauthorized: false }
})

const app = express()
app.use(cors())
app.use(express.json())

// ─── Health ───────────────────────────────────────────────
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() })
})

// ─── Stats ────────────────────────────────────────────────
app.get('/api/stats', async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT
        (SELECT COUNT(*) FROM contracts) AS total_contracts,
        (SELECT COALESCE(SUM(award_amount), 0) FROM contracts) AS total_obligated,
        (SELECT COUNT(*) FROM opportunities) AS total_opportunities,
        NOW() AS last_updated
    `)
    res.json(rows[0])
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// ─── Contracts ────────────────────────────────────────────
app.get('/api/contracts', async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT
        piid, award_id, description, naics_code, naics_description,
        psc_code, psc_description, llama_summary,
        agency_name, sub_agency_name, office_name, contracting_officer,
        recipient_name, recipient_uei, recipient_city, recipient_state,
        business_size, is_small_business,
        award_amount, base_amount, ceiling_amount, federal_obligation, total_outlayed,
        start_date, end_date,
        (end_date - CURRENT_DATE) AS days_to_expiry,
        fiscal_year, set_aside_type, competition_type, number_of_offers,
        contract_type, award_type, extent_competed,
        usaspending_url, usaspending_alive,
        report_generated, report_generated_at, report_purchase_count,
        data_source, last_synced, created_at
      FROM contracts
      ORDER BY end_date ASC NULLS LAST
    `)
    res.json({ data: rows, meta: { total: rows.length } })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

app.get('/api/contracts/:piid', async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT *,
        (end_date - CURRENT_DATE) AS days_to_expiry
      FROM contracts WHERE piid = $1
    `, [req.params.piid])
    if (!rows.length) return res.status(404).json({ error: 'Not found' })
    res.json(rows[0])
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// ─── Opportunities ────────────────────────────────────────
app.get('/api/opportunities', async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT *,
        (response_deadline - CURRENT_DATE) AS days_to_deadline
      FROM opportunities
      ORDER BY response_deadline ASC NULLS LAST
    `)
    res.json({ data: rows, meta: { total: rows.length } })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

app.get('/api/opportunities/:notice_id', async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT *,
        (response_deadline - CURRENT_DATE) AS days_to_deadline
      FROM opportunities WHERE notice_id = $1
    `, [req.params.notice_id])
    if (!rows.length) return res.status(404).json({ error: 'Not found' })
    res.json(rows[0])
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// ─── Report generation ────────────────────────────────────
// Deterministic XML containers — Claude fills fixed slots, UI always renders same structure
const REPORT_SYSTEM_PROMPT = `You are a senior federal contracting analyst writing a concise, actionable report for a small business owner.

CRITICAL RULES:
- Return ONLY valid XML. No preamble, no explanation outside the tags.
- Every section must be present, even if data is limited.
- Executive summary: exactly 2-3 sentences.
- Recommended action: must start with exactly one of: "BID", "TEAM", or "PASS" — then explain why.
- Be specific: use dollar amounts, agency names, dates from the data provided.
- Do not speculate beyond the data. If data is missing, say "Data not available."
- End every report with the attribution line exactly as shown.`

function buildContractPrompt(c) {
  const days = c.days_to_expiry != null ? `${c.days_to_expiry} days` : 'unknown'
  return `Generate a federal contract report using EXACTLY this XML structure. Fill each section with your analysis. Do not add or remove any XML tags.

<report>
  <executive_summary>2-3 sentences: what this contract is, who has it, and why it matters to a small business owner.</executive_summary>
  <award_details>Key facts: amount, contract type, set-aside, period of performance, place of performance.</award_details>
  <competitive_landscape>Who typically competes for NAICS ${c.naics_code || 'N/A'} work with ${c.agency_name || 'this agency'}. Historical patterns if known.</competitive_landscape>
  <incumbent_analysis>Analysis of ${c.recipient_name || 'the incumbent contractor'} — their size, capabilities, likely strengths in recompete.</incumbent_analysis>
  <recompete_assessment>Contract expires in ${days} (${c.end_date || 'unknown date'}). Likelihood of recompete, typical lead time for this agency, how to position now.</recompete_assessment>
  <recommended_action>Start with BID, TEAM, or PASS. Then explain the specific reasoning in one paragraph based on set-aside type, incumbent strength, and timing.</recommended_action>
  <attribution>Data sourced from USASpending.gov via Awardopedia.com · Analysis powered by Claude · For informational purposes only, not legal or procurement advice.</attribution>
</report>

CONTRACT DATA:
Agency: ${c.agency_name || 'N/A'} / ${c.sub_agency_name || 'N/A'}
Office: ${c.office_name || 'N/A'}
Recipient: ${c.recipient_name || 'N/A'} (UEI: ${c.recipient_uei || 'N/A'})
PIID: ${c.piid}
Description: ${c.description || 'N/A'}
NAICS: ${c.naics_code} — ${c.naics_description || 'N/A'}
PSC: ${c.psc_code || 'N/A'} — ${c.psc_description || 'N/A'}
Award Amount: $${Number(c.award_amount || 0).toLocaleString()}
Contract Type: ${c.contract_type || 'N/A'}
Set-Aside: ${c.set_aside_type || 'None'}
Competition: ${c.extent_competed || 'N/A'}
Offers Received: ${c.number_of_offers ?? 'N/A'}
Start: ${c.start_date || 'N/A'} | End: ${c.end_date || 'N/A'} | Days Remaining: ${days}
Business Size: ${c.business_size || 'N/A'} | Small Business: ${c.is_small_business ? 'Yes' : 'No'}`
}

function parseReportXml(xml) {
  const sections = ['executive_summary','award_details','competitive_landscape',
                    'incumbent_analysis','recompete_assessment','recommended_action','attribution']
  const result = {}
  for (const tag of sections) {
    const match = xml.match(new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`))
    result[tag] = match ? match[1].trim() : null
  }
  return result
}

app.post('/api/reports/generate', async (req, res) => {
  const { piid } = req.body
  if (!piid) return res.status(400).json({ error: 'piid required' })

  try {
    // Fetch contract from DB
    const { rows } = await pool.query(
      'SELECT *, (end_date - CURRENT_DATE) AS days_to_expiry FROM contracts WHERE piid = $1',
      [piid]
    )
    if (!rows.length) return res.status(404).json({ error: 'Contract not found' })
    const contract = rows[0]

    // Check for cached report
    const { rows: cached } = await pool.query(
      `SELECT sections, generated_at, purchase_count FROM reports
       WHERE record_type = 'contract' AND record_id = $1
       AND generated_at > NOW() - INTERVAL '90 days'
       ORDER BY generated_at DESC LIMIT 1`,
      [piid]
    )
    if (cached.length && cached[0].sections) {
      await pool.query(
        `UPDATE reports SET purchase_count = purchase_count + 1, last_purchased = NOW()
         WHERE record_type = 'contract' AND record_id = $1`,
        [piid]
      )
      return res.json({ cached: true, generated_at: cached[0].generated_at, sections: cached[0].sections })
    }

    // Generate with Claude
    const prompt = buildContractPrompt(contract)
    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-5',
      max_tokens: 1500,
      temperature: 0,   // deterministic
      system: REPORT_SYSTEM_PROMPT,
      messages: [{ role: 'user', content: prompt }]
    })

    const rawXml = message.content[0].text
    const sections = parseReportXml(rawXml)

    // Verify all sections present
    const missing = Object.entries(sections).filter(([,v]) => !v).map(([k]) => k)
    if (missing.length > 2) {
      console.error('Report missing sections:', missing)
      console.error('Raw XML:', rawXml.slice(0, 500))
      return res.status(500).json({ error: 'Report generation incomplete', missing })
    }

    // Cache in DB with sections
    await pool.query(
      `INSERT INTO reports (record_type, record_id, sections, generated_at, generation_cost, purchase_count)
       VALUES ('contract', $1, $2, NOW(), 0.02, 1)
       ON CONFLICT DO NOTHING`,
      [piid, JSON.stringify(sections)]
    )
    await pool.query(
      `UPDATE contracts SET report_generated = true, report_generated_at = NOW() WHERE piid = $1`,
      [piid]
    )

    res.json({
      cached: false,
      generated_at: new Date().toISOString(),
      usage: message.usage,
      sections
    })
  } catch (e) {
    console.error('Report error:', e)
    res.status(500).json({ error: e.message })
  }
})

app.listen(PORT, () => {
  console.log(`Awardopedia API running on http://localhost:${PORT}`)
})
