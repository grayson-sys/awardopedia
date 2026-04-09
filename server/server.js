// DO PostgreSQL uses a self-signed cert — required for local dev
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0'

import express from 'express'
import pg from 'pg'
import cors from 'cors'
import Anthropic from '@anthropic-ai/sdk'
import Stripe from 'stripe'
import { readFileSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'
import { randomBytes, createHash } from 'crypto'
import securityHeaders from './middleware/securityHeaders.js'
import { apiRateLimit, registerRateLimit, reportRateLimit, getClientIp } from './middleware/rateLimit.js'
import { validateContractsParams, validateOpportunitiesParams } from './middleware/validate.js'
import { logHoneypot, logReportGeneration, logExcessReports } from './middleware/abuseLog.js'

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

const STRIPE_SECRET_KEY = envVars.STRIPE_SECRET_KEY || process.env.STRIPE_SECRET_KEY
const STRIPE_WEBHOOK_SECRET = envVars.STRIPE_WEBHOOK_SECRET || process.env.STRIPE_WEBHOOK_SECRET
const stripe = STRIPE_SECRET_KEY ? new Stripe(STRIPE_SECRET_KEY) : null

const CREDIT_PACKS = {
  starter: { priceId: 'price_1TBNL847350RugxrNcVcMsAT', credits: 100, label: 'Starter — 100 credits', cents: 900 },
  pro:     { priceId: 'price_1TBNL947350RugxrkUlb8rUY', credits: 500, label: 'Pro — 500 credits', cents: 2900 },
  power:   { priceId: 'price_1TBNL947350Rugxr4ilhHzTv', credits: 2000, label: 'Power — 2,000 credits', cents: 7900 },
}

const pool = new pg.Pool({
  connectionString: DATABASE_URL,
  ssl: { rejectUnauthorized: false }
})

const isProd = process.env.NODE_ENV === 'production'

const app = express()
app.disable('x-powered-by')
app.use(securityHeaders)
app.use(cors())

// Stripe webhook needs raw body — must be before express.json()
app.post('/api/stripe/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  if (!stripe) return res.status(503).json({ error: 'Stripe not configured' })

  let event
  try {
    if (STRIPE_WEBHOOK_SECRET) {
      event = stripe.webhooks.constructEvent(req.body, req.headers['stripe-signature'], STRIPE_WEBHOOK_SECRET)
    } else {
      event = JSON.parse(req.body.toString())
    }
  } catch (e) {
    console.error('Stripe webhook signature failed:', e.message)
    return res.status(400).json({ error: 'Webhook signature verification failed' })
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object
    const memberId = session.metadata?.member_id
    const creditsToAdd = parseInt(session.metadata?.credits, 10)

    if (memberId && creditsToAdd) {
      try {
        await pool.query('UPDATE members SET credits = credits + $1 WHERE id = $2', [creditsToAdd, memberId])
        await pool.query(
          `INSERT INTO credit_purchases (member_id, stripe_session_id, credits, amount_cents, pack_name)
           VALUES ($1, $2, $3, $4, $5)`,
          [memberId, session.id, creditsToAdd, session.amount_total, session.metadata?.pack_name || 'unknown']
        )
        console.log(`[STRIPE] Credited ${creditsToAdd} to member ${memberId} (session ${session.id})`)
      } catch (e) {
        console.error('[STRIPE] Failed to credit member:', e.message)
      }
    }
  }

  res.json({ received: true })
})

app.use(express.json())

// ─── Honeypot routes — never linked, only bots hit these ─
const HONEYPOT_PATHS = ['/admin', '/wp-admin', '/phpmyadmin', '/.env', '/.git', '/config', '/backup', '/api/admin']
HONEYPOT_PATHS.forEach(path => {
  app.all(path, (req, res) => {
    logHoneypot(getClientIp(req), req.path)
    res.status(403).json({ error: 'Forbidden' })
  })
})

// ─── Health ───────────────────────────────────────────────
app.get(['/health', '/api/health'], (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() })
})

// ─── LLMs.txt — AI agent discoverability ──────────────────
app.get('/llms.txt', (req, res) => {
  const llmsTxt = readFileSync(resolve(__dirname, '../web/public/llms.txt'), 'utf8')
  res.setHeader('Content-Type', 'text/plain; charset=utf-8')
  res.setHeader('Cache-Control', 'public, max-age=3600')
  res.send(llmsTxt)
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
    res.status(500).json({ error: isProd ? 'Internal server error' : e.message })
  }
})

// ─── Contract Leaderboard ─────────────────────────────────
app.get('/api/leaderboard', async (req, res) => {
  try {
    // Top contractors by total value (trailing 365 days)
    const { rows: topByValue } = await pool.query(`
      SELECT
        recipient_name AS name,
        COUNT(*) AS contract_count,
        SUM(award_amount::numeric) AS total_value
      FROM contracts
      WHERE recipient_name IS NOT NULL
        AND award_amount IS NOT NULL
        AND start_date >= CURRENT_DATE - INTERVAL '365 days'
      GROUP BY recipient_name
      ORDER BY total_value DESC NULLS LAST
      LIMIT 15
    `)

    // Top small businesses by contract count (trailing 365 days)
    // Filter: has "Small Business" in categories but NOT "Not Designated", and under $500M total
    // Note: Fast-growing companies may appear if they won small biz set-asides before outgrowing the threshold
    const { rows: topSmallBusiness } = await pool.query(`
      WITH company_totals AS (
        SELECT
          recipient_name AS name,
          COUNT(*) AS contract_count,
          SUM(award_amount::numeric) AS total_value
        FROM contracts
        WHERE recipient_name IS NOT NULL
          AND award_amount IS NOT NULL
          AND start_date >= CURRENT_DATE - INTERVAL '365 days'
          AND business_categories::text ILIKE '%small business%'
          AND business_categories::text NOT ILIKE '%not designated%'
        GROUP BY recipient_name
      )
      SELECT name, contract_count, total_value
      FROM company_totals
      WHERE total_value < 500000000
      ORDER BY total_value DESC
      LIMIT 15
    `)

    // Defense tech startups (trailing 365 days) - consolidated by base company name
    const { rows: defenseTech } = await pool.query(`
      SELECT
        CASE
          WHEN UPPER(recipient_name) LIKE '%PALANTIR%' THEN 'PALANTIR'
          WHEN UPPER(recipient_name) LIKE '%ANDURIL%' THEN 'ANDURIL'
          WHEN UPPER(recipient_name) LIKE '%SHIELD AI%' THEN 'SHIELD AI'
          WHEN UPPER(recipient_name) LIKE '%SKYDIO%' THEN 'SKYDIO'
          WHEN UPPER(recipient_name) LIKE '%SARONIC%' THEN 'SARONIC'
          WHEN UPPER(recipient_name) LIKE '%EPIRUS%' THEN 'EPIRUS'
          WHEN UPPER(recipient_name) LIKE '%HADRIAN%' THEN 'HADRIAN'
          WHEN UPPER(recipient_name) LIKE '%HERMEUS%' THEN 'HERMEUS'
          WHEN UPPER(recipient_name) LIKE '%REBELLION%' THEN 'REBELLION'
          WHEN UPPER(recipient_name) LIKE '%CHAOS INDUSTRIES%' THEN 'CHAOS'
          ELSE recipient_name
        END AS name,
        COUNT(*) AS contract_count,
        SUM(award_amount::numeric) AS total_value
      FROM contracts
      WHERE (
        UPPER(recipient_name) LIKE '%ANDURIL%'
        OR UPPER(recipient_name) LIKE '%PALANTIR%'
        OR UPPER(recipient_name) LIKE '%SHIELD AI%'
        OR UPPER(recipient_name) LIKE '%SKYDIO%'
        OR UPPER(recipient_name) LIKE '%SARONIC%'
        OR UPPER(recipient_name) LIKE '%EPIRUS%'
        OR UPPER(recipient_name) LIKE '%HADRIAN%'
        OR UPPER(recipient_name) LIKE '%HERMEUS%'
        OR UPPER(recipient_name) LIKE '%REBELLION%'
        OR UPPER(recipient_name) LIKE '%CHAOS INDUSTRIES%'
      )
      AND start_date >= CURRENT_DATE - INTERVAL '365 days'
      GROUP BY 1
      ORDER BY total_value DESC NULLS LAST
    `)

    res.json({
      topByValue: topByValue.map(r => ({
        name: r.name,
        contract_count: parseInt(r.contract_count, 10),
        total_value: parseFloat(r.total_value) || 0
      })),
      topSmallBusiness: topSmallBusiness.map(r => ({
        name: r.name,
        contract_count: parseInt(r.contract_count, 10),
        total_value: parseFloat(r.total_value) || 0
      })),
      defenseTech: defenseTech.map(r => ({
        name: r.name,
        contract_count: parseInt(r.contract_count, 10),
        total_value: parseFloat(r.total_value) || 0
      })),
      period: 'trailing_365_days'
    })
  } catch (e) {
    console.error('[LEADERBOARD] Error:', e.message)
    res.status(500).json({ error: isProd ? 'Internal server error' : e.message })
  }
})

// ─── NAICS search (for profile setup) ─────────────────────
app.get('/api/naics/search', async (req, res) => {
  const { q } = req.query
  if (!q || q.length < 2) return res.json([])
  try {
    const { rows } = await pool.query(`
      SELECT DISTINCT naics_code AS code, naics_description AS description
      FROM opportunities
      WHERE naics_code IS NOT NULL AND naics_description IS NOT NULL
        AND (naics_description ILIKE $1 OR naics_code LIKE $2)
      ORDER BY naics_description
      LIMIT 15
    `, [`%${q}%`, `${q}%`])
    res.json(rows)
  } catch (e) {
    res.json([])
  }
})

// ─── Feedback ─────────────────────────────────────────────
app.post('/api/feedback', express.json(), async (req, res) => {
  const { notice_id, message, email } = req.body
  if (!message) return res.status(400).json({ error: 'message required' })
  console.log(`[FEEDBACK] notice=${notice_id || 'general'} email=${email || 'none'} message=${message.slice(0, 200)}`)
  // Store in a simple log file for now
  const fs = await import('fs')
  const line = JSON.stringify({ ts: new Date().toISOString(), notice_id, email, message }) + '\n'
  fs.appendFileSync('logs/feedback.log', line)
  res.json({ ok: true })
})

// ─── Admin endpoints ──────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════
// AUTH + MEMBERSHIP
// ═══════════════════════════════════════════════════════════════════

const JWT_SECRET = envVars.JWT_SECRET || process.env.JWT_SECRET || 'dev-secret-change-in-prod'
const CREDITS_PER_REPORT = 1
const REPORT_PRICE_CENTS = 500  // $5 per report
const MIN_CREDIT_BUY = 4        // $20 minimum = 4 credits

function hashPassword(pw) { return createHash('sha256').update(pw + JWT_SECRET).digest('hex') }

function createToken(member) {
  const payload = { id: member.id, email: member.email, role: member.role }
  // Simple JWT: base64(header).base64(payload).signature
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url')
  const body = Buffer.from(JSON.stringify({ ...payload, exp: Date.now() + 30 * 86400000 })).toString('base64url')
  const sig = createHash('sha256').update(`${header}.${body}.${JWT_SECRET}`).digest('base64url')
  return `${header}.${body}.${sig}`
}

function verifyToken(token) {
  if (!token) return null
  try {
    const [header, body, sig] = token.split('.')
    const expected = createHash('sha256').update(`${header}.${body}.${JWT_SECRET}`).digest('base64url')
    if (sig !== expected) return null
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString())
    if (payload.exp < Date.now()) return null
    return payload
  } catch { return null }
}

function authMiddleware(req, res, next) {
  const token = req.headers.authorization?.replace('Bearer ', '') || req.cookies?.token
  const user = verifyToken(token)
  if (!user) return res.status(401).json({ error: 'Login required' })
  req.user = user
  next()
}

function optionalAuth(req, res, next) {
  const token = req.headers.authorization?.replace('Bearer ', '') || req.cookies?.token
  req.user = verifyToken(token)
  next()
}

// ─── CAPTCHA verification (Cloudflare Turnstile) ─────────
const TURNSTILE_SECRET = envVars.TURNSTILE_SECRET_KEY || process.env.TURNSTILE_SECRET_KEY
async function verifyTurnstile(token, ip) {
  if (!TURNSTILE_SECRET) {
    // Skip verification in dev if not configured
    console.log('[CAPTCHA] Turnstile not configured, skipping verification')
    return true
  }
  try {
    const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ secret: TURNSTILE_SECRET, response: token, remoteip: ip })
    })
    const data = await res.json()
    return data.success === true
  } catch (e) {
    console.error('[CAPTCHA] Turnstile verification failed:', e.message)
    return false
  }
}

// ─── Register ─────────────────────────────────────────────
app.post('/api/auth/register', express.json(), async (req, res) => {
  const { email, password, first_name, last_name, profession, company_name, company_size, company_state, company_naics, captcha_token } = req.body
  if (!email || !password) return res.status(400).json({ error: 'Email and password required' })
  if (password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' })

  // Verify CAPTCHA (required in production)
  if (TURNSTILE_SECRET && !captcha_token) {
    return res.status(400).json({ error: 'CAPTCHA verification required' })
  }
  if (captcha_token) {
    const captchaValid = await verifyTurnstile(captcha_token, getClientIp(req))
    if (!captchaValid) {
      return res.status(400).json({ error: 'CAPTCHA verification failed. Please try again.' })
    }
  }

  try {
    const hash = hashPassword(password)
    const { rows } = await pool.query(
      `INSERT INTO members (email, password_hash, first_name, last_name, profession, company_name, company_size, company_state, company_naics, captcha_verified)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING id, email, role, credits, first_name`,
      [email.toLowerCase().trim(), hash, first_name, last_name, profession, company_name, company_size, company_state, company_naics, !!captcha_token]
    )
    const member = rows[0]
    const token = createToken(member)
    res.json({ token, member: { id: member.id, email: member.email, first_name: member.first_name, credits: member.credits, role: member.role } })
  } catch (e) {
    if (e.code === '23505') return res.status(409).json({ error: 'Email already registered' })
    res.status(500).json({ error: e.message })
  }
})

// ─── Login ────────────────────────────────────────────────
app.post('/api/auth/login', express.json(), async (req, res) => {
  const { email, password } = req.body
  if (!email || !password) return res.status(400).json({ error: 'Email and password required' })

  try {
    const hash = hashPassword(password)
    const { rows } = await pool.query(
      'SELECT id, email, role, credits, first_name, last_name FROM members WHERE email = $1 AND password_hash = $2 AND is_active = true',
      [email.toLowerCase().trim(), hash]
    )
    if (!rows.length) return res.status(401).json({ error: 'Invalid email or password' })
    const member = rows[0]
    await pool.query('UPDATE members SET last_login = NOW() WHERE id = $1', [member.id])
    const token = createToken(member)
    res.json({ token, member: { id: member.id, email: member.email, first_name: member.first_name, credits: member.credits, role: member.role } })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// ─── Forgot password ──────────────────────────────────────
app.post('/api/auth/forgot-password', express.json(), async (req, res) => {
  const { email } = req.body
  if (!email) return res.status(400).json({ error: 'Email required' })

  try {
    const { rows } = await pool.query(
      'SELECT id, email, first_name FROM members WHERE email = $1 AND is_active = true',
      [email.toLowerCase().trim()]
    )
    // Always return success to avoid email enumeration
    if (!rows.length) return res.json({ success: true })

    const member = rows[0]
    // Generate reset token (for link) and short code (for manual entry)
    const resetToken = randomBytes(16).toString('hex')
    const resetCode = String(Math.floor(100000 + Math.random() * 900000)) // 6-digit code
    const expiry = new Date(Date.now() + 60 * 60 * 1000) // 1 hour

    await pool.query(
      'UPDATE members SET password_reset_token = $1, password_reset_code = $2, password_reset_expires = $3 WHERE id = $4',
      [resetToken, resetCode, expiry, member.id]
    )

    // TODO: Send email with reset link and code
    // For now, log it (check server logs to get reset links)
    console.log(`[PASSWORD RESET] ${member.email} → token: ${resetToken}, code: ${resetCode}`)
    console.log(`[PASSWORD RESET] Link: https://awardopedia.com/reset-password?token=${resetToken}`)

    res.json({ success: true, code: resetCode })
  } catch (e) {
    console.error('Forgot password error:', e)
    res.status(500).json({ error: 'Failed to process request' })
  }
})

// ─── Reset password with code ─────────────────────────────
app.post('/api/auth/reset-password', express.json(), async (req, res) => {
  const { code, password } = req.body
  if (!code || !password) return res.status(400).json({ error: 'Code and password required' })
  if (password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' })

  try {
    const { rows } = await pool.query(
      'SELECT id, email FROM members WHERE password_reset_code = $1 AND password_reset_expires > NOW() AND is_active = true',
      [code]
    )
    if (!rows.length) return res.status(400).json({ error: 'Invalid or expired code' })

    const member = rows[0]
    const hash = hashPassword(password)

    await pool.query(
      'UPDATE members SET password_hash = $1, password_reset_token = NULL, password_reset_code = NULL, password_reset_expires = NULL WHERE id = $2',
      [hash, member.id]
    )

    console.log(`[PASSWORD RESET] Complete for ${member.email}`)
    res.json({ success: true })
  } catch (e) {
    console.error('Reset password error:', e)
    res.status(500).json({ error: 'Failed to reset password' })
  }
})

// ─── Get current user ─────────────────────────────────────
app.get('/api/auth/me', authMiddleware, async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT id, email, first_name, last_name, profession, company_name, company_size, company_state, company_naics, credits, role, alerts_enabled, alert_naics, alert_states, alert_set_asides, alert_keywords FROM members WHERE id = $1',
      [req.user.id]
    )
    if (!rows.length) return res.status(404).json({ error: 'User not found' })
    res.json(rows[0])
  } catch (e) { res.status(500).json({ error: e.message }) }
})

// ─── Update profile / alert preferences ───────────────────
app.put('/api/auth/profile', authMiddleware, express.json(), async (req, res) => {
  const allowed = ['first_name', 'last_name', 'profession', 'company_name', 'company_size', 'company_state', 'company_naics',
                    'alert_naics', 'alert_states', 'alert_set_asides', 'alert_keywords', 'alert_min_value', 'alert_max_value', 'alerts_enabled']
  const updates = []
  const values = []
  let idx = 1
  for (const key of allowed) {
    if (req.body[key] !== undefined) {
      updates.push(`${key} = $${idx}`)
      values.push(typeof req.body[key] === 'object' ? JSON.stringify(req.body[key]) : req.body[key])
      idx++
    }
  }
  if (!updates.length) return res.status(400).json({ error: 'No fields to update' })
  values.push(req.user.id)
  try {
    await pool.query(`UPDATE members SET ${updates.join(', ')}, updated_at = NOW() WHERE id = $${idx}`, values)
    res.json({ ok: true })
  } catch (e) { res.status(500).json({ error: e.message }) }
})

// ─── Watchlist ────────────────────────────────────────────
app.get('/api/watchlist', authMiddleware, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT w.*, o.title, o.agency_name, o.response_deadline, o.set_aside_type, o.naics_code, o.naics_description
       FROM watchlist w JOIN opportunities o ON w.notice_id = o.notice_id
       WHERE w.member_id = $1 ORDER BY w.added_at DESC`,
      [req.user.id]
    )
    res.json(rows)
  } catch (e) { res.json([]) }
})

app.post('/api/watchlist', authMiddleware, express.json(), async (req, res) => {
  const { notice_id, notes } = req.body
  if (!notice_id) return res.status(400).json({ error: 'notice_id required' })
  try {
    await pool.query(
      'INSERT INTO watchlist (member_id, notice_id, notes) VALUES ($1, $2, $3) ON CONFLICT (member_id, notice_id) DO UPDATE SET notes = EXCLUDED.notes',
      [req.user.id, notice_id, notes || null]
    )
    res.json({ ok: true })
  } catch (e) { res.status(500).json({ error: e.message }) }
})

app.delete('/api/watchlist/:notice_id', authMiddleware, async (req, res) => {
  try {
    await pool.query('DELETE FROM watchlist WHERE member_id = $1 AND notice_id = $2', [req.user.id, req.params.notice_id])
    res.json({ ok: true })
  } catch (e) { res.status(500).json({ error: e.message }) }
})

// ─── Watch contracts for recompete ───────────────────────────────
app.post('/api/watch', authMiddleware, express.json(), async (req, res) => {
  const { piid, action, notes } = req.body
  if (!piid) return res.status(400).json({ error: 'piid required' })
  try {
    if (action === 'unwatch') {
      await pool.query('DELETE FROM watched_contracts WHERE user_id = $1 AND piid = $2', [req.user.id, piid])
    } else {
      await pool.query(
        `INSERT INTO watched_contracts (user_id, piid, notes) VALUES ($1, $2, $3)
         ON CONFLICT (user_id, piid) DO UPDATE SET notes = EXCLUDED.notes`,
        [req.user.id, piid, notes || null]
      )
    }
    res.json({ ok: true, watching: action !== 'unwatch' })
  } catch (e) { res.status(500).json({ error: e.message }) }
})

app.get('/api/watched-contracts', authMiddleware, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT w.*, c.recipient_name, c.agency_name, c.award_amount, c.end_date,
              (c.end_date - CURRENT_DATE) AS days_until_expiry
       FROM watched_contracts w
       JOIN contracts c ON w.piid = c.piid
       WHERE w.user_id = $1
       ORDER BY c.end_date ASC`,
      [req.user.id]
    )
    res.json(rows)
  } catch (e) { res.json([]) }
})

// ═══════════════════════════════════════════════════════════════════
// SAVED OPPORTUNITIES + LISTS
// Organize opportunities into custom lists with status tracking
// ═══════════════════════════════════════════════════════════════════

// ─── Get user's lists ───────────────────────────────────────
app.get('/api/lists', authMiddleware, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT l.*, COUNT(s.id) AS opportunity_count
       FROM opportunity_lists l
       LEFT JOIN saved_opportunities s ON l.id = s.list_id
       WHERE l.member_id = $1
       GROUP BY l.id
       ORDER BY l.is_default DESC, l.sort_order, l.name`,
      [req.user.id]
    )
    res.json(rows)
  } catch (e) { res.status(500).json({ error: e.message }) }
})

// ─── Create a list ───────────────────────────────────────────
app.post('/api/lists', authMiddleware, express.json(), async (req, res) => {
  const { name, color, icon } = req.body
  if (!name) return res.status(400).json({ error: 'name required' })
  try {
    const { rows } = await pool.query(
      `INSERT INTO opportunity_lists (member_id, name, color, icon)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [req.user.id, name.trim(), color || '#1B3A6B', icon || 'folder']
    )
    res.json(rows[0])
  } catch (e) {
    if (e.code === '23505') return res.status(409).json({ error: 'List name already exists' })
    res.status(500).json({ error: e.message })
  }
})

// ─── Update a list ───────────────────────────────────────────
app.put('/api/lists/:id', authMiddleware, express.json(), async (req, res) => {
  const { name, color, icon, sort_order } = req.body
  try {
    const { rows } = await pool.query(
      `UPDATE opportunity_lists SET name = COALESCE($1, name), color = COALESCE($2, color),
       icon = COALESCE($3, icon), sort_order = COALESCE($4, sort_order)
       WHERE id = $5 AND member_id = $6 RETURNING *`,
      [name, color, icon, sort_order, req.params.id, req.user.id]
    )
    if (!rows.length) return res.status(404).json({ error: 'List not found' })
    res.json(rows[0])
  } catch (e) { res.status(500).json({ error: e.message }) }
})

// ─── Delete a list ───────────────────────────────────────────
app.delete('/api/lists/:id', authMiddleware, async (req, res) => {
  try {
    const { rows } = await pool.query(
      'DELETE FROM opportunity_lists WHERE id = $1 AND member_id = $2 AND is_default = false RETURNING id',
      [req.params.id, req.user.id]
    )
    if (!rows.length) return res.status(404).json({ error: 'Cannot delete default list' })
    res.json({ ok: true })
  } catch (e) { res.status(500).json({ error: e.message }) }
})

// ─── Get saved opportunities (all or by list) ────────────────
app.get('/api/saved', authMiddleware, async (req, res) => {
  const { list_id, status } = req.query
  try {
    let query = `
      SELECT s.*, l.name AS list_name, l.color AS list_color,
             o.title, o.agency_name, o.response_deadline, o.set_aside_type,
             o.naics_code, o.naics_description, o.llama_summary,
             o.place_of_performance_city, o.place_of_performance_state
      FROM saved_opportunities s
      JOIN opportunity_lists l ON s.list_id = l.id
      JOIN opportunities o ON s.notice_id = o.notice_id
      WHERE s.member_id = $1
    `
    const params = [req.user.id]
    if (list_id) { query += ` AND s.list_id = $2`; params.push(list_id) }
    if (status) { query += ` AND s.status = $${params.length + 1}`; params.push(status) }
    query += ' ORDER BY s.saved_at DESC'

    const { rows } = await pool.query(query, params)
    res.json(rows)
  } catch (e) { res.status(500).json({ error: e.message }) }
})

// ─── Save an opportunity to a list ───────────────────────────
app.post('/api/saved', authMiddleware, express.json(), async (req, res) => {
  const { notice_id, list_id, notes, priority, status } = req.body
  if (!notice_id) return res.status(400).json({ error: 'notice_id required' })

  try {
    // If no list specified, use or create default "Saved" list
    let targetListId = list_id
    if (!targetListId) {
      const { rows: listRows } = await pool.query(
        `INSERT INTO opportunity_lists (member_id, name, is_default)
         VALUES ($1, 'Saved', true)
         ON CONFLICT (member_id, name) DO UPDATE SET is_default = true
         RETURNING id`,
        [req.user.id]
      )
      targetListId = listRows[0].id
    }

    const { rows } = await pool.query(
      `INSERT INTO saved_opportunities (member_id, notice_id, list_id, notes, priority, status)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (member_id, notice_id, list_id) DO UPDATE SET
         notes = COALESCE(EXCLUDED.notes, saved_opportunities.notes),
         priority = COALESCE(EXCLUDED.priority, saved_opportunities.priority),
         status = COALESCE(EXCLUDED.status, saved_opportunities.status)
       RETURNING *`,
      [req.user.id, notice_id, targetListId, notes || null, priority || 'medium', status || 'watching']
    )
    res.json(rows[0])
  } catch (e) { res.status(500).json({ error: e.message }) }
})

// ─── Update saved opportunity (notes, status, priority) ──────
app.put('/api/saved/:id', authMiddleware, express.json(), async (req, res) => {
  const { notes, priority, status, list_id } = req.body
  try {
    const { rows } = await pool.query(
      `UPDATE saved_opportunities SET
         notes = COALESCE($1, notes),
         priority = COALESCE($2, priority),
         status = COALESCE($3, status),
         list_id = COALESCE($4, list_id)
       WHERE id = $5 AND member_id = $6 RETURNING *`,
      [notes, priority, status, list_id, req.params.id, req.user.id]
    )
    if (!rows.length) return res.status(404).json({ error: 'Not found' })
    res.json(rows[0])
  } catch (e) { res.status(500).json({ error: e.message }) }
})

// ─── Remove from saved ───────────────────────────────────────
app.delete('/api/saved/:notice_id', authMiddleware, async (req, res) => {
  const { list_id } = req.query
  try {
    if (list_id) {
      await pool.query(
        'DELETE FROM saved_opportunities WHERE member_id = $1 AND notice_id = $2 AND list_id = $3',
        [req.user.id, req.params.notice_id, list_id]
      )
    } else {
      await pool.query(
        'DELETE FROM saved_opportunities WHERE member_id = $1 AND notice_id = $2',
        [req.user.id, req.params.notice_id]
      )
    }
    res.json({ ok: true })
  } catch (e) { res.status(500).json({ error: e.message }) }
})

// ─── Get matched opportunities (smart recommendations) ───────
app.get('/api/matches', authMiddleware, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT m.*, o.title, o.agency_name, o.response_deadline, o.set_aside_type,
              o.naics_code, o.naics_description, o.llama_summary,
              o.place_of_performance_city, o.place_of_performance_state
       FROM opportunity_matches m
       JOIN opportunities o ON m.notice_id = o.notice_id
       WHERE m.member_id = $1 AND o.response_deadline > NOW()
       ORDER BY m.match_score DESC, m.created_at DESC
       LIMIT 50`,
      [req.user.id]
    )
    res.json(rows)
  } catch (e) { res.status(500).json({ error: e.message }) }
})

// ─── Enhanced profile with business description ──────────────
app.get('/api/profile', authMiddleware, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, email, first_name, last_name, profession,
              company_name, company_size, company_state, company_naics, company_uei,
              company_description, company_capabilities, company_certifications, company_past_performance,
              alerts_enabled, alert_naics, alert_states, alert_set_asides, alert_keywords,
              alert_min_value, alert_max_value, alert_frequency,
              credits, role, created_at
       FROM members WHERE id = $1`,
      [req.user.id]
    )
    if (!rows.length) return res.status(404).json({ error: 'User not found' })
    res.json(rows[0])
  } catch (e) { res.status(500).json({ error: e.message }) }
})

app.put('/api/profile', authMiddleware, express.json(), async (req, res) => {
  const allowed = [
    'first_name', 'last_name', 'profession',
    'company_name', 'company_size', 'company_state', 'company_naics', 'company_uei',
    'company_description', 'company_capabilities', 'company_certifications', 'company_past_performance',
    'alerts_enabled', 'alert_naics', 'alert_states', 'alert_set_asides', 'alert_keywords',
    'alert_min_value', 'alert_max_value', 'alert_frequency'
  ]
  const updates = []
  const values = []
  let idx = 1
  for (const key of allowed) {
    if (req.body[key] !== undefined) {
      updates.push(`${key} = $${idx}`)
      values.push(typeof req.body[key] === 'object' ? JSON.stringify(req.body[key]) : req.body[key])
      idx++
    }
  }
  if (!updates.length) return res.status(400).json({ error: 'No fields to update' })
  values.push(req.user.id)
  try {
    await pool.query(`UPDATE members SET ${updates.join(', ')}, updated_at = NOW() WHERE id = $${idx}`, values)
    res.json({ ok: true })
  } catch (e) { res.status(500).json({ error: e.message }) }
})

// ─── My reports (purchased) ───────────────────────────────
app.get('/api/my-reports', authMiddleware, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT rp.*, r.sections, r.generated_at, o.title, o.agency_name, o.solicitation_number
       FROM report_purchases rp
       JOIN reports r ON rp.report_id = r.id
       JOIN opportunities o ON rp.notice_id = o.notice_id
       WHERE rp.member_id = $1 ORDER BY rp.purchased_at DESC`,
      [req.user.id]
    )
    res.json(rows)
  } catch (e) { res.json([]) }
})

// ─── Credits: check balance ──────────────────────────────
app.get('/api/credits', authMiddleware, async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT credits FROM members WHERE id = $1', [req.user.id])
    if (!rows.length) return res.status(404).json({ error: 'User not found' })
    res.json({ credits: rows[0].credits })
  } catch (e) { res.status(500).json({ error: isProd ? 'Internal server error' : e.message }) }
})

// ─── Credits: get available packs ────────────────────────
app.get('/api/credits/packs', (req, res) => {
  const packs = Object.entries(CREDIT_PACKS).map(([key, p]) => ({
    key, label: p.label, credits: p.credits, price: `$${(p.cents / 100).toFixed(0)}`
  }))
  res.json(packs)
})

// ─── Credits: purchase via Stripe Checkout ───────────────
app.post('/api/credits/purchase', authMiddleware, async (req, res) => {
  if (!stripe) return res.status(503).json({ error: 'Stripe not configured' })

  const { pack } = req.body
  const packInfo = CREDIT_PACKS[pack]
  if (!packInfo) return res.status(400).json({ error: 'Invalid pack. Choose: starter, pro, or power' })

  try {
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      mode: 'payment',
      line_items: [{ price: packInfo.priceId, quantity: 1 }],
      metadata: {
        member_id: String(req.user.id),
        credits: String(packInfo.credits),
        pack_name: pack,
      },
      success_url: `${req.headers.origin || 'https://awardopedia.com'}/?credits=success&pack=${pack}`,
      cancel_url: `${req.headers.origin || 'https://awardopedia.com'}/?credits=cancelled`,
    })
    res.json({ url: session.url })
  } catch (e) {
    console.error('[STRIPE] Checkout error:', e.message)
    res.status(500).json({ error: isProd ? 'Payment setup failed' : e.message })
  }
})

// ─── Credits: purchase history ───────────────────────────
app.get('/api/credits/history', authMiddleware, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT credits, amount_cents, pack_name, created_at
       FROM credit_purchases WHERE member_id = $1 ORDER BY created_at DESC LIMIT 50`,
      [req.user.id]
    )
    res.json(rows)
  } catch (e) { res.json([]) }
})

// ─── Self-Improvement System (any authenticated user can propose) ────
app.post('/api/propose-edit', authMiddleware, express.json(), async (req, res) => {
  const { notice_id, field_name, old_value, new_value, explanation, proposed_rule, scope } = req.body
  // scope = 'record' (just fix this one) or 'pipeline' (write a generalizable rule)
  if (!notice_id || !field_name || !explanation) {
    return res.status(400).json({ error: 'notice_id, field_name, and explanation required' })
  }

  const editScope = scope === 'pipeline' ? 'pipeline' : 'record'
  let aiRule = null

  // If scope is 'pipeline', ask Opus to draft a deterministic rule
  if (editScope === 'pipeline' && old_value && new_value) {
    try {
      const proxyUrl = process.env.CLAUDE_PROXY_URL || 'http://localhost:3456'
      const rulePrompt = `A user reported a data quality issue in our federal contracting database pipeline.

Field: ${field_name}
Bad value: ${JSON.stringify(old_value)}
Correct value: ${JSON.stringify(new_value)}
User explanation: ${explanation}

Our pipeline processes SAM.gov opportunity records through these functions:
- _clean_contact() in fetch_opportunity.py — fixes contact name/phone/email issues
- _clean_title() in fetch_opportunity.py — fixes opportunity titles
- _validate_extraction() in pipeline_opportunity.py — validates extracted fields
- stage_7_enrichment() in pipeline_opportunity.py — canonical lookups and normalization

Write a specific, deterministic Python code snippet (regex or string logic) that would catch and fix this class of error in the pipeline. The fix should:
1. Be generalizable — work for all records with this pattern, not just this one
2. Be deterministic — no AI calls needed
3. Have low false-positive risk
4. Include a comment explaining what pattern it catches

Return ONLY the Python code snippet, no explanation. If you can't write a safe deterministic rule, say "NEEDS_MANUAL_REVIEW" instead.`

      const proxyRes = await fetch(`${proxyUrl}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          model: 'claude-sonnet-4-6',
          max_tokens: 500,
          messages: [{ role: 'user', content: rulePrompt }]
        })
      })
      const data = await proxyRes.json()
      aiRule = data.choices?.[0]?.message?.content?.trim() || null
    } catch (e) {
      console.error('AI rule generation failed:', e.message)
    }
  }

  try {
    await pool.query(
      `INSERT INTO pipeline_feedback (notice_id, field_name, old_value, new_value, explanation, proposed_rule, source, scope, ai_generated_rule)
       VALUES ($1, $2, $3, $4, $5, $6, 'human', $7, $8)`,
      [notice_id, field_name, old_value, new_value,
       `[${req.user.email}] ${explanation}`,
       proposed_rule || null, editScope, aiRule]
    )

    // If scope is 'record', also apply the fix immediately to this one record
    if (editScope === 'record' && new_value !== undefined) {
      const allowedFields = [
        'title', 'contracting_officer', 'contracting_officer_email', 'contracting_officer_phone',
        'agency_name', 'office_name', 'naics_description', 'set_aside_type', 'notice_type',
        'place_of_performance_city', 'place_of_performance_state', 'description'
      ]
      if (allowedFields.includes(field_name)) {
        await pool.query(`UPDATE opportunities SET ${field_name} = $1 WHERE notice_id = $2`, [new_value, notice_id])
      }
    }

    res.json({
      ok: true,
      scope: editScope,
      ai_rule: aiRule,
      message: editScope === 'pipeline'
        ? 'Thanks! Your proposal and an AI-drafted pipeline rule have been submitted for admin review.'
        : 'Thanks! The record has been updated and your feedback logged.'
    })
  } catch (e) { res.status(500).json({ error: e.message }) }
})

// ─── Admin: Edit a field + submit pipeline feedback ───────
app.post('/api/admin/edit-field', express.json(), async (req, res) => {
  const { notice_id, field_name, old_value, new_value, explanation, proposed_rule } = req.body
  if (!notice_id || !field_name) return res.status(400).json({ error: 'notice_id and field_name required' })

  try {
    // Update the actual record
    const allowedFields = [
      'title', 'contracting_officer', 'contracting_officer_email', 'contracting_officer_phone',
      'agency_name', 'office_name', 'naics_description', 'set_aside_type', 'notice_type',
      'place_of_performance_city', 'place_of_performance_state', 'description'
    ]
    if (allowedFields.includes(field_name) && new_value !== undefined) {
      await pool.query(`UPDATE opportunities SET ${field_name} = $1 WHERE notice_id = $2`, [new_value, notice_id])
    }

    // Log the feedback for pipeline improvement
    if (explanation) {
      await pool.query(
        `INSERT INTO pipeline_feedback (notice_id, field_name, old_value, new_value, explanation, proposed_rule, source)
         VALUES ($1, $2, $3, $4, $5, $6, 'human')`,
        [notice_id, field_name, old_value, new_value, explanation, proposed_rule || null]
      )
    }
    res.json({ ok: true })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// ─── Admin: Pipeline feedback management ──────────────────
app.get('/api/admin/pipeline-feedback', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM pipeline_feedback ORDER BY created_at DESC LIMIT 50')
    res.json(rows)
  } catch { res.json([]) }
})

app.post('/api/admin/approve-rule', express.json(), async (req, res) => {
  const { id, status } = req.body // status = 'approved' or 'rejected'
  if (!id || !['approved', 'rejected'].includes(status)) return res.status(400).json({ error: 'id and status required' })
  try {
    await pool.query(
      `UPDATE pipeline_feedback SET status = $1, approved_by = 'admin', approved_at = NOW() WHERE id = $2`,
      [status, id]
    )
    res.json({ ok: true })
  } catch (e) { res.status(500).json({ error: e.message }) }
})

app.get('/api/admin/quality-runs', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM data_quality_runs ORDER BY run_date DESC LIMIT 20')
    res.json(rows)
  } catch { res.json([]) }
})

app.get('/api/admin/feedback', async (req, res) => {
  try {
    const fs = await import('fs')
    const lines = fs.readFileSync('logs/feedback.log', 'utf-8').trim().split('\n').filter(Boolean)
    res.json(lines.map(l => { try { return JSON.parse(l) } catch { return null } }).filter(Boolean).reverse())
  } catch { res.json([]) }
})

app.get('/api/admin/stats', async (req, res) => {
  try {
    const q = async (sql) => (await pool.query(sql)).rows[0].n
    res.json({
      opportunities: await q('SELECT count(*) as n FROM opportunities'),
      contracts: await q('SELECT count(*) as n FROM contracts'),
      intel: await q('SELECT count(*) as n FROM opportunity_intel'),
      office_codes: await q('SELECT count(*) as n FROM office_codes'),
      naics: await q('SELECT count(*) as n FROM naics_codes'),
      psc: await q('SELECT count(*) as n FROM psc_codes'),
    })
  } catch (e) { res.json({}) }
})

// ─── Jurisdictions & Pipeline Rules (SLED Admin) ─────────────────────────
app.get('/api/admin/jurisdictions', async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT * FROM jurisdictions ORDER BY
        CASE type WHEN 'federal' THEN 0 WHEN 'state' THEN 1 WHEN 'county' THEN 2 WHEN 'city' THEN 3 ELSE 4 END,
        gdp_rank NULLS LAST,
        name
    `)
    res.json(rows)
  } catch (e) {
    // If table doesn't exist yet, return empty array
    res.json([])
  }
})

app.get('/api/admin/pipeline-rules', async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT * FROM pipeline_rules
      WHERE is_active = true
      ORDER BY jurisdiction_code, stage, rule_name
    `)
    res.json(rows)
  } catch (e) {
    res.json([])
  }
})

app.post('/api/admin/pipeline-rules', express.json(), async (req, res) => {
  const { jurisdiction_code, rule_name, stage, rule_type, problem_description, solution_description, field_name } = req.body
  try {
    const { rows } = await pool.query(`
      INSERT INTO pipeline_rules (jurisdiction_code, rule_name, stage, rule_type, problem_description, solution_description, field_name)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING *
    `, [jurisdiction_code, rule_name, stage, rule_type, problem_description, solution_description, field_name])
    res.json(rows[0])
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

app.put('/api/admin/jurisdictions/:code', express.json(), async (req, res) => {
  const { code } = req.params
  const { pipeline_status, contracts_count, last_fetch_at } = req.body
  try {
    const { rows } = await pool.query(`
      UPDATE jurisdictions SET
        pipeline_status = COALESCE($2, pipeline_status),
        contracts_count = COALESCE($3, contracts_count),
        last_fetch_at = COALESCE($4, last_fetch_at),
        updated_at = NOW()
      WHERE code = $1
      RETURNING *
    `, [code, pipeline_status, contracts_count, last_fetch_at])
    res.json(rows[0])
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// ─── Agency name reverse mapping ────────────────────────────────────────────
// Converts normalized display names back to patterns that match raw DB values
// "Dept. of Energy" → matches "Energy, Department OF", "ENERGY, DEPARTMENT OF"
function agencyFilterPatterns(displayName) {
  if (!displayName) return []

  const REVERSE_MAP = {
    'USDA':                   ['Agriculture', 'AGRICULTURE'],
    'Dept. of Commerce':      ['Commerce', 'COMMERCE'],
    'Defense Department':     ['Defense', 'DEFENSE', 'DEPT OF DEFENSE'],
    'Dept. of Education':     ['Education', 'EDUCATION'],
    'Dept. of Energy':        ['Energy', 'ENERGY'],
    'HHS':                    ['Health and Human Services', 'HEALTH AND HUMAN SERVICES'],
    'DHS':                    ['Homeland Security', 'HOMELAND SECURITY'],
    'HUD':                    ['Housing and Urban Development', 'HOUSING AND URBAN DEVELOPMENT'],
    'Dept. of Justice':       ['Justice', 'JUSTICE'],
    'Dept. of Labor':         ['Labor', 'LABOR'],
    'Dept. of State':         ['State', 'STATE'],
    'Dept. of the Interior':  ['Interior', 'INTERIOR'],
    'Dept. of the Treasury':  ['Treasury', 'TREASURY'],
    'Dept. of Transportation':['Transportation', 'TRANSPORTATION'],
    'Veterans Affairs':       ['Veterans Affairs', 'VETERANS AFFAIRS'],
    'USAID':                  ['International Development', 'INTERNATIONAL DEVELOPMENT'],
    'EPA':                    ['Environmental Protection', 'ENVIRONMENTAL PROTECTION'],
    'GSA':                    ['General Services', 'GENERAL SERVICES'],
    'NASA':                   ['Aeronautics and Space', 'AERONAUTICS AND SPACE', 'NASA'],
    'NSF':                    ['National Science Foundation', 'NATIONAL SCIENCE FOUNDATION'],
    'SBA':                    ['Small Business Administration', 'SMALL BUSINESS ADMINISTRATION'],
  }

  return REVERSE_MAP[displayName] || [displayName]
}

// ─── Contracts (paginated) ────────────────────────────────────────────
app.get('/api/contracts', async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 50, 200)
    const offset = parseInt(req.query.offset) || 0
    const { state, agency, naics, set_aside, q, data_source, min_date } = req.query

    // Build WHERE clauses
    const conditions = []
    const params = []
    let paramIdx = 1

    // Date filter (e.g. for leaderboard click-through to show only trailing 12 months)
    if (min_date) {
      conditions.push(`start_date >= $${paramIdx++}`)
      params.push(min_date)
    }

    if (state) {
      conditions.push(`recipient_state = $${paramIdx++}`)
      params.push(state)
    }
    if (agency) {
      // Use reverse mapping to search for all possible raw formats
      const patterns = agencyFilterPatterns(agency)
      const agencyConditions = patterns.map(() => `agency_name ILIKE $${paramIdx++}`)
      conditions.push(`(${agencyConditions.join(' OR ')})`)
      patterns.forEach(p => params.push(`%${p}%`))
    }
    if (naics) {
      conditions.push(`naics_code = $${paramIdx++}`)
      params.push(naics)
    }
    if (set_aside) {
      conditions.push(`set_aside_type = $${paramIdx++}`)
      params.push(set_aside)
    }
    if (data_source) {
      if (data_source === 'federal') {
        conditions.push(`(data_source = 'usaspending' OR data_source IS NULL)`)
      } else {
        conditions.push(`data_source = $${paramIdx++}`)
        params.push(data_source)
      }
    }
    if (q) {
      conditions.push(`(
        recipient_name ILIKE $${paramIdx} OR
        agency_name ILIKE $${paramIdx} OR
        description ILIKE $${paramIdx} OR
        naics_description ILIKE $${paramIdx}
      )`)
      params.push(`%${q}%`)
      paramIdx++
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''

    // Get total count
    const countResult = await pool.query(`SELECT COUNT(*) FROM contracts ${whereClause}`, params)
    const total = parseInt(countResult.rows[0].count)

    // Get paginated data
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
        data_source, jurisdiction_code, last_synced, created_at
      FROM contracts
      ${whereClause}
      ORDER BY end_date ASC NULLS LAST
      LIMIT $${paramIdx} OFFSET $${paramIdx + 1}
    `, [...params, limit, offset])

    res.json({ data: rows, meta: { total, limit, offset, hasMore: offset + rows.length < total } })
  } catch (e) {
    res.status(500).json({ error: isProd ? 'Internal server error' : e.message })
  }
})

app.get('/api/contracts/:piid', async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT c.*,
        (c.end_date - CURRENT_DATE) AS days_to_expiry,
        r.hq_address AS recipient_hq_address,
        r.hq_city AS recipient_hq_city,
        r.hq_state AS recipient_hq_state,
        r.hq_zip AS recipient_hq_zip,
        r.website AS recipient_website,
        r.phone AS recipient_phone,
        r.is_public_company,
        r.stock_ticker,
        r.market_cap,
        r.employee_count,
        r.executives,
        r.executive_compensation,
        r.company_brief,
        r.parent_uei,
        r.parent_name
      FROM contracts c
      LEFT JOIN recipients r ON c.recipient_uei = r.uei
      WHERE c.piid = $1
    `, [req.params.piid])
    if (!rows.length) return res.status(404).json({ error: 'Not found' })
    res.json(rows[0])
  } catch (e) {
    res.status(500).json({ error: isProd ? 'Internal server error' : e.message })
  }
})

// ─── Opportunities ────────────────────────────────────────
app.get('/api/opportunities', async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 50, 200)
    const offset = parseInt(req.query.offset) || 0
    const { state, agency, naics, set_aside, q, data_source, deadline } = req.query

    // Build WHERE clauses
    // Status filter: open (default), pending (closed but not awarded), all
    const status = req.query.status || 'open'
    const conditions = []
    conditions.push("(i.hidden IS NOT TRUE)")  // Always filter hidden/unsalvageable records

    // Only show biddable notice types in open/pending views
    const BIDDABLE_TYPES = "('Combined Synopsis/Solicitation', 'Solicitation', 'Presolicitation', 'Sale of Surplus Property')"
    if (status === 'open') {
      conditions.push("(response_deadline >= CURRENT_DATE OR response_deadline IS NULL)")
      conditions.push(`(notice_type IS NULL OR notice_type IN ${BIDDABLE_TYPES})`)
    } else if (status === 'pending') {
      // Closed (deadline passed) within last 90 days, biddable types only
      conditions.push("response_deadline < CURRENT_DATE")
      conditions.push("response_deadline >= CURRENT_DATE - INTERVAL '90 days'")
      conditions.push(`(notice_type IS NULL OR notice_type IN ${BIDDABLE_TYPES})`)
    }
    // status === 'all' has no type filter — shows everything for research
    const params = []
    let paramIdx = 1

    if (state) {
      conditions.push(`place_of_performance_state = $${paramIdx++}`)
      params.push(state)
    }
    if (agency) {
      // Use reverse mapping to search for all possible raw formats
      const patterns = agencyFilterPatterns(agency)
      const agencyConditions = patterns.map(() => `agency_name ILIKE $${paramIdx++}`)
      conditions.push(`(${agencyConditions.join(' OR ')})`)
      patterns.forEach(p => params.push(`%${p}%`))
    }
    if (naics) {
      conditions.push(`o.naics_code = $${paramIdx++}`)
      params.push(naics)
    }
    if (set_aside) {
      // Group messy SAM.gov codes into human-readable categories
      const setAsideGroups = {
        'full_open':       ['NONE', '', '[""]'],
        'small_business':  ['SBA', 'Small Business', 'SBP', '["SBA"]', 'ISBEE', 'IEE', 'BICIV'],
        '8a':              ['8A', '8AN', '8(a) Sole Source'],
        'sdvosb':          ['SDVOSB', 'SDVOSBC', 'SDVOSBS', 'VSA', 'VSB'],
        'hubzone':         ['HUBZone', 'HZC', 'HZS'],
        'wosb':            ['WOSB', 'EDWOSB', 'WOSBSS'],
      }
      const codes = setAsideGroups[set_aside]
      if (codes) {
        if (set_aside === 'full_open') {
          const placeholders = codes.map(() => `$${paramIdx++}`).join(', ')
          conditions.push(`(set_aside_type IS NULL OR set_aside_type IN (${placeholders}))`)
          codes.forEach(c => params.push(c))
        } else {
          const placeholders = codes.map(() => `$${paramIdx++}`).join(', ')
          conditions.push(`set_aside_type IN (${placeholders})`)
          codes.forEach(c => params.push(c))
        }
      } else {
        // Fallback: exact match for unknown codes
        conditions.push(`set_aside_type = $${paramIdx++}`)
        params.push(set_aside)
      }
    }
    if (data_source) {
      if (data_source === 'federal') {
        conditions.push(`(o.data_source = 'federal' OR o.data_source IS NULL)`)
      } else {
        conditions.push(`o.data_source = $${paramIdx++}`)
        params.push(data_source)
      }
    }
    if (deadline) {
      const days = parseInt(deadline)
      if (days > 0) {
        conditions.push(`response_deadline >= CURRENT_DATE + $${paramIdx++}::integer`)
        params.push(days)
      }
    }
    if (q) {
      conditions.push(`(
        o.title ILIKE $${paramIdx} OR
        o.agency_name ILIKE $${paramIdx} OR
        o.description ILIKE $${paramIdx} OR
        o.naics_description ILIKE $${paramIdx} OR
        o.notice_id ILIKE $${paramIdx} OR
        o.solicitation_number ILIKE $${paramIdx}
      )`)
      params.push(`%${q}%`)
      paramIdx++
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''

    // Get total count (must join intel to respect hidden flag)
    const countResult = await pool.query(`SELECT COUNT(*) FROM opportunities o LEFT JOIN opportunity_intel i USING (notice_id) ${whereClause}`, params)
    const total = parseInt(countResult.rows[0].count)

    // Get paginated data
    const { rows } = await pool.query(`
      SELECT o.*,
        (o.response_deadline - CURRENT_DATE) AS days_to_deadline,
        i.size_standard,
        i.performance_address,
        i.contract_structure,
        i.wage_floor,
        i.award_basis,
        i.clearance_required,
        i.sole_source,
        i.estimated_value_text AS intel_estimated_value,
        i.pdf_enriched,
        i.doc_count,
        i.congressional_district,
        i.congress_member_url,
        i.has_controlled_docs,
        p.description AS psc_description
      FROM opportunities o
      LEFT JOIN opportunity_intel i USING (notice_id)
      LEFT JOIN psc_codes p ON o.psc_code = p.code
      ${whereClause}
      ORDER BY o.response_deadline ASC NULLS LAST
      LIMIT $${paramIdx} OFFSET $${paramIdx + 1}
    `, [...params, limit, offset])

    res.json({ data: rows, meta: { total, limit, offset, hasMore: offset + rows.length < total } })
  } catch (e) {
    res.status(500).json({ error: isProd ? 'Internal server error' : e.message })
  }
})

app.get('/api/opportunities/:idOrSlug', async (req, res) => {
  try {
    // Accept both notice_id (32-char hex) and SEO slug
    const param = req.params.idOrSlug
    const isNoticeId = /^[a-f0-9]{32}$/.test(param)
    const whereClause = isNoticeId ? 'o.notice_id = $1' : 'o.slug = $1'

    const { rows } = await pool.query(`
      SELECT o.*,
        (o.response_deadline - CURRENT_DATE) AS days_to_deadline,
        i.size_standard,
        i.performance_address,
        i.contract_structure,
        i.wage_floor,
        i.award_basis,
        i.clearance_required,
        i.sole_source,
        i.estimated_value_text AS intel_estimated_value,
        i.pdf_enriched,
        i.doc_count,
        i.congressional_district,
        i.congress_member_url,
        i.has_controlled_docs,
        i.key_requirements,
        p.description AS psc_description
      FROM opportunities o
      LEFT JOIN opportunity_intel i USING (notice_id)
      LEFT JOIN psc_codes p ON o.psc_code = p.code
      WHERE ${whereClause}
    `, [param])
    if (!rows.length) return res.status(404).json({ error: 'Not found' })

    // If accessed by old notice_id and slug exists, tell the client the canonical slug
    const opp = rows[0]
    if (isNoticeId && opp.slug) {
      opp._canonical_slug = opp.slug
    }

    res.json(opp)
  } catch (e) {
    res.status(500).json({ error: isProd ? 'Internal server error' : e.message })
  }
})

// ─── Attachment proxy — fetches SAM.gov files server-side so users don't need a login ──
app.get('/api/proxy/attachment', async (req, res) => {
  const { url } = req.query
  if (!url || !url.startsWith('https://sam.gov/')) {
    return res.status(400).json({ error: 'Invalid attachment URL' })
  }
  try {
    const upstream = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Awardopedia/1.0)' },
      redirect: 'follow',
    })
    if (!upstream.ok) {
      return res.status(502).json({ error: `SAM.gov returned ${upstream.status}` })
    }
    let contentType = upstream.headers.get('content-type') || 'application/octet-stream'
    const contentDisposition = upstream.headers.get('content-disposition') || ''

    // SAM.gov often sends application/octet-stream for PDFs — detect and fix
    const filenameMatch = contentDisposition.match(/filename[*]?=(?:"([^"]+)"|([^\s;]+))/)
    const filename = filenameMatch ? (filenameMatch[1] || filenameMatch[2]) : ''
    if (filename.toLowerCase().endsWith('.pdf') || contentType === 'application/octet-stream') {
      // If filename ends in .pdf OR it's octet-stream (likely a PDF from SAM.gov), set correct type
      if (filename.toLowerCase().endsWith('.pdf')) {
        contentType = 'application/pdf'
      }
    }

    res.setHeader('Content-Type', contentType)
    // ALWAYS use 'inline' so PDFs open in browser instead of auto-downloading
    // User can still right-click → Save As, or use the "Download All as ZIP" option
    res.setHeader('Content-Disposition', filename ? `inline; filename="${filename}"` : 'inline')
    // Stream the body directly to the response
    const reader = upstream.body.getReader()
    const pump = async () => {
      const { done, value } = await reader.read()
      if (done) { res.end(); return }
      res.write(Buffer.from(value))
      return pump()
    }
    await pump()
  } catch (e) {
    if (!res.headersSent) res.status(502).json({ error: 'Failed to fetch attachment' })
  }
})

// ─── Record reports (user-submitted corrections) ──────────
app.post('/api/opportunities/:notice_id/report', authMiddleware, async (req, res) => {
  try {
    const { notice_id } = req.params
    const { report_type, details, suggested_value, suggested_fields } = req.body
    if (!report_type) return res.status(400).json({ error: 'report_type required' })
    const validTypes = ['wrong_location', 'wrong_title', 'bad_summary', 'wrong_agency', 'other', 'edit_suggestion']
    if (!validTypes.includes(report_type)) return res.status(400).json({ error: 'invalid report_type' })
    await pool.query(
      `INSERT INTO record_reports (notice_id, report_type, details, suggested_value, suggested_fields, member_id)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6)`,
      [notice_id, report_type, details || null, suggested_value || null,
       suggested_fields ? JSON.stringify(suggested_fields) : null, req.user.id]
    )
    res.json({ ok: true })
  } catch (e) {
    console.error('report error:', e)
    res.status(500).json({ error: 'Failed to save report' })
  }
})

app.get('/api/admin/reports', async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT r.id, r.notice_id, r.report_type, r.details,
             r.suggested_value, r.suggested_fields, r.status,
             r.created_at, o.title, o.agency_name, m.email AS member_email
      FROM record_reports r
      LEFT JOIN opportunities o USING (notice_id)
      LEFT JOIN members m ON m.id = r.member_id
      WHERE r.status = 'pending'
      ORDER BY r.created_at DESC
      LIMIT 50
    `)
    res.json({ data: rows, count: rows.length })
  } catch (e) {
    res.status(500).json({ error: 'Failed to fetch reports' })
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
    res.status(500).json({ error: isProd ? 'Internal server error' : e.message })
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
      const logoPath = pathResolve(pathDirname(fu(import.meta.url)), '../assets/logo-horizontal-clean.jpg')
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
    res.status(500).send(isProd ? '<p>Internal server error</p>' : `<p>Error: ${e.message}</p>`)
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

PLAIN-ENGLISH SUMMARY (AI-generated, for context):
${c.llama_summary || 'Not yet generated.'}

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
  // All possible report section tags (contract + opportunity + standardized)
  const sections = [
    'executive_summary','bid_recommendation','scope_of_work',
    'competitive_landscape','incumbent_analysis','pricing_analysis',
    'teaming_strategy','risk_assessment','action_plan',
    // Legacy tags (older reports may use these)
    'award_details','recompete_assessment','recommended_action',
    'recompete_intelligence','risk_factors','action_items',
    'attribution'
  ]
  const result = {}
  for (const tag of sections) {
    const match = xml.match(new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`))
    result[tag] = match ? match[1].trim() : null
  }
  return result
}

app.post('/api/reports/generate', reportRateLimit, requireApiKey, async (req, res) => {
  const { piid } = req.body
  if (!piid) return res.status(400).json({ error: 'piid required' })

  // Per-key report limit
  const keyHash = hashKey(req.headers['x-awardopedia-key'])
  const keyPrefix = req.headers['x-awardopedia-key']?.slice(0, 16) || 'unknown'
  const rkl = checkReportKeyLimit(keyHash)
  logReportGeneration(keyPrefix, piid, getClientIp(req))
  if (!rkl.allowed) {
    logExcessReports(keyPrefix, rkl.count, getClientIp(req))
    return res.status(429).json({ error: 'Report generation limit exceeded (10/day). Try again tomorrow.' })
  }

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
      model: 'claude-sonnet-4-6',
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
    res.status(500).json({ error: isProd ? 'Internal server error' : e.message })
  }
})

// ─── Opportunity Report: load cached ─────────────────────
app.get('/api/reports/opportunity/:notice_id', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT sections, generated_at, purchase_count FROM reports
       WHERE record_type = 'opportunity' AND record_id = $1
       AND generated_at > NOW() - INTERVAL '90 days'
       ORDER BY generated_at DESC LIMIT 1`,
      [req.params.notice_id]
    )
    if (!rows.length || !rows[0].sections) return res.json({ found: false })
    res.json({ found: true, sections: rows[0].sections, generated_at: rows[0].generated_at })
  } catch (e) {
    res.status(500).json({ error: isProd ? 'Internal server error' : e.message })
  }
})

// ─── Opportunity Report: generate ────────────────────────
function buildOpportunityPrompt(o) {
  const biz = Array.isArray(o.business_categories) ? o.business_categories.join(', ') : (o.business_categories || 'N/A')
  const days = o.days_to_deadline
  const deadlineNote = days == null ? `deadline ${o.response_deadline || 'unknown'}`
    : days < 0 ? `closed ${Math.abs(days)} days ago`
    : days === 0 ? 'closes today'
    : `${days} days remaining`

  return `${o.llama_summary ? `PLAIN-ENGLISH SUMMARY:\n${o.llama_summary}\n\n` : ''}OPPORTUNITY DATA (verified from SAM.gov — treat all fields below as [DATA]):

Notice ID:         ${o.notice_id}
Title:             ${o.title || 'N/A'}
Solicitation #:    ${o.solicitation_number || 'N/A'}
Notice Type:       ${o.notice_type || 'N/A'}

Agency:            ${o.agency_name || 'N/A'}
Sub-Agency:        ${o.sub_agency_name || 'N/A'}
Office:            ${o.office_name || 'N/A'}
Contracting Officer: ${o.contracting_officer || 'N/A'}
CO Email:          ${o.contracting_officer_email || 'N/A'}
CO Phone:          ${o.contracting_officer_phone || 'N/A'}

NAICS:             ${o.naics_code} — ${o.naics_description || 'N/A'}
PSC Code:          ${o.psc_code || 'N/A'}
Set-Aside:         ${o.set_aside_type || 'None'}
Estimated Value:   $${Number(o.estimated_value_min||0).toLocaleString()} – $${Number(o.estimated_value_max||0).toLocaleString()}
Contract Type:     ${o.contract_type || 'N/A'}

Posted:            ${o.posted_date || 'N/A'}
Response Deadline: ${o.response_deadline || 'N/A'}
Archive Date:      ${o.archive_date || 'N/A'}

Place of Performance: ${[o.place_of_performance_city, o.place_of_performance_state].filter(Boolean).join(', ') || 'N/A'}

Recompete:         ${o.is_recompete ? 'YES' : 'No'}
Incumbent:         ${o.incumbent_name || 'N/A'} (UEI: ${o.incumbent_uei || 'N/A'})

SAM.gov URL:       ${o.sam_url || 'N/A'}

Generate a comprehensive competitive intelligence report using EXACTLY this XML structure.
EVERY tag is required — do not skip any. Write LONG, detailed sections. This report is worth $50 to a small business owner deciding whether to invest thousands in proposal preparation.

<executive_summary>
2 paragraphs. First: what they're buying, who's buying, scope, value, timeline. Second: why it matters, who should care, the bottom line.
</executive_summary>

<bid_recommendation>
One line: **BID**, **NO-BID**, or **CONDITIONAL BID**
Then 1-2 paragraphs with 3-5 numbered reasons. Who should bid, who shouldn't, and the financial calculus.
</bid_recommendation>

<scope_of_work>
1-2 paragraphs: what the contractor will actually do day-to-day. Major work components, skills needed, key deliverables. Cite specific CLINs or requirements from the solicitation if available.
</scope_of_work>

<competitive_landscape>
1-2 paragraphs: estimated number of competitors, types of firms likely to bid, win probability for a qualified small business. How does the evaluation method (LPTA vs Best Value) shape the dynamics?
</competitive_landscape>

<incumbent_analysis>
1-2 paragraphs. If recompete: incumbent strengths/weaknesses, are they beatable? If new: what type of firm is this designed for, what differentiators matter most?
</incumbent_analysis>

<pricing_analysis>
1 paragraph: estimated value, key cost drivers (wages, bonding, equipment), pricing strategy guidance. Price aggressively or focus on technical merit?
</pricing_analysis>

<teaming_strategy>
1-2 paragraphs: prime or sub? What partner profile strengthens the team? Any mentor-protege or JV angles?
</teaming_strategy>

<risk_assessment>
4-6 risks as a numbered list. Each risk: 1-2 sentences covering the risk and specific mitigation. Use **bold** for risk names.
</risk_assessment>

<action_plan>
6-10 numbered actions in logical order (not tied to specific dates). Each: what to do, who to contact, what document or resource is needed. Reference the CO by name and the proposal deadline as an absolute date. Do NOT use "immediately," "today," "this week," or any time-relative language. Instead frame as: "before beginning proposal preparation," "after reviewing the solicitation," "prior to the proposal deadline of [date]," etc. The reader may encounter this report at any point in the solicitation timeline.
</action_plan>

<attribution>
Data sourced from SAM.gov (official US federal contracting portal). Analysis generated by Claude AI.
This report is for informational purposes only and does not constitute legal or bid-strategy advice.
</attribution>`
}

const OPP_REPORT_SYSTEM_PROMPT = `You are a senior federal contracting intelligence analyst writing a bid assessment for a small business owner.

Your audience is a business owner deciding whether to invest in a proposal. Write in clear, direct prose that reads like a well-written book — flowing paragraphs, no bullet points within prose, no bold text, no markdown formatting. Just clean sentences and paragraphs.

STYLE RULES:
- Write in flowing prose. No bold, no asterisks, no markdown. Just clean text that reads like a professional briefing document.
- Short paragraphs (2-4 sentences each). White space between paragraphs.
- For numbered items (risks, action items), use plain "1." numbering — no bold, no special formatting.
- Total report should be 1,500-2,500 words. Dense with insight, zero filler.
- Every sentence must earn its place. If it doesn't add actionable intelligence, cut it.

TIME NEUTRALITY — CRITICAL (violating this rule ruins the report):
- This report will be cached and served to many readers over weeks or months.
- NEVER use: "today," "right now," "currently," "immediately," "this week," "X days remaining," "the deadline is tight," "act quickly," "time is short," "as of this writing," or ANY time-relative language.
- NEVER reference specific dates in the action plan as deadlines for the reader (e.g., "by March 25"). The reader may be reading this months after generation.
- Instead: state the proposal deadline as a fact ("proposals are due April 21, 2026") and frame actions relative to the process ("before beginning proposal preparation," "prior to the proposal deadline," "after reviewing the full solicitation package").
- The report should read identically whether someone opens it the day it was generated or six months later.

CONTENT RULES:
1. Every XML tag must appear in your response, in order.
2. When solicitation documents are provided, cite specific requirements — CLINs, wage rates, evaluation criteria, bonding thresholds.
3. Never invent details. Analyze and interpret what the data means for a small bidder.
4. Bid recommendations must be definitive: BID, NO-BID, or CONDITIONAL BID with numbered reasons.
5. Name the CO, reference deadlines as absolute dates, cite specific documents.
6. Define every acronym on first use. Write "Naval Facilities Engineering Systems Command (NAVFAC)" not just "NAVFAC." After first use, the acronym alone is fine.`

app.post('/api/reports/generate-opportunity', reportRateLimit, requireApiKey, async (req, res) => {
  const { notice_id } = req.body
  if (!notice_id) return res.status(400).json({ error: 'notice_id required' })

  // Per-key report limit
  const keyHash = hashKey(req.headers['x-awardopedia-key'])
  const keyPrefix = req.headers['x-awardopedia-key']?.slice(0, 16) || 'unknown'
  const rkl = checkReportKeyLimit(keyHash)
  logReportGeneration(keyPrefix, notice_id, getClientIp(req))
  if (!rkl.allowed) {
    logExcessReports(keyPrefix, rkl.count, getClientIp(req))
    return res.status(429).json({ error: 'Report generation limit exceeded (10/day). Try again tomorrow.' })
  }

  try {
    const { rows } = await pool.query(
      'SELECT *, (response_deadline - CURRENT_DATE) AS days_to_deadline FROM opportunities WHERE notice_id = $1',
      [notice_id]
    )
    if (!rows.length) return res.status(404).json({ error: 'Opportunity not found' })
    const opp = rows[0]

    // Check cache
    const { rows: cached } = await pool.query(
      `SELECT sections, generated_at FROM reports
       WHERE record_type = 'opportunity' AND record_id = $1
       AND generated_at > NOW() - INTERVAL '90 days'
       ORDER BY generated_at DESC LIMIT 1`,
      [notice_id]
    )
    if (cached.length && cached[0].sections) {
      await pool.query(
        `UPDATE reports SET purchase_count = purchase_count + 1, last_purchased = NOW()
         WHERE record_type = 'opportunity' AND record_id = $1`,
        [notice_id]
      )
      return res.json({ cached: true, generated_at: cached[0].generated_at, sections: cached[0].sections })
    }

    // Generate with Claude
    const prompt = buildOpportunityPrompt(opp)
    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 2500,
      temperature: 0,
      system: OPP_REPORT_SYSTEM_PROMPT,
      messages: [{ role: 'user', content: prompt }]
    })

    const rawXml = message.content[0].text
    const sections = parseReportXml(rawXml)

    const missing = Object.entries(sections).filter(([,v]) => !v).map(([k]) => k)
    if (missing.length > 2) {
      return res.status(500).json({ error: 'Report incomplete', missing })
    }

    await pool.query(
      `INSERT INTO reports (record_type, record_id, sections, generated_at, generation_cost, purchase_count)
       VALUES ('opportunity', $1, $2, NOW(), 0.02, 1)
       ON CONFLICT DO NOTHING`,
      [notice_id, JSON.stringify(sections)]
    )
    await pool.query(
      `UPDATE opportunities SET report_generated = true, report_generated_at = NOW() WHERE notice_id = $1`,
      [notice_id]
    )

    res.json({ cached: false, generated_at: new Date().toISOString(), usage: message.usage, sections })
  } catch (e) {
    console.error('Opportunity report error:', e)
    res.status(500).json({ error: isProd ? 'Internal server error' : e.message })
  }
})

// ═══════════════════════════════════════════════════════════════════
// MEMBER REPORT GENERATION — uses credits instead of API key
// ═══════════════════════════════════════════════════════════════════

// Contract report — member auth + credit deduction
app.post('/api/member/reports/generate', authMiddleware, async (req, res) => {
  const { piid } = req.body
  if (!piid) return res.status(400).json({ error: 'piid required' })

  try {
    // Check for cached report first (free — no credit deduction)
    const { rows: cached } = await pool.query(
      `SELECT sections, generated_at FROM reports
       WHERE record_type = 'contract' AND record_id = $1
       AND generated_at > NOW() - INTERVAL '90 days'
       ORDER BY generated_at DESC LIMIT 1`,
      [piid]
    )
    if (cached.length && cached[0].sections) {
      return res.json({ cached: true, generated_at: cached[0].generated_at, sections: cached[0].sections })
    }

    // Check credits
    const { rows: memberRows } = await pool.query('SELECT credits FROM members WHERE id = $1', [req.user.id])
    if (!memberRows.length) return res.status(404).json({ error: 'User not found' })
    if (memberRows[0].credits < CREDITS_PER_REPORT) {
      return res.status(402).json({ error: 'Insufficient credits', credits: memberRows[0].credits, required: CREDITS_PER_REPORT })
    }

    // Fetch contract
    const { rows } = await pool.query(
      'SELECT *, (end_date - CURRENT_DATE) AS days_to_expiry FROM contracts WHERE piid = $1',
      [piid]
    )
    if (!rows.length) return res.status(404).json({ error: 'Contract not found' })

    // Deduct credit
    await pool.query('UPDATE members SET credits = credits - $1 WHERE id = $2', [CREDITS_PER_REPORT, req.user.id])

    // Generate with Claude
    const prompt = buildContractPrompt(rows[0])
    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 2500,
      temperature: 0,
      system: REPORT_SYSTEM_PROMPT,
      messages: [{ role: 'user', content: prompt }]
    })

    const rawXml = message.content[0].text
    const sections = parseReportXml(rawXml)

    // Cache in DB
    await pool.query(
      `INSERT INTO reports (record_type, record_id, sections, generated_at, generation_cost, purchase_count)
       VALUES ('contract', $1, $2, NOW(), 0.02, 1) ON CONFLICT DO NOTHING`,
      [piid, JSON.stringify(sections)]
    )
    await pool.query('UPDATE contracts SET report_generated = true, report_generated_at = NOW() WHERE piid = $1', [piid])

    // Record purchase
    const { rows: rptRows } = await pool.query(
      `SELECT id FROM reports WHERE record_type = 'contract' AND record_id = $1 ORDER BY generated_at DESC LIMIT 1`, [piid]
    )
    if (rptRows.length) {
      await pool.query(
        `INSERT INTO report_purchases (member_id, report_id, notice_id, credits_used) VALUES ($1, $2, $3, $4)`,
        [req.user.id, rptRows[0].id, piid, CREDITS_PER_REPORT]
      )
    }

    res.json({ cached: false, generated_at: new Date().toISOString(), sections })
  } catch (e) {
    console.error('Member report error:', e)
    res.status(500).json({ error: isProd ? 'Internal server error' : e.message })
  }
})

// Opportunity report — member auth + credit deduction
app.post('/api/member/reports/generate-opportunity', authMiddleware, async (req, res) => {
  const { notice_id } = req.body
  if (!notice_id) return res.status(400).json({ error: 'notice_id required' })

  try {
    // Check cache first (free)
    const { rows: cached } = await pool.query(
      `SELECT sections, generated_at FROM reports
       WHERE record_type = 'opportunity' AND record_id = $1
       AND generated_at > NOW() - INTERVAL '90 days'
       ORDER BY generated_at DESC LIMIT 1`,
      [notice_id]
    )
    if (cached.length && cached[0].sections) {
      return res.json({ cached: true, generated_at: cached[0].generated_at, sections: cached[0].sections })
    }

    // Check credits
    const { rows: memberRows } = await pool.query('SELECT credits FROM members WHERE id = $1', [req.user.id])
    if (!memberRows.length) return res.status(404).json({ error: 'User not found' })
    if (memberRows[0].credits < CREDITS_PER_REPORT) {
      return res.status(402).json({ error: 'Insufficient credits', credits: memberRows[0].credits, required: CREDITS_PER_REPORT })
    }

    // Fetch opportunity
    const { rows } = await pool.query(`
      SELECT o.*, (o.response_deadline - CURRENT_DATE) AS days_to_deadline,
        i.size_standard, i.performance_address, i.contract_structure,
        i.wage_floor, i.award_basis, i.clearance_required, i.sole_source,
        i.estimated_value_text, i.key_requirements, i.pdf_intel, i.work_hours,
        p.description AS psc_description
      FROM opportunities o
      LEFT JOIN opportunity_intel i USING (notice_id)
      LEFT JOIN psc_codes p ON o.psc_code = p.code
      WHERE o.notice_id = $1
    `, [notice_id])
    if (!rows.length) return res.status(404).json({ error: 'Opportunity not found' })

    // Deduct credit
    await pool.query('UPDATE members SET credits = credits - $1 WHERE id = $2', [CREDITS_PER_REPORT, req.user.id])

    // Generate with Claude
    const prompt = buildOpportunityPrompt(rows[0])
    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4000,
      temperature: 0,
      system: OPP_REPORT_SYSTEM_PROMPT,
      messages: [{ role: 'user', content: prompt }]
    })

    const rawXml = message.content[0].text
    const sections = parseReportXml(rawXml)

    await pool.query(
      `INSERT INTO reports (record_type, record_id, sections, generated_at, generation_cost, purchase_count)
       VALUES ('opportunity', $1, $2, NOW(), 0.02, 1) ON CONFLICT DO NOTHING`,
      [notice_id, JSON.stringify(sections)]
    )
    await pool.query('UPDATE opportunities SET report_generated = true, report_generated_at = NOW() WHERE notice_id = $1', [notice_id])

    const { rows: rptRows } = await pool.query(
      `SELECT id FROM reports WHERE record_type = 'opportunity' AND record_id = $1 ORDER BY generated_at DESC LIMIT 1`, [notice_id]
    )
    if (rptRows.length) {
      await pool.query(
        `INSERT INTO report_purchases (member_id, report_id, notice_id, credits_used) VALUES ($1, $2, $3, $4)`,
        [req.user.id, rptRows[0].id, notice_id, CREDITS_PER_REPORT]
      )
    }

    res.json({ cached: false, generated_at: new Date().toISOString(), sections })
  } catch (e) {
    console.error('Member opp report error:', e)
    res.status(500).json({ error: isProd ? 'Internal server error' : e.message })
  }
})

// ─── CSV export for reports ──────────────────────────────
app.get('/api/reports/csv/:type/:id', async (req, res) => {
  const { type, id } = req.params
  if (!['contract', 'opportunity'].includes(type)) return res.status(400).json({ error: 'Invalid type' })

  try {
    const { rows } = await pool.query(
      `SELECT sections, generated_at FROM reports
       WHERE record_type = $1 AND record_id = $2
       ORDER BY generated_at DESC LIMIT 1`,
      [type, id]
    )
    if (!rows.length || !rows[0].sections) return res.status(404).json({ error: 'Report not found' })

    const s = rows[0].sections
    const csvRows = [['Section', 'Content']]
    for (const [key, val] of Object.entries(s)) {
      if (val) csvRows.push([key.replace(/_/g, ' '), val.replace(/"/g, '""')])
    }

    const csv = csvRows.map(r => r.map(c => `"${c}"`).join(',')).join('\n')
    res.setHeader('Content-Type', 'text/csv')
    res.setHeader('Content-Disposition', `attachment; filename="report-${id}.csv"`)
    res.send(csv)
  } catch (e) {
    res.status(500).json({ error: isProd ? 'Internal server error' : e.message })
  }
})

// ═══════════════════════════════════════════════════════════════════
// DEV-ONLY: Generate reports via OAuth proxy (no API key needed)
// Routes through localhost:3456 (claude-max-api-proxy)
// ═══════════════════════════════════════════════════════════════════

app.post('/api/reports/generate-opportunity-dev', async (req, res) => {
  if (isProd) return res.status(403).json({ error: 'Dev endpoint not available in production' })

  const { notice_id, force } = req.body
  if (!notice_id) return res.status(400).json({ error: 'notice_id required' })

  try {
    const { rows } = await pool.query(`
      SELECT o.*, (o.response_deadline - CURRENT_DATE) AS days_to_deadline,
        i.size_standard, i.performance_address, i.contract_structure,
        i.wage_floor, i.award_basis, i.clearance_required, i.sole_source,
        i.estimated_value_text, i.key_requirements, i.pdf_intel, i.work_hours,
        p.description AS psc_description,
        oc.full_name AS office_full_name, oc.city AS office_city, oc.state AS office_state
      FROM opportunities o
      LEFT JOIN opportunity_intel i USING (notice_id)
      LEFT JOIN psc_codes p ON o.psc_code = p.code
      LEFT JOIN office_codes oc ON (
        SELECT split_part(o.agency_name, '.', array_length(string_to_array(o.agency_name, '.'), 1))
      ) LIKE '%' || oc.code || '%'
      WHERE o.notice_id = $1
    `, [notice_id])
    if (!rows.length) return res.status(404).json({ error: 'Opportunity not found' })
    const opp = rows[0]

    // Check cache (skip if force=true)
    if (!force) {
      const { rows: cached } = await pool.query(
        `SELECT sections, generated_at FROM reports
         WHERE record_type = 'opportunity' AND record_id = $1
         AND generated_at > NOW() - INTERVAL '90 days'
         ORDER BY generated_at DESC LIMIT 1`,
        [notice_id]
      )
      if (cached.length && cached[0].sections) {
        return res.json({ cached: true, found: true, generated_at: cached[0].generated_at, sections: cached[0].sections })
      }
    }

    // Load PDF text from disk if available
    const fs = await import('fs')
    const path = await import('path')
    let pdfText = ''
    const pdfDir = path.join(process.cwd(), 'data', 'pdfs', notice_id)
    try {
      if (fs.existsSync(pdfDir)) {
        const { execSync } = await import('child_process')
        const files = fs.readdirSync(pdfDir).filter(f => f.endsWith('.pdf')).sort()
        for (const file of files) {
          try {
            const text = execSync(`pdftotext "${path.join(pdfDir, file)}" -`, { timeout: 15000 }).toString()
            if (text.trim()) {
              // Strip FAR boilerplate
              const cleaned = text.split('\n').filter(l => !/\b5[12]\.\d{3}-\d+\b/.test(l)).join('\n')
              pdfText += `\n\n--- ${file} ---\n${cleaned}`
            }
          } catch {}
        }
        // Truncate to ~15K words for the report prompt
        const words = pdfText.split(/\s+/)
        if (words.length > 15000) {
          pdfText = words.slice(0, 15000).join(' ') + '\n[... truncated for length ...]'
        }
      }
    } catch {}

    // Build enriched prompt with PDF text
    const prompt = buildOpportunityPrompt(opp) + (pdfText
      ? `\n\nFULL SOLICITATION DOCUMENT TEXT (${pdfText.split(/\s+/).length.toLocaleString()} words, boilerplate stripped):\n${pdfText}`
      : '')

    const proxyUrl = process.env.CLAUDE_PROXY_URL || 'http://localhost:3456'
    console.log(`[REPORT] Generating for ${notice_id} | prompt ~${Math.round(prompt.length/4)} tokens | PDFs: ${pdfText ? 'yes' : 'no'}`)

    const proxyRes = await fetch(`${proxyUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 4000,
        messages: [
          { role: 'system', content: OPP_REPORT_SYSTEM_PROMPT },
          { role: 'user', content: prompt }
        ]
      })
    })
    const proxyData = await proxyRes.json()
    const rawXml = proxyData.choices[0].message.content.trim()
    const sections = parseReportXml(rawXml)

    // Cache (delete old first if force)
    if (force) {
      await pool.query(`DELETE FROM reports WHERE record_type = 'opportunity' AND record_id = $1`, [notice_id])
    }
    await pool.query(
      `INSERT INTO reports (record_type, record_id, sections, generated_at, generation_cost, purchase_count)
       VALUES ('opportunity', $1, $2, NOW(), 0, 1)
       ON CONFLICT DO NOTHING`,
      [notice_id, JSON.stringify(sections)]
    )
    await pool.query(
      `UPDATE opportunities SET report_generated = true, report_generated_at = NOW() WHERE notice_id = $1`,
      [notice_id]
    )

    // ── Backfill enrichment: mine the report + PDFs for missing structured fields ──
    // This runs async — don't block the response
    backfillFromReport(notice_id, sections, pdfText, opp, proxyUrl).catch(e =>
      console.error(`[BACKFILL] ${notice_id} failed:`, e.message)
    )

    res.json({ cached: false, found: true, generated_at: new Date().toISOString(), sections })
  } catch (e) {
    console.error('Dev report error:', e)
    res.status(500).json({ error: e.message })
  }
})

// ── Backfill: extract structured fields from report generation context ────
async function backfillFromReport(noticeId, reportSections, pdfText, opp, proxyUrl) {
  // Check what's currently NULL in opportunity_intel
  const { rows } = await pool.query(
    `SELECT size_standard, contract_structure, award_basis, wage_floor, work_hours,
            estimated_value_text, performance_address
     FROM opportunity_intel WHERE notice_id = $1`,
    [noticeId]
  )
  if (!rows.length) return

  const current = rows[0]
  const nullFields = Object.entries(current)
    .filter(([k, v]) => v === null || v === '' || v === 'Not published')
    .map(([k]) => k)

  if (nullFields.length === 0 || !pdfText) {
    console.log(`[BACKFILL] ${noticeId.slice(0,16)}: no blanks to fill (or no PDFs)`)
    return
  }

  console.log(`[BACKFILL] ${noticeId.slice(0,16)}: filling ${nullFields.length} blanks: ${nullFields.join(', ')}`)

  // Also mine the report itself for clues
  const reportText = Object.values(reportSections).filter(Boolean).join('\n')

  const fieldDescriptions = {
    size_standard: 'SBA size standard (e.g. "$22 million" or "1,250 employees")',
    contract_structure: 'Base year + option years (e.g. "1 base + 4 option years, 5 years total")',
    award_basis: 'Evaluation method: "Lowest Price Technically Acceptable (LPTA)" or "Best Value"',
    wage_floor: 'Prevailing wage rate for primary occupation (e.g. "$18.27/hr for Janitor")',
    work_hours: 'Required work schedule (e.g. "7:00 AM - 4:30 PM Monday-Friday")',
    estimated_value_text: 'Estimated total contract value in dollars (e.g. "$10,000,000 - $20,000,000")',
    performance_address: 'Street address where work will be performed',
  }

  const needed = nullFields
    .filter(f => fieldDescriptions[f])
    .map(f => `  - ${f}: ${fieldDescriptions[f]}`)
    .join('\n')

  if (!needed) return

  const prompt = `You just analyzed a federal solicitation. Based on the documents below, extract ONLY these missing fields.

REPORT YOU GENERATED:
${reportText.slice(0, 3000)}

SOLICITATION DOCUMENTS (excerpt):
${pdfText.slice(0, 8000)}

FIELDS NEEDED (return null if genuinely not in the documents):
${needed}

Return ONLY a JSON object with the field names as keys. No markdown.`

  try {
    const res = await fetch(`${proxyUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 512,
        messages: [{ role: 'user', content: prompt }]
      })
    })
    const data = await res.json()
    let raw = data.choices[0].message.content.trim()
    raw = raw.replace(/^```json\s*/, '').replace(/^```\s*/, '').replace(/\s*```$/, '')
    const extracted = JSON.parse(raw)

    // Write non-null values back to opportunity_intel
    const updates = []
    const values = []
    for (const [field, value] of Object.entries(extracted)) {
      if (value !== null && value !== '' && fieldDescriptions[field]) {
        updates.push(`${field} = $${updates.length + 2}`)
        values.push(value)
      }
    }

    if (updates.length > 0) {
      await pool.query(
        `UPDATE opportunity_intel SET ${updates.join(', ')}, updated_at = NOW() WHERE notice_id = $1`,
        [noticeId, ...values]
      )
      console.log(`[BACKFILL] ${noticeId.slice(0,16)}: filled ${updates.length} fields: ${updates.map(u => u.split(' ')[0]).join(', ')}`)
    } else {
      console.log(`[BACKFILL] ${noticeId.slice(0,16)}: Claude found nothing new`)
    }
  } catch (e) {
    console.error(`[BACKFILL] ${noticeId.slice(0,16)}: extraction failed:`, e.message)
  }
}

// Download all PDFs for an opportunity as a ZIP
app.get('/api/reports/opportunity-pdfs/:notice_id', async (req, res) => {
  const { notice_id } = req.params
  const fs = await import('fs')
  const path = await import('path')
  const { execSync } = await import('child_process')

  const pdfDir = path.join(process.cwd(), 'data', 'pdfs', notice_id)
  if (!fs.existsSync(pdfDir)) {
    return res.status(404).json({ error: 'No PDFs available for this opportunity' })
  }

  const files = fs.readdirSync(pdfDir).filter(f => f.endsWith('.pdf'))
  if (!files.length) {
    return res.status(404).json({ error: 'No PDF files found' })
  }

  try {
    const zipPath = `/tmp/awardopedia_${notice_id}.zip`
    execSync(`cd "${pdfDir}" && zip -j "${zipPath}" *.pdf`, { timeout: 30000 })
    res.download(zipPath, `solicitation_${notice_id.slice(0, 8)}.zip`, () => {
      try { fs.unlinkSync(zipPath) } catch {}
    })
  } catch (e) {
    res.status(500).json({ error: 'Failed to create ZIP' })
  }
})

// ═══════════════════════════════════════════════════════════════════
// PUBLIC API v1 — requires API key, rate-limited
// ═══════════════════════════════════════════════════════════════════

const SENDGRID_API_KEY = envVars.SENDGRID_API_KEY || process.env.SENDGRID_API_KEY

// ─── Per-key report generation limiter (10/day) ──────────────────
const reportKeyBuckets = new Map() // key_hash -> { count, dayStart }
function checkReportKeyLimit(keyHash) {
  const now = Date.now()
  let b = reportKeyBuckets.get(keyHash)
  if (!b || now - b.dayStart > 86400000) {
    b = { count: 0, dayStart: now }
    reportKeyBuckets.set(keyHash, b)
  }
  b.count++
  return { allowed: b.count <= 10, count: b.count }
}

// ─── Helpers ─────────────────────────────────────────────────────
function hashKey(plain) {
  return createHash('sha256').update(plain).digest('hex')
}

function apiMeta(extra = {}) {
  return {
    source: 'Awardopedia.com',
    attribution: 'Data from USASpending.gov and SAM.gov, organized by Awardopedia.com. Free federal contract intelligence.',
    api_docs: 'https://awardopedia.com/api',
    ...extra
  }
}

// ─── Rate limiter (in-memory, resets on restart) ─────────────────
const rateBuckets = new Map() // key_hash -> { day: count, dayStart: ts, week: count, weekStart: ts }
const DAY_LIMIT = 1000
const WEEK_LIMIT = 5000

function checkRateLimit(keyHash) {
  const now = Date.now()
  let b = rateBuckets.get(keyHash)
  if (!b) {
    b = { day: 0, dayStart: now, week: 0, weekStart: now }
    rateBuckets.set(keyHash, b)
  }
  // Reset day bucket after 24h
  if (now - b.dayStart > 86400000) { b.day = 0; b.dayStart = now }
  // Reset week bucket after 7 days
  if (now - b.weekStart > 604800000) { b.week = 0; b.weekStart = now }

  if (b.day >= DAY_LIMIT) {
    const retryAfter = Math.ceil((b.dayStart + 86400000 - now) / 1000)
    return { allowed: false, retryAfter, message: `You have reached your daily limit of ${DAY_LIMIT} requests. Limit resets at midnight UTC. To increase your limit, contact api@awardopedia.com` }
  }
  if (b.week >= WEEK_LIMIT) {
    const retryAfter = Math.ceil((b.weekStart + 604800000 - now) / 1000)
    return { allowed: false, retryAfter, message: `You have reached your weekly limit of ${WEEK_LIMIT} requests. To increase your limit, contact api@awardopedia.com` }
  }
  b.day++
  b.week++
  return { allowed: true }
}

// ─── API key auth middleware ─────────────────────────────────────
async function requireApiKey(req, res, next) {
  const key = req.headers['x-awardopedia-key']
  if (!key) {
    return res.status(401).json({ error: 'API key required. Get a free key at https://awardopedia.com/api' })
  }
  const hashed = hashKey(key)
  try {
    const { rows } = await pool.query(
      'SELECT id FROM api_keys WHERE key_hash = $1 AND revoked = false',
      [hashed]
    )
    if (!rows.length) {
      return res.status(403).json({ error: 'Invalid or revoked API key' })
    }
    // Rate limit check
    const rl = checkRateLimit(hashed)
    if (!rl.allowed) {
      res.setHeader('Retry-After', rl.retryAfter)
      return res.status(429).json({ error: 'Rate limit exceeded', message: rl.message, retry_after: rl.retryAfter })
    }
    // Track usage
    pool.query('UPDATE api_keys SET last_used = NOW(), request_count = request_count + 1 WHERE key_hash = $1', [hashed]).catch(() => {})
    next()
  } catch (e) {
    res.status(500).json({ error: 'Auth check failed' })
  }
}

// ─── GET /api/v1/contracts ───────────────────────────────────────
app.get('/api/v1/contracts', apiRateLimit, requireApiKey, validateContractsParams, async (req, res) => {
  try {
    const { agency, naics, state, set_aside, expiring_within_days, min_amount, max_amount, q, page: pg_, limit: lim_ } = req.query
    const page = Math.max(1, parseInt(pg_) || 1)
    const limit = Math.min(100, Math.max(1, parseInt(lim_) || 25))
    const offset = (page - 1) * limit

    const conditions = []
    const params = []
    let idx = 1

    if (agency) { conditions.push(`agency_name ILIKE $${idx}`); params.push(`%${agency}%`); idx++ }
    if (naics) { conditions.push(`naics_code = $${idx}`); params.push(naics); idx++ }
    if (state) { conditions.push(`recipient_state = $${idx}`); params.push(state.toUpperCase()); idx++ }
    if (set_aside) { conditions.push(`set_aside_type ILIKE $${idx}`); params.push(`%${set_aside}%`); idx++ }
    if (expiring_within_days) { conditions.push(`end_date BETWEEN CURRENT_DATE AND CURRENT_DATE + $${idx}::int`); params.push(parseInt(expiring_within_days)); idx++ }
    if (min_amount) { conditions.push(`award_amount >= $${idx}`); params.push(parseFloat(min_amount)); idx++ }
    if (max_amount) { conditions.push(`award_amount <= $${idx}`); params.push(parseFloat(max_amount)); idx++ }
    if (q) { conditions.push(`(description ILIKE $${idx} OR recipient_name ILIKE $${idx} OR agency_name ILIKE $${idx})`); params.push(`%${q}%`); idx++ }

    const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : ''

    // Count total
    const countRes = await pool.query(`SELECT COUNT(*) FROM contracts ${where}`, params)
    const total = parseInt(countRes.rows[0].count)

    // Fetch page
    const dataRes = await pool.query(
      `SELECT piid, award_id, description, naics_code, naics_description, psc_code, llama_summary,
              agency_name, sub_agency_name, office_name, recipient_name, recipient_uei,
              recipient_city, recipient_state, business_size, is_small_business,
              award_amount, base_amount, ceiling_amount, start_date, end_date,
              (end_date - CURRENT_DATE) AS days_to_expiry, set_aside_type, competition_type,
              contract_type, extent_competed, usaspending_url, data_source, last_synced, created_at
       FROM contracts ${where}
       ORDER BY end_date ASC NULLS LAST
       LIMIT $${idx} OFFSET $${idx + 1}`,
      [...params, limit, offset]
    )

    const totalPages = Math.ceil(total / limit)
    res.setHeader('X-Total-Pages', totalPages)
    res.json({
      data: dataRes.rows,
      meta: apiMeta({ last_updated: new Date().toISOString(), total_results: total, page, limit, total_pages: totalPages })
    })
  } catch (e) {
    res.status(500).json({ error: isProd ? 'Internal server error' : e.message })
  }
})

// ─── GET /api/v1/contracts/:piid ─────────────────────────────────
app.get('/api/v1/contracts/:piid', apiRateLimit, requireApiKey, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT *, (end_date - CURRENT_DATE) AS days_to_expiry FROM contracts WHERE piid = $1`,
      [req.params.piid]
    )
    if (!rows.length) return res.status(404).json({ error: 'Contract not found' })
    res.json({
      data: rows[0],
      meta: apiMeta({ last_updated: new Date().toISOString(), total_results: 1, page: 1, limit: 1 })
    })
  } catch (e) {
    res.status(500).json({ error: isProd ? 'Internal server error' : e.message })
  }
})

// ─── GET /api/v1/opportunities ───────────────────────────────────
app.get('/api/v1/opportunities', apiRateLimit, requireApiKey, validateOpportunitiesParams, async (req, res) => {
  try {
    const { agency, naics, state, set_aside, deadline_within_days, is_recompete, q, page: pg_, limit: lim_ } = req.query
    const page = Math.max(1, parseInt(pg_) || 1)
    const limit = Math.min(100, Math.max(1, parseInt(lim_) || 25))
    const offset = (page - 1) * limit

    const conditions = []
    const params = []
    let idx = 1

    if (agency) { conditions.push(`agency_name ILIKE $${idx}`); params.push(`%${agency}%`); idx++ }
    if (naics) { conditions.push(`naics_code = $${idx}`); params.push(naics); idx++ }
    if (state) { conditions.push(`place_of_performance_state = $${idx}`); params.push(state.toUpperCase()); idx++ }
    if (set_aside) { conditions.push(`set_aside_type ILIKE $${idx}`); params.push(`%${set_aside}%`); idx++ }
    if (deadline_within_days) { conditions.push(`response_deadline BETWEEN CURRENT_DATE AND CURRENT_DATE + $${idx}::int`); params.push(parseInt(deadline_within_days)); idx++ }
    if (is_recompete === 'true') { conditions.push('is_recompete = true') }
    if (is_recompete === 'false') { conditions.push('is_recompete = false') }
    if (q) { conditions.push(`(title ILIKE $${idx} OR agency_name ILIKE $${idx} OR description ILIKE $${idx})`); params.push(`%${q}%`); idx++ }

    const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : ''

    const countRes = await pool.query(`SELECT COUNT(*) FROM opportunities ${where}`, params)
    const total = parseInt(countRes.rows[0].count)

    const dataRes = await pool.query(
      `SELECT notice_id, title, solicitation_number, notice_type, agency_name, sub_agency_name,
              office_name, naics_code, naics_description, psc_code, set_aside_type,
              estimated_value_min, estimated_value_max, contract_type,
              posted_date, response_deadline, archive_date,
              (response_deadline - CURRENT_DATE) AS days_to_deadline,
              place_of_performance_city, place_of_performance_state,
              is_recompete, incumbent_name, sam_url, llama_summary,
              data_source, last_synced, created_at
       FROM opportunities ${where}
       ORDER BY response_deadline ASC NULLS LAST
       LIMIT $${idx} OFFSET $${idx + 1}`,
      [...params, limit, offset]
    )

    const totalPages = Math.ceil(total / limit)
    res.setHeader('X-Total-Pages', totalPages)
    res.json({
      data: dataRes.rows,
      meta: apiMeta({ last_updated: new Date().toISOString(), total_results: total, page, limit, total_pages: totalPages })
    })
  } catch (e) {
    res.status(500).json({ error: isProd ? 'Internal server error' : e.message })
  }
})

// ─── GET /api/v1/opportunities/:notice_id ────────────────────────
app.get('/api/v1/opportunities/:notice_id', apiRateLimit, requireApiKey, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT *, (response_deadline - CURRENT_DATE) AS days_to_deadline FROM opportunities WHERE notice_id = $1`,
      [req.params.notice_id]
    )
    if (!rows.length) return res.status(404).json({ error: 'Opportunity not found' })
    res.json({
      data: rows[0],
      meta: apiMeta({ last_updated: new Date().toISOString(), total_results: 1, page: 1, limit: 1 })
    })
  } catch (e) {
    res.status(500).json({ error: isProd ? 'Internal server error' : e.message })
  }
})

// ─── GET /api/v1/stats ───────────────────────────────────────────
app.get('/api/v1/stats', apiRateLimit, requireApiKey, async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT
        (SELECT COUNT(*) FROM contracts) AS total_contracts,
        (SELECT COALESCE(SUM(award_amount), 0) FROM contracts) AS total_obligated,
        (SELECT COUNT(*) FROM opportunities) AS total_opportunities,
        NOW() AS last_updated
    `)
    res.json({
      data: rows[0],
      meta: apiMeta({ last_updated: rows[0].last_updated })
    })
  } catch (e) {
    res.status(500).json({ error: isProd ? 'Internal server error' : e.message })
  }
})

// ─── POST /api/v1/register — API key registration ───────────────
app.post('/api/v1/register', registerRateLimit, async (req, res) => {
  const { name, email, organization, use_case } = req.body
  if (!name || !email || !use_case) {
    return res.status(400).json({ error: 'name, email, and use_case are required' })
  }
  // Basic email validation
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ error: 'Invalid email address' })
  }

  try {
    // Check for existing key with this email
    const { rows: existing } = await pool.query(
      'SELECT id FROM api_keys WHERE email = $1 AND revoked = false',
      [email]
    )
    if (existing.length) {
      return res.status(409).json({ error: 'An API key already exists for this email. Contact api@awardopedia.com to recover it.' })
    }

    // Generate key: aw_live_ prefix + 32 random hex chars
    const plainKey = 'aw_live_' + randomBytes(16).toString('hex')
    const keyHash = hashKey(plainKey)
    const keyPrefix = plainKey.slice(0, 16) // Store first 16 chars for support/display

    // Try with key_prefix column first, fall back without it (column may not exist yet)
    try {
      await pool.query(
        `INSERT INTO api_keys (key_hash, key_prefix, name, email, organization, use_case, created_at, last_used, request_count, revoked)
         VALUES ($1, $2, $3, $4, $5, $6, NOW(), NULL, 0, false)`,
        [keyHash, keyPrefix, name, email, organization || null, use_case]
      )
    } catch (insertErr) {
      if (insertErr.message.includes('key_prefix')) {
        // Column doesn't exist yet — insert without it
        await pool.query(
          `INSERT INTO api_keys (key_hash, name, email, organization, use_case, created_at, last_used, request_count, revoked)
           VALUES ($1, $2, $3, $4, $5, NOW(), NULL, 0, false)`,
          [keyHash, name, email, organization || null, use_case]
        )
      } else {
        throw insertErr
      }
    }

    // Send email with key (if SendGrid configured)
    if (SENDGRID_API_KEY) {
      try {
        const sgRes = await fetch('https://api.sendgrid.com/v3/mail/send', {
          method: 'POST',
          headers: { Authorization: `Bearer ${SENDGRID_API_KEY}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            personalizations: [{ to: [{ email, name }] }],
            from: { email: 'api@awardopedia.com', name: 'Awardopedia' },
            subject: 'Your Awardopedia API Key',
            content: [{
              type: 'text/plain',
              value: `Hi ${name},\n\nYour Awardopedia API key is:\n\n${plainKey}\n\nPass it via the X-Awardopedia-Key header.\n\nBase URL: https://api.awardopedia.com/v1/\nDocs: https://awardopedia.com/api\nRate limits: 1,000 req/day, 5,000 req/week\n\nHappy building!\n— Awardopedia`
            }]
          })
        })
        if (!sgRes.ok) console.error('SendGrid error:', sgRes.status, await sgRes.text())
      } catch (sgErr) {
        console.error('SendGrid send failed:', sgErr.message)
      }
    } else {
      console.log('[API Key] SendGrid not configured — key generated but email not sent. Key:', plainKey.slice(0, 8) + '...')
    }

    res.json({ api_key: plainKey, message: 'Key generated successfully. Store it securely — it cannot be recovered.' })
  } catch (e) {
    console.error('Registration error:', e)
    res.status(500).json({ error: isProd ? 'Internal server error' : e.message })
  }
})

// ═══════════════════════════════════════════════════════════════════════════
// ─── Agent API — LLM/AI-friendly endpoint with stricter rate limits ────────
// ═══════════════════════════════════════════════════════════════════════════

// Agent rate limiter — 10 searches per day per key
const agentRateBuckets = new Map() // key_hash -> { count: n, dayStart: ts }
const AGENT_DAILY_LIMIT = 10

function checkAgentRateLimit(keyHash) {
  const now = Date.now()
  let b = agentRateBuckets.get(keyHash)
  if (!b) {
    b = { count: 0, dayStart: now }
    agentRateBuckets.set(keyHash, b)
  }
  // Reset after 24 hours
  if (now - b.dayStart > 86400000) {
    b.count = 0
    b.dayStart = now
  }
  if (b.count >= AGENT_DAILY_LIMIT) {
    const retryAfter = Math.ceil((b.dayStart + 86400000 - now) / 1000)
    return {
      allowed: false,
      remaining: 0,
      retryAfter,
      message: `You have reached your daily limit of ${AGENT_DAILY_LIMIT} agent searches. Limit resets in ${Math.ceil(retryAfter / 3600)} hours.`
    }
  }
  b.count++
  return { allowed: true, remaining: AGENT_DAILY_LIMIT - b.count }
}

// Agent API key auth — uses X-API-Key header
async function requireAgentApiKey(req, res, next) {
  const key = req.headers['x-api-key'] || req.headers['x-awardopedia-key']
  if (!key) {
    return res.status(401).json({
      error: 'API key required',
      message: 'Get a free API key at https://awardopedia.com/signup',
      docs: 'https://awardopedia.com/llms.txt'
    })
  }
  const hashed = hashKey(key)
  try {
    // Try member-linked keys first (new system), fall back to email-based (legacy)
    let { rows } = await pool.query(
      'SELECT id, member_id FROM api_keys WHERE key_hash = $1 AND is_active = true',
      [hashed]
    )
    if (!rows.length) {
      // Fallback to legacy table structure
      const legacy = await pool.query(
        'SELECT id FROM api_keys WHERE key_hash = $1 AND revoked = false',
        [hashed]
      )
      rows = legacy.rows
    }
    if (!rows.length) {
      return res.status(403).json({ error: 'Invalid or revoked API key' })
    }
    // Rate limit check
    const rl = checkAgentRateLimit(hashed)
    if (!rl.allowed) {
      res.setHeader('Retry-After', rl.retryAfter)
      return res.status(429).json({
        error: 'Rate limit exceeded',
        message: rl.message,
        daily_limit: AGENT_DAILY_LIMIT,
        retry_after_seconds: rl.retryAfter
      })
    }
    req.apiKeyId = rows[0].id
    req.apiKeyHash = hashed
    req.rateLimit = { remaining: rl.remaining, limit: AGENT_DAILY_LIMIT }
    next()
  } catch (e) {
    console.error('Agent API auth error:', e)
    res.status(500).json({ error: 'Authentication check failed' })
  }
}

// GET /api/agent/search — AI-friendly opportunity search
app.get('/api/agent/search', requireAgentApiKey, async (req, res) => {
  const { q, naics, state, set_aside, limit: lim_ } = req.query
  const limit = Math.min(25, Math.max(1, parseInt(lim_) || 10))

  try {
    const conditions = ["response_deadline > NOW()"]
    const params = []
    let idx = 1

    if (q) {
      conditions.push(`(title ILIKE $${idx} OR llama_summary ILIKE $${idx} OR agency_name ILIKE $${idx})`)
      params.push(`%${q}%`)
      idx++
    }
    if (naics) {
      conditions.push(`naics_code = $${idx}`)
      params.push(naics)
      idx++
    }
    if (state) {
      conditions.push(`place_of_performance_state = $${idx}`)
      params.push(state.toUpperCase())
      idx++
    }
    if (set_aside) {
      conditions.push(`set_aside_type ILIKE $${idx}`)
      params.push(`%${set_aside}%`)
      idx++
    }

    params.push(limit)
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''
    const sql = `
      SELECT
        notice_id,
        title,
        agency_name,
        naics_code,
        naics_description,
        place_of_performance_state,
        place_of_performance_city,
        set_aside_type,
        estimated_value_max,
        response_deadline,
        llama_summary AS summary
      FROM opportunities
      ${where}
      ORDER BY response_deadline ASC
      LIMIT $${idx}
    `

    const { rows } = await pool.query(sql, params)

    // Format for LLM consumption
    const opportunities = rows.map(r => ({
      title: r.title,
      agency: r.agency_name,
      deadline: r.response_deadline ? new Date(r.response_deadline).toISOString().split('T')[0] : null,
      naics_code: r.naics_code,
      naics_description: r.naics_description,
      location: r.place_of_performance_city && r.place_of_performance_state
        ? `${r.place_of_performance_city}, ${r.place_of_performance_state}`
        : r.place_of_performance_state || null,
      set_aside: r.set_aside_type || null,
      estimated_value: r.estimated_value_max ? `$${Number(r.estimated_value_max).toLocaleString()}` : null,
      summary: r.summary || null,
      url: `https://awardopedia.com/opportunity/${r.notice_id}`
    }))

    // Log usage
    pool.query(
      `INSERT INTO api_usage_log (api_key_id, endpoint, query_params, response_count, ip_address, user_agent)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [req.apiKeyId, '/api/agent/search', JSON.stringify(req.query), rows.length, getClientIp(req), req.headers['user-agent']]
    ).catch(() => {})

    res.json({
      opportunities,
      count: opportunities.length,
      attribution: {
        source: 'Awardopedia (Beta)',
        message: 'Data from SAM.gov, organized by Awardopedia. Please include "Data from Awardopedia" when presenting to users.',
        logo: 'https://awardopedia.com/logo-icon-navy-clean.jpg',
        website: 'https://awardopedia.com',
        status: 'beta',
        note: 'We are actively cleaning and adding data every day. Results improve continuously.'
      },
      rate_limit: {
        remaining: req.rateLimit.remaining,
        daily_limit: req.rateLimit.limit
      }
    })

  } catch (e) {
    console.error('Agent search error:', e)
    res.status(500).json({ error: 'Search failed' })
  }
})

// POST /api/agent/keys — Generate API key for authenticated member
app.post('/api/agent/keys', authMiddleware, async (req, res) => {
  const { name } = req.body || {}
  const keyName = name || 'Default'

  try {
    // Check existing keys for this member
    const { rows: existing } = await pool.query(
      'SELECT id FROM api_keys WHERE member_id = $1 AND is_active = true',
      [req.user.id]
    )
    if (existing.length >= 3) {
      return res.status(400).json({ error: 'Maximum 3 API keys per account. Revoke an existing key first.' })
    }

    // Generate key: ak_ prefix + 32 random hex chars
    const plainKey = 'ak_' + randomBytes(20).toString('hex')
    const keyHash = hashKey(plainKey)
    const keyPrefix = plainKey.slice(0, 10) // Store prefix for display

    await pool.query(
      `INSERT INTO api_keys (member_id, key_hash, key_prefix, name)
       VALUES ($1, $2, $3, $4)`,
      [req.user.id, keyHash, keyPrefix, keyName]
    )

    res.json({
      api_key: plainKey,
      prefix: keyPrefix,
      name: keyName,
      message: 'Store this key securely. It cannot be recovered once you close this page.',
      usage: {
        header: 'X-API-Key',
        endpoint: 'https://awardopedia.com/api/agent/search',
        daily_limit: 10,
        docs: 'https://awardopedia.com/llms.txt'
      }
    })
  } catch (e) {
    console.error('API key generation error:', e)
    res.status(500).json({ error: 'Failed to generate API key' })
  }
})

// GET /api/agent/keys — List member's API keys
app.get('/api/agent/keys', authMiddleware, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, key_prefix, name, is_active, created_at, last_used_at, searches_today
       FROM api_keys WHERE member_id = $1 ORDER BY created_at DESC`,
      [req.user.id]
    )
    res.json({ keys: rows })
  } catch (e) {
    res.status(500).json({ error: 'Failed to fetch API keys' })
  }
})

// DELETE /api/agent/keys/:id — Revoke an API key
app.delete('/api/agent/keys/:id', authMiddleware, async (req, res) => {
  try {
    const { rowCount } = await pool.query(
      'UPDATE api_keys SET is_active = false WHERE id = $1 AND member_id = $2',
      [req.params.id, req.user.id]
    )
    if (!rowCount) return res.status(404).json({ error: 'Key not found' })
    res.json({ ok: true })
  } catch (e) {
    res.status(500).json({ error: 'Failed to revoke key' })
  }
})

// ═══════════════════════════════════════════════════════════════════════════
// ─── Ask AI — Natural language search via Claude ────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════

// Rate limit for AI search (in-memory, 20 queries per IP per hour)
const aiSearchBuckets = new Map()
function checkAiSearchLimit(ip) {
  const now = Date.now()
  let b = aiSearchBuckets.get(ip)
  if (!b || now - b.start > 3600000) {
    b = { count: 0, start: now }
    aiSearchBuckets.set(ip, b)
  }
  if (b.count >= 20) return false
  b.count++
  return true
}

app.post('/api/ai/search', apiRateLimit, async (req, res) => {
  const { query } = req.body
  if (!query || query.length < 3) {
    return res.status(400).json({ error: 'Please enter a search query' })
  }
  if (query.length > 500) {
    return res.status(400).json({ error: 'Query too long (max 500 characters)' })
  }

  const ip = getClientIp(req)
  if (!checkAiSearchLimit(ip)) {
    return res.status(429).json({ error: 'Rate limit reached. Try again in an hour.' })
  }

  try {
    // Call Claude to understand the query and generate SQL-friendly filters
    const parsePrompt = `You are helping search a federal contracts database. Parse this user query and extract search parameters.

User query: "${query}"

Extract these fields if mentioned (return null if not mentioned):
- keywords: search terms for title/description
- state: two-letter state code (e.g., "VA", "CA")
- naics: NAICS code if mentioned (6 digits)
- set_aside: set-aside type (SBA, SDVOSB, WOSB, 8A, HUBZone)
- max_value: maximum contract value mentioned
- days_until_due: if they mention deadline timing

Return ONLY valid JSON:
{"keywords": "...", "state": "...", "naics": "...", "set_aside": "...", "max_value": null, "days_until_due": null}`

    const parseRes = await fetch('http://localhost:3456/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'claude-sonnet-4',
        max_tokens: 500,
        messages: [{ role: 'user', content: parsePrompt }]
      })
    })

    if (!parseRes.ok) {
      throw new Error('Claude proxy not available')
    }

    const parseData = await parseRes.json()
    let filters = {}
    try {
      const raw = parseData.choices[0].message.content.trim()
      filters = JSON.parse(raw.replace(/```json\n?|\n?```/g, ''))
    } catch (e) {
      filters = { keywords: query }
    }

    // Build SQL query
    const conditions = ["response_deadline > NOW()"]
    const params = []
    let idx = 1

    if (filters.keywords) {
      conditions.push(`(title ILIKE $${idx} OR llama_summary ILIKE $${idx} OR agency_name ILIKE $${idx})`)
      params.push(`%${filters.keywords}%`)
      idx++
    }
    if (filters.state) {
      conditions.push(`place_of_performance_state = $${idx}`)
      params.push(filters.state.toUpperCase())
      idx++
    }
    if (filters.naics) {
      conditions.push(`naics_code = $${idx}`)
      params.push(filters.naics)
      idx++
    }
    if (filters.set_aside) {
      conditions.push(`set_aside_type ILIKE $${idx}`)
      params.push(`%${filters.set_aside}%`)
      idx++
    }
    if (filters.max_value) {
      conditions.push(`estimated_value_max <= $${idx}`)
      params.push(parseFloat(filters.max_value))
      idx++
    }
    if (filters.days_until_due) {
      conditions.push(`response_deadline <= NOW() + INTERVAL '${parseInt(filters.days_until_due)} days'`)
    }

    const sql = `
      SELECT notice_id, title, agency_name, naics_code, naics_description,
             place_of_performance_state, place_of_performance_city,
             set_aside_type, estimated_value_max, response_deadline, llama_summary
      FROM opportunities
      WHERE ${conditions.join(' AND ')}
      ORDER BY response_deadline ASC
      LIMIT 10
    `

    const { rows } = await pool.query(sql, params)

    // Generate conversational response
    let response = ''
    if (rows.length === 0) {
      response = `I couldn't find any opportunities matching "${query}". Try broadening your search or checking different criteria.`
    } else {
      const summaryPrompt = `You found ${rows.length} federal contract opportunities for: "${query}"

Results summary:
${rows.slice(0, 5).map((r, i) => `${i + 1}. ${r.title} - ${r.agency_name} (Due: ${r.response_deadline ? new Date(r.response_deadline).toLocaleDateString() : 'TBD'})`).join('\n')}

Write a brief (2-3 sentence) conversational summary of what you found. Be helpful and mention key details like agencies, deadlines, or set-asides if relevant. Don't list all results - the user will see the cards.`

      const summaryRes = await fetch('http://localhost:3456/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'claude-sonnet-4',
          max_tokens: 300,
          messages: [{ role: 'user', content: summaryPrompt }]
        })
      })

      if (summaryRes.ok) {
        const summaryData = await summaryRes.json()
        response = summaryData.choices[0].message.content.trim()
      } else {
        response = `Found ${rows.length} opportunities matching your search. Here are the results:`
      }
    }

    res.json({
      response,
      opportunities: rows,
      filters_used: filters
    })

  } catch (e) {
    console.error('AI search error:', e)
    res.status(500).json({ error: 'Search failed. Please try again.' })
  }
})

// ── Sitemap (dynamic, served at awardopedia.com/sitemap.xml) ─────────────────
app.get('/sitemap.xml', async (req, res) => {
  try {
    const contracts = await query(
      "SELECT piid, updated_at FROM contracts WHERE is_active = true ORDER BY updated_at DESC"
    )
    const opps = await query(
      "SELECT notice_id, updated_at FROM opportunities ORDER BY updated_at DESC"
    )
    const today = new Date().toISOString().split('T')[0]
    const urls = [
      `  <url><loc>https://awardopedia.com</loc><lastmod>${today}</lastmod><priority>1.0</priority></url>`,
      `  <url><loc>https://awardopedia.com/api</loc><lastmod>${today}</lastmod><priority>0.8</priority></url>`,
      ...contracts.rows.map(r => {
        const d = r.updated_at ? new Date(r.updated_at).toISOString().split('T')[0] : today
        return `  <url><loc>https://awardopedia.com/contracts/${r.piid}</loc><lastmod>${d}</lastmod><priority>0.8</priority></url>`
      }),
      ...opps.rows.map(r => {
        const d = r.updated_at ? new Date(r.updated_at).toISOString().split('T')[0] : today
        return `  <url><loc>https://awardopedia.com/opportunities/${r.notice_id}</loc><lastmod>${d}</lastmod><priority>0.7</priority></url>`
      })
    ]
    const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join('\n')}\n</urlset>`
    res.setHeader('Content-Type', 'application/xml')
    res.setHeader('Cache-Control', 'public, max-age=3600')
    res.send(xml)
  } catch (e) {
    res.status(500).send('<!-- sitemap error -->')
  }
})

// ─── Social share preview for opportunities ────────────────────────────────
// Returns HTML with proper OG tags for social platforms (iMessage, etc.)
app.get('/opportunity/:notice_id', async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT title, agency_name, llama_summary, naics_description, response_deadline
      FROM opportunities WHERE notice_id = $1
    `, [req.params.notice_id])

    if (!rows.length) {
      return res.redirect('https://awardopedia.com')
    }

    const opp = rows[0]
    const title = opp.title || 'Federal Contract Opportunity'
    const desc = opp.llama_summary
      ? opp.llama_summary.slice(0, 200) + '...'
      : `${opp.agency_name || 'Government'} opportunity in ${opp.naics_description || 'federal contracting'}`
    const url = `https://awardopedia.com/opportunity/${req.params.notice_id}`

    // Return HTML that redirects to the SPA but has proper OG tags
    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title} | Awardopedia</title>
  <meta name="description" content="${desc.replace(/"/g, '&quot;')}">
  <meta property="og:type" content="website">
  <meta property="og:url" content="${url}">
  <meta property="og:title" content="${title.replace(/"/g, '&quot;')}">
  <meta property="og:description" content="${desc.replace(/"/g, '&quot;')}">
  <meta property="og:site_name" content="Awardopedia">
  <meta name="twitter:card" content="summary">
  <meta name="twitter:title" content="${title.replace(/"/g, '&quot;')}">
  <meta name="twitter:description" content="${desc.replace(/"/g, '&quot;')}">
  <script>window.location.href = "${url}";</script>
</head>
<body>
  <p>Redirecting to <a href="${url}">${title}</a>...</p>
</body>
</html>`

    res.setHeader('Content-Type', 'text/html')
    res.send(html)
  } catch (e) {
    res.redirect('https://awardopedia.com')
  }
})

app.listen(PORT, () => {
  console.log(`Awardopedia API running on http://localhost:${PORT}`)
})
