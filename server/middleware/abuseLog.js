import { appendFileSync, mkdirSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const LOG_DIR = resolve(__dirname, '../../logs')
const LOG_FILE = resolve(LOG_DIR, 'abuse.log')

// Ensure logs directory exists
try { mkdirSync(LOG_DIR, { recursive: true }) } catch {}

// Track repeat offenders: IP -> { count, firstHit }
const repeatOffenders = new Map()

function logAbuse(entry) {
  const line = JSON.stringify({
    timestamp: new Date().toISOString(),
    ...entry
  })
  try {
    appendFileSync(LOG_FILE, line + '\n')
  } catch (e) {
    console.error('Abuse log write failed:', e.message)
  }
}

function trackRateLimitHit(ip) {
  const now = Date.now()
  let record = repeatOffenders.get(ip)
  if (!record || now - record.firstHit > 3600000) {
    record = { count: 0, firstHit: now }
    repeatOffenders.set(ip, record)
  }
  record.count++
  if (record.count >= 3) {
    logAbuse({
      type: 'repeat_rate_limit',
      ip,
      hits_in_hour: record.count,
      message: `IP ${ip} hit rate limit ${record.count}x in 1 hour`
    })
  }
}

function logHoneypot(ip, path) {
  console.log(`HONEYPOT HIT: ${ip} → ${path} at ${new Date().toISOString()}`)
  logAbuse({ type: 'honeypot', ip, path })
}

function logDeepPagination(ip, endpoint, page, keyPrefix) {
  logAbuse({ type: 'deep_pagination', ip, endpoint, page, key_prefix: keyPrefix || null })
}

function logReportGeneration(keyPrefix, recordId, ip) {
  logAbuse({ type: 'report_generation', ip, key_prefix: keyPrefix, record_id: recordId })
}

function logExcessReports(keyPrefix, count, ip) {
  logAbuse({
    type: 'excess_reports',
    ip,
    key_prefix: keyPrefix,
    reports_today: count,
    message: `Key ${keyPrefix}... generated ${count}+ reports in 1 day`
  })
}

export {
  logAbuse,
  trackRateLimitHit,
  logHoneypot,
  logDeepPagination,
  logReportGeneration,
  logExcessReports
}
