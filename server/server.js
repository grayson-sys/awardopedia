// DO PostgreSQL uses a self-signed cert — required for local dev
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0'

import express from 'express'
import pg from 'pg'
import cors from 'cors'
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

app.listen(PORT, () => {
  console.log(`Awardopedia API running on http://localhost:${PORT}`)
})
