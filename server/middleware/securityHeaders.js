const isDev = process.env.NODE_ENV !== 'production'

function securityHeaders(req, res, next) {
  // Remove Express fingerprint
  res.removeHeader('X-Powered-By')

  // Security headers on all responses
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.setHeader('X-Frame-Options', 'DENY')
  res.setHeader('X-XSS-Protection', '1; mode=block')
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin')

  // CORS for API responses — restrict in production
  if (req.path.startsWith('/api/')) {
    const allowedOrigins = isDev
      ? ['http://localhost:5173', 'http://localhost:3001']
      : ['https://awardopedia.com', 'https://www.awardopedia.com']
    const origin = req.headers.origin
    if (origin && allowedOrigins.includes(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin)
    } else if (!isDev) {
      res.setHeader('Access-Control-Allow-Origin', 'https://awardopedia.com')
    }
  }

  next()
}

export default securityHeaders
