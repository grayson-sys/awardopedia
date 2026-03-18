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

// ─── Report: load cached ──────────────────────────────────
app.get('/api/reports/contract/:piid', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT sections, generated_at, purchase_count FROM reports
       WHERE record_type = 'contract' AND record_id = $1
       AND generated_at > NOW() - INTERVAL '90 days'
       ORDER BY generated_at DESC LIMIT 1`,
      [req.params.piid]
    )
    if (!rows.length || !rows[0].sections) return res.json({ found: false })
    res.json({ found: true, sections: rows[0].sections, generated_at: rows[0].generated_at })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// ─── Report: print view ───────────────────────────────────
app.get('/api/reports/print/:piid', async (req, res) => {
  try {
    const { rows: rpt } = await pool.query(
      `SELECT r.sections, r.generated_at, c.recipient_name, c.agency_name, c.sub_agency_name,
              c.piid, c.award_amount, c.naics_code, c.naics_description,
              c.start_date, c.end_date, c.set_aside_type, c.contract_type, c.description
       FROM reports r
       JOIN contracts c ON c.piid = r.record_id
       WHERE r.record_type = 'contract' AND r.record_id = $1
       AND r.generated_at > NOW() - INTERVAL '90 days'
       ORDER BY r.generated_at DESC LIMIT 1`,
      [req.params.piid]
    )
    if (!rpt.length || !rpt[0].sections) {
      return res.status(404).send('<p>Report not found. Please generate it first.</p>')
    }
    const c = rpt[0]
    const s = c.sections
    const genDate = new Date(c.generated_at).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })

    // Load logo as base64
    const { readFileSync } = await import('fs')
    const { resolve: pathResolve, dirname: pathDirname } = await import('path')
    const { fileURLToPath: fu } = await import('url')
    let logoB64 = ''
    try {
      const logoPath = pathResolve(pathDirname(fu(import.meta.url)), '../assets/logo-horizontal.jpg')
      logoB64 = readFileSync(logoPath).toString('base64')
    } catch (e) { /* logo missing — skip */ }

    const fmt = n => n ? '$' + Number(n).toLocaleString('en-US', { maximumFractionDigits: 0 }) : '—'

    const sectionHtml = (title, body, accent) => body ? `
      <div class="section${accent ? ' accent' : ''}">
        <div class="section-label">${title}</div>
        <div class="section-body">${body.replace(/\n/g, '<br>')}</div>
      </div>` : ''

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Awardopedia Report — ${c.piid}</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: 'Georgia', serif;
    font-size: 11pt;
    color: #1A1A2E;
    background: #fff;
    padding: 0;
  }
  .page {
    max-width: 760px;
    margin: 0 auto;
    padding: 48px 48px 64px;
  }

  /* Header */
  .header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 32px; padding-bottom: 16px; border-bottom: 2px solid #1B3A6B; }
  .logo img { height: 36px; }
  .logo-text { font-family: sans-serif; font-size: 22px; font-weight: 700; color: #1B3A6B; letter-spacing: -0.5px; }
  .logo-text span { color: #D4940A; }
  .header-meta { text-align: right; font-family: sans-serif; font-size: 9pt; color: #6B7280; line-height: 1.5; }
  .header-meta strong { display: block; font-size: 10pt; color: #1A1A2E; }

  /* Summary bar */
  .summary-bar { background: #EEF2F9; border-left: 4px solid #1B3A6B; padding: 12px 16px; margin-bottom: 24px; border-radius: 0 4px 4px 0; }
  .summary-bar h1 { font-family: sans-serif; font-size: 13pt; font-weight: 700; color: #1B3A6B; margin-bottom: 4px; }
  .summary-bar .meta { font-family: sans-serif; font-size: 9pt; color: #6B7280; display: flex; flex-wrap: wrap; gap: 16px; margin-top: 6px; }
  .summary-bar .meta span { white-space: nowrap; }
  .amount { font-family: 'Courier New', monospace; font-weight: 700; font-size: 14pt; color: #1B3A6B; }

  /* Sections */
  .section { margin-bottom: 20px; }
  .section.accent { background: #EEF2F9; border-left: 4px solid #1B3A6B; padding: 12px 16px; border-radius: 0 4px 4px 0; }
  .section-label { font-family: sans-serif; font-size: 8pt; font-weight: 700; text-transform: uppercase; letter-spacing: 0.8px; color: #6B7280; margin-bottom: 6px; }
  .section.accent .section-label { color: #1B3A6B; }
  .section-body { line-height: 1.65; color: #1A1A2E; }

  /* Disclaimer */
  .disclaimer { margin-top: 32px; padding-top: 16px; border-top: 1px solid #E2E4E9; font-family: sans-serif; font-size: 8pt; color: #9CA3AF; line-height: 1.5; }
  .disclaimer strong { color: #6B7280; }

  /* Print */
  @page {
    size: letter;
    margin: 0.65in 0.75in 0.75in;
  }
  @media print {
    html, body { margin: 0; padding: 0; background: #fff; }
    .page { padding: 0; max-width: 100%; }
    .no-print { display: none !important; }
    .print-bar { display: none !important; }
    .section { page-break-inside: avoid; }
    .summary-bar { page-break-inside: avoid; }
    .header { page-break-after: avoid; }
    a { color: inherit; text-decoration: none; }
    /* Suppress browser header/footer chrome */
    @page { margin: 0.65in 0.75in 0.75in; }
  }

  /* Screen only — print button */
  .print-bar {
    background: #1B3A6B;
    color: white;
    padding: 10px 48px;
    display: flex;
    align-items: center;
    gap: 16px;
    font-family: sans-serif;
    font-size: 12px;
  }
  .print-bar button {
    background: #D4940A;
    color: white;
    border: none;
    padding: 7px 18px;
    border-radius: 4px;
    font-size: 12px;
    font-weight: 600;
    cursor: pointer;
  }
  .print-bar button:hover { opacity: 0.85; }
  @media print { .print-bar { display: none; } }
</style>
</head>
<body>

<div class="print-bar no-print">
  <span>Awardopedia Report — ${c.piid}</span>
  <button onclick="window.print()">⬇ Print / Save PDF</button>
</div>

<div class="page">
  <!-- Header -->
  <div class="header">
    <div class="logo">
      ${logoB64
        ? `<img src="data:image/jpeg;base64,${logoB64}" alt="Awardopedia">`
        : `<div class="logo-text">Award<span>opedia</span></div>`}
    </div>
    <div class="header-meta">
      <strong>Contract Intelligence Report</strong>
      Generated ${genDate}<br>
      PIID: ${c.piid}<br>
      Source: USASpending.gov via Awardopedia.com
    </div>
  </div>

  <!-- Summary bar -->
  <div class="summary-bar">
    <h1>${c.recipient_name || '—'} × ${c.agency_name || '—'}</h1>
    <div class="meta">
      <span class="amount">${fmt(c.award_amount)}</span>
      <span>${c.contract_type || '—'}</span>
      <span>${c.set_aside_type || 'No set-aside'}</span>
      <span>NAICS ${c.naics_code || '—'} — ${c.naics_description || ''}</span>
      <span>${c.start_date ? new Date(c.start_date).toLocaleDateString('en-US', {month:'short',year:'numeric'}) : '—'} → ${c.end_date ? new Date(c.end_date).toLocaleDateString('en-US', {month:'short',year:'numeric'}) : '—'}</span>
    </div>
    ${c.description ? `<div style="margin-top:8px;font-size:9pt;color:#374151;font-style:italic;">${c.description}</div>` : ''}
  </div>

  ${sectionHtml('Recommended Action', s.recommended_action, true)}
  ${sectionHtml('Executive Summary', s.executive_summary)}
  ${sectionHtml('Award Details', s.award_details)}
  ${sectionHtml('Competitive Landscape', s.competitive_landscape)}
  ${sectionHtml('Incumbent Analysis', s.incumbent_analysis)}
  ${sectionHtml('Recompete Assessment', s.recompete_assessment)}

  <div class="disclaimer">
    <strong>Data &amp; Methodology:</strong> Factual data sourced from USASpending.gov, the official US federal spending database.
    Market analysis, competitive assessments, and recommendations are AI-generated based on the contract data provided
    and general federal contracting knowledge. These represent informed analysis, not verified competitive intelligence.
    Always verify current solicitation status on SAM.gov.
    <br><br>
    ${s.attribution || 'Analysis powered by Claude · Awardopedia.com · For informational purposes only, not legal or procurement advice.'}
  </div>
</div>

</body>
</html>`

    res.setHeader('Content-Type', 'text/html; charset=utf-8')
    res.send(html)
  } catch (e) {
    console.error('Print error:', e)
    res.status(500).send(`<p>Error: ${e.message}</p>`)
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
- End every report with the attribution line exactly as shown.

SOURCE DISCIPLINE — this is mandatory:
You have two types of knowledge. You must use different language for each.

TYPE 1 — CONTRACT DATA: Facts directly from the record provided (amounts, dates, agency names, NAICS, recipient, set-aside type, description). State these as facts. No hedging.

TYPE 2 — MARKET KNOWLEDGE: General knowledge about federal contracting, agencies, NAICS sectors, small business programs, and competitive dynamics that is NOT in the record provided. You MUST signal these clearly with phrases like:
  "Based on general patterns in this sector..."
  "Agencies like [X] typically..."
  "In the federal contracting market, firms competing for [NAICS] work generally..."
  "This is common practice, though not confirmed for this specific contract..."

NEVER present market knowledge as specific fact about this contract. NEVER invent specific past contract relationships, specific clearances held, or specific personnel without citing the contract data. If you do not know something, say "Not available in the contract record."

Be conservative. A cautious analysis that is 100% defensible is worth more than a confident analysis that overstates what the data shows.`

function buildContractPrompt(c) {
  const days = c.days_to_expiry != null ? `${c.days_to_expiry} days` : 'unknown'
  const bizCats = Array.isArray(c.business_categories)
    ? c.business_categories.join(', ')
    : (c.business_categories ? JSON.stringify(c.business_categories) : 'N/A')

  return `Generate a federal contract report using EXACTLY this XML structure. Fill each section with your analysis. Do not add or remove any XML tags.

<report>
  <executive_summary>2-3 sentences: what this contract is, who has it, and why it matters to a small business owner.</executive_summary>
  <award_details>Key facts from the contract record: amount, contract type, set-aside, solicitation number, period of performance, place of performance, legal basis for competition method.</award_details>
  <competitive_landscape>Who typically competes for NAICS ${c.naics_code || 'N/A'} work with ${c.agency_name || 'this agency'}. Historical patterns if known.</competitive_landscape>
  <incumbent_analysis>Analysis of ${c.recipient_name || 'the incumbent contractor'} — their business categories, location vs. place of performance, capabilities, likely strengths in recompete.</incumbent_analysis>
  <recompete_assessment>Contract expires in ${days} (${c.end_date || 'unknown date'}). Last modified ${c.last_modified_date || 'unknown'}. Likelihood of recompete, typical lead time, how to position now. Include the solicitation number ${c.solicitation_number || 'N/A'} as a SAM.gov search anchor.</recompete_assessment>
  <recommended_action>Start with BID, TEAM, or PASS. Then explain the specific reasoning in one paragraph based on set-aside type, incumbent strength, business categories, and timing.</recommended_action>
  <attribution>Data sourced from USASpending.gov via Awardopedia.com · Analysis powered by Claude · For informational purposes only, not legal or procurement advice.</attribution>
</report>

CONTRACT DATA (verified from USASpending.gov — treat all fields below as [DATA]):
PIID: ${c.piid}
Solicitation Number: ${c.solicitation_number || 'N/A'}
Description: ${c.description || 'N/A'}
Major Program: ${c.major_program || 'N/A'}

AGENCY:
  Awarding: ${c.agency_name || 'N/A'} / ${c.sub_agency_name || 'N/A'}
  Office: ${c.office_name || 'N/A'}
  Funding Office: ${c.funding_office_name || 'N/A'}

WHAT WAS BOUGHT:
  NAICS: ${c.naics_code} — ${c.naics_description || 'N/A'}
  PSC: ${c.psc_code || 'N/A'} — ${c.psc_description || 'N/A'}
  Commercial Item: ${c.commercial_item || 'N/A'}

MONEY & TYPE:
  Award Amount: $${Number(c.award_amount || 0).toLocaleString()}
  Base Amount: $${Number(c.base_amount || 0).toLocaleString()}
  Ceiling: $${Number(c.ceiling_amount || 0).toLocaleString()}
  Contract Type: ${c.contract_type || 'N/A'}
  Pricing Type: ${c.pricing_type || 'N/A'}

HOW IT WAS AWARDED:
  Set-Aside: ${c.set_aside_type || 'None'}
  Competition: ${c.extent_competed || 'N/A'}
  Legal Basis: ${c.sole_source_authority || 'N/A'}
  Solicitation Procedures: ${c.solicitation_procedures || 'N/A'}
  Offers Received: ${c.number_of_offers ?? 'N/A'}
  Subcontracting Plan: ${c.subcontracting_plan || 'N/A'}
  Labor Standards Apply: ${c.labor_standards ? 'Yes' : 'No'}

TIMELINE:
  Signed: ${c.date_signed || 'N/A'}
  Start: ${c.start_date || 'N/A'}
  End: ${c.end_date || 'N/A'}
  Last Modified: ${c.last_modified_date || 'N/A'}
  Days Remaining: ${days}

RECIPIENT (incumbent contractor):
  Name: ${c.recipient_name || 'N/A'}
  UEI: ${c.recipient_uei || 'N/A'}
  Address: ${c.recipient_address || 'N/A'}, ${c.recipient_city || 'N/A'}, ${c.recipient_state || 'N/A'} ${c.recipient_zip || ''}
  County: ${c.recipient_county || 'N/A'} | Congressional District: ${c.recipient_state || ''}-${c.recipient_congressional_district || 'N/A'}
  Business Categories: ${bizCats}

PLACE OF PERFORMANCE (where work happens):
  ${c.pop_city || 'N/A'}, ${c.pop_state || 'N/A'} ${c.pop_zip || ''}
  County: ${c.pop_county || 'N/A'} | Congressional District: ${c.pop_state || ''}-${c.pop_congressional_district || 'N/A'}`
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
      max_tokens: 2500,
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
