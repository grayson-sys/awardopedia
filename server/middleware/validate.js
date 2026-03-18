import { logDeepPagination } from './abuseLog.js'
import { getClientIp } from './rateLimit.js'

// Valid US state codes
const STATE_CODES = new Set([
  'AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID','IL','IN','IA',
  'KS','KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ',
  'NM','NY','NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT','VT',
  'VA','WA','WV','WI','WY','DC','PR','VI','GU','AS','MP'
])

// Known set-aside types
const SET_ASIDE_VALUES = new Set([
  'small business', 'sba', '8(a)', 'hubzone', 'sdvosb', 'wosb', 'edwosb',
  'service-disabled', 'veteran', 'women-owned', 'total small business',
  'partial small business', 'none', 'no set aside used'
])

// Strip dangerous SQL chars from search strings
function sanitizeSearch(str) {
  return str.replace(/[;'"\\`\x00-\x1f]/g, '').trim()
}

// Validate contracts query params
function validateContractsParams(req, res, next) {
  const allowed = new Set(['agency', 'naics', 'state', 'set_aside', 'expiring_within_days', 'min_amount', 'max_amount', 'q', 'page', 'limit'])
  const errors = []

  // Reject unrecognized params
  for (const key of Object.keys(req.query)) {
    if (!allowed.has(key)) {
      errors.push(`Unknown parameter: ${key}`)
    }
  }

  const { agency, naics, state, set_aside, expiring_within_days, min_amount, max_amount, q, page, limit } = req.query

  if (q !== undefined) {
    if (q.length > 200) errors.push('q: max 200 characters')
    else req.query.q = sanitizeSearch(q)
  }
  if (agency !== undefined) {
    if (agency.length > 100) errors.push('agency: max 100 characters')
    else if (!/^[a-zA-Z0-9\s\-.,()&/]+$/.test(agency)) errors.push('agency: invalid characters')
    else req.query.agency = sanitizeSearch(agency)
  }
  if (naics !== undefined) {
    if (!/^\d{2,6}$/.test(naics)) errors.push('naics: must be 2-6 digit code')
  }
  if (state !== undefined) {
    const upper = state.toUpperCase()
    if (!STATE_CODES.has(upper)) errors.push('state: must be valid 2-letter US state code')
    else req.query.state = upper
  }
  if (set_aside !== undefined) {
    if (!SET_ASIDE_VALUES.has(set_aside.toLowerCase())) {
      errors.push('set_aside: unrecognized value')
    }
  }
  if (min_amount !== undefined) {
    const n = parseInt(min_amount)
    if (isNaN(n) || n < 0) errors.push('min_amount: must be a positive integer')
  }
  if (max_amount !== undefined) {
    const n = parseInt(max_amount)
    if (isNaN(n) || n < 0) errors.push('max_amount: must be a positive integer')
  }
  if (expiring_within_days !== undefined) {
    const n = parseInt(expiring_within_days)
    if (isNaN(n) || n < 1 || n > 365) errors.push('expiring_within_days: must be integer 1-365')
  }
  if (limit !== undefined) {
    const n = parseInt(limit)
    if (isNaN(n) || n < 1 || n > 100) errors.push('limit: must be integer 1-100')
  }
  if (page !== undefined) {
    const n = parseInt(page)
    if (isNaN(n) || n < 1) {
      errors.push('page: must be a positive integer')
    } else if (n > 10) {
      const ip = getClientIp(req)
      logDeepPagination(ip, req.path, n, req.headers['x-awardopedia-key']?.slice(0, 8))
      return res.status(403).json({
        error: 'Bulk data access is not permitted via the public API. For research use contact api@awardopedia.com'
      })
    }
  }

  if (errors.length) return res.status(400).json({ error: 'Invalid parameters', details: errors })
  next()
}

// Validate opportunities query params
function validateOpportunitiesParams(req, res, next) {
  const allowed = new Set(['agency', 'naics', 'state', 'set_aside', 'deadline_within_days', 'is_recompete', 'q', 'page', 'limit'])
  const errors = []

  for (const key of Object.keys(req.query)) {
    if (!allowed.has(key)) {
      errors.push(`Unknown parameter: ${key}`)
    }
  }

  const { agency, naics, state, set_aside, deadline_within_days, is_recompete, q, page, limit } = req.query

  if (q !== undefined) {
    if (q.length > 200) errors.push('q: max 200 characters')
    else req.query.q = sanitizeSearch(q)
  }
  if (agency !== undefined) {
    if (agency.length > 100) errors.push('agency: max 100 characters')
    else if (!/^[a-zA-Z0-9\s\-.,()&/]+$/.test(agency)) errors.push('agency: invalid characters')
    else req.query.agency = sanitizeSearch(agency)
  }
  if (naics !== undefined) {
    if (!/^\d{2,6}$/.test(naics)) errors.push('naics: must be 2-6 digit code')
  }
  if (state !== undefined) {
    const upper = state.toUpperCase()
    if (!STATE_CODES.has(upper)) errors.push('state: must be valid 2-letter US state code')
    else req.query.state = upper
  }
  if (set_aside !== undefined) {
    if (!SET_ASIDE_VALUES.has(set_aside.toLowerCase())) {
      errors.push('set_aside: unrecognized value')
    }
  }
  if (deadline_within_days !== undefined) {
    const n = parseInt(deadline_within_days)
    if (isNaN(n) || n < 1 || n > 365) errors.push('deadline_within_days: must be integer 1-365')
  }
  if (is_recompete !== undefined) {
    if (is_recompete !== 'true' && is_recompete !== 'false') errors.push('is_recompete: must be true or false')
  }
  if (limit !== undefined) {
    const n = parseInt(limit)
    if (isNaN(n) || n < 1 || n > 100) errors.push('limit: must be integer 1-100')
  }
  if (page !== undefined) {
    const n = parseInt(page)
    if (isNaN(n) || n < 1) {
      errors.push('page: must be a positive integer')
    } else if (n > 10) {
      const ip = getClientIp(req)
      logDeepPagination(ip, req.path, n, req.headers['x-awardopedia-key']?.slice(0, 8))
      return res.status(403).json({
        error: 'Bulk data access is not permitted via the public API. For research use contact api@awardopedia.com'
      })
    }
  }

  if (errors.length) return res.status(400).json({ error: 'Invalid parameters', details: errors })
  next()
}

export { validateContractsParams, validateOpportunitiesParams }
