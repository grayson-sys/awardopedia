import { trackRateLimitHit } from './abuseLog.js'

// Per-IP rate limiting — independent of API key
// Buckets: { count, windowStart }
const ipBuckets = new Map()  // ip:category -> bucket

function getClientIp(req) {
  return req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket.remoteAddress || 'unknown'
}

function checkIpRate(ip, category, maxRequests, windowMs) {
  const key = `${ip}:${category}`
  const now = Date.now()
  let bucket = ipBuckets.get(key)

  if (!bucket || now - bucket.windowStart > windowMs) {
    bucket = { count: 0, windowStart: now }
    ipBuckets.set(key, bucket)
  }

  bucket.count++

  if (bucket.count > maxRequests) {
    const retryAfter = Math.ceil((bucket.windowStart + windowMs - now) / 1000)
    trackRateLimitHit(ip)
    console.log(`RATE LIMIT: ${ip} → ${category} (${bucket.count}/${maxRequests} per ${windowMs / 1000}s)`)
    return { allowed: false, retryAfter }
  }

  return { allowed: true }
}

// /api/v1/* — 200 req/hour per IP
function apiRateLimit(req, res, next) {
  const ip = getClientIp(req)
  const result = checkIpRate(ip, 'api', 200, 3600000)
  if (!result.allowed) {
    res.setHeader('Retry-After', result.retryAfter)
    return res.status(429).json({ error: 'Too many requests. Try again later.', retry_after: result.retryAfter })
  }
  next()
}

// /api/v1/register — 3 req/day per IP
function registerRateLimit(req, res, next) {
  const ip = getClientIp(req)
  const result = checkIpRate(ip, 'register', 3, 86400000)
  if (!result.allowed) {
    res.setHeader('Retry-After', result.retryAfter)
    return res.status(429).json({ error: 'Too many registration attempts. Try again tomorrow.', retry_after: result.retryAfter })
  }
  next()
}

// /api/reports/generate* — 5 req/hour per IP
function reportRateLimit(req, res, next) {
  const ip = getClientIp(req)
  const result = checkIpRate(ip, 'report', 5, 3600000)
  if (!result.allowed) {
    res.setHeader('Retry-After', result.retryAfter)
    return res.status(429).json({ error: 'Report generation rate limit exceeded. Try again later.', retry_after: result.retryAfter })
  }
  next()
}

// Cleanup stale buckets every 10 minutes
setInterval(() => {
  const now = Date.now()
  for (const [key, bucket] of ipBuckets) {
    if (now - bucket.windowStart > 86400000) {
      ipBuckets.delete(key)
    }
  }
}, 600000)

export { getClientIp, apiRateLimit, registerRateLimit, reportRateLimit }
