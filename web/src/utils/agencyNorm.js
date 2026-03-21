/**
 * agencyNorm.js — Canonical agency name normalization for Awardopedia
 *
 * Problem: Two raw formats exist in the DB:
 *   SAM.gov (opportunities): "AGRICULTURE, DEPARTMENT OF" or "DEPT OF DEFENSE"
 *   USASpending (contracts): "Department of Agriculture"
 *
 * Solution: uninvert → abbreviate. DB stays raw. Display layer normalizes.
 *
 * Usage:
 *   import { normalizeAgency, parseAgencyHierarchy } from '../utils/agencyNorm'
 *
 *   normalizeAgency("AGRICULTURE, DEPARTMENT OF")  → "USDA"
 *   normalizeAgency("Department of Agriculture")   → "USDA"
 *   normalizeAgency("INTERIOR, DEPARTMENT OF THE") → "Dept. of the Interior"
 *
 *   parseAgencyHierarchy("AGRICULTURE, DEPARTMENT OF.FOREST SERVICE.White River NF")
 *   → { agency: "USDA", office: "White River National Forest" }
 */

// ── Step 1: Uninvert SAM.gov inverted names ───────────────────────────────────
// "AGRICULTURE, DEPARTMENT OF"      → "Department of Agriculture"
// "INTERIOR, DEPARTMENT OF THE"     → "Department of the Interior"
// "VETERANS AFFAIRS, DEPARTMENT OF" → "Department of Veterans Affairs"
// "DEPT OF DEFENSE"                 → "Department of Defense"
// "Department of Agriculture"       → unchanged (already normal)

function toTitleCase(str) {
  const LOWER = new Set(['of', 'the', 'and', 'for', 'in', 'at', 'by', 'to'])
  return str
    .toLowerCase()
    .split(' ')
    .map((w, i) => (i === 0 || !LOWER.has(w)) ? w.charAt(0).toUpperCase() + w.slice(1) : w)
    .join(' ')
}

function uninvert(raw) {
  if (!raw) return ''
  raw = raw.trim()

  // Already in normal format (mixed case, starts with "Department")
  if (/^[A-Z][a-z]/.test(raw)) return raw

  // "DEPT OF X" → "Department of X"
  if (/^DEPT\s+OF\s+THE\s+/i.test(raw)) {
    const entity = raw.replace(/^DEPT\s+OF\s+THE\s+/i, '')
    return `Department of the ${toTitleCase(entity)}`
  }
  if (/^DEPT\s+OF\s+/i.test(raw)) {
    const entity = raw.replace(/^DEPT\s+OF\s+/i, '')
    return `Department of ${toTitleCase(entity)}`
  }

  // "X, DEPARTMENT OF THE" → "Department of the X"
  const mThe = raw.match(/^(.+?),?\s+DEPARTMENT\s+OF\s+THE\s*$/i)
  if (mThe) return `Department of the ${toTitleCase(mThe[1].trim())}`

  // "X, DEPARTMENT OF" → "Department of X"
  const m = raw.match(/^(.+?),?\s+DEPARTMENT\s+OF\s*$/i)
  if (m) return `Department of ${toTitleCase(m[1].trim())}`

  // All-caps fallback → title case
  if (raw === raw.toUpperCase()) return toTitleCase(raw)

  return raw
}

// ── Step 2: Abbreviation map ──────────────────────────────────────────────────
// Keys are the uninverted (normal-format) name.
// Values are what the user sees.

const ABBREV = {
  // Cabinet departments
  'Department of Agriculture':                  'USDA',
  'Department of Commerce':                     'Dept. of Commerce',
  'Department of Defense':                      'Defense Department',
  'Department of Education':                    'Dept. of Education',
  'Department of Energy':                       'Dept. of Energy',
  'Department of Health and Human Services':    'HHS',
  'Department of Homeland Security':            'DHS',
  'Department of Housing and Urban Development':'HUD',
  'Department of Justice':                      'Dept. of Justice',
  'Department of Labor':                        'Dept. of Labor',
  'Department of State':                        'Dept. of State',
  'Department of the Interior':                 'Dept. of the Interior',
  'Department of the Treasury':                 'Dept. of the Treasury',
  'Department of Transportation':               'Dept. of Transportation',
  'Department of Veterans Affairs':             'Veterans Affairs',

  // Independent agencies
  'Agency for International Development':       'USAID',
  'Environmental Protection Agency':            'EPA',
  'Federal Communications Commission':          'FCC',
  'General Services Administration':            'GSA',
  'National Aeronautics and Space Administration': 'NASA',
  'National Science Foundation':                'NSF',
  'Nuclear Regulatory Commission':              'NRC',
  'Office of Personnel Management':             'OPM',
  'Small Business Administration':              'SBA',
  'Social Security Administration':             'SSA',
  'US Army Corps of Engineers':                 'Army Corps of Engineers',
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Normalize any raw agency name to a human-readable display name.
 * Works on both SAM.gov and USASpending formats.
 */
export function normalizeAgency(raw) {
  if (!raw) return '—'
  const normal = uninvert(raw)
  return ABBREV[normal] || normal
}

/**
 * Parse a SAM.gov dot-delimited agency hierarchy string and return
 * a normalized { agency, office } pair for display.
 *
 * Input:  "AGRICULTURE, DEPARTMENT OF.FOREST SERVICE.White River National Forest"
 * Output: { agency: "USDA", office: "White River National Forest" }
 *
 * Also handles USASpending single-segment strings (no dots).
 */
export function parseAgencyHierarchy(raw) {
  if (!raw) return { agency: '—', office: null }

  const parts = raw.split('.').map(p => p.trim()).filter(Boolean)

  if (parts.length === 1) {
    // Single segment (USASpending format)
    return { agency: normalizeAgency(parts[0]), office: null }
  }

  // Multi-segment (SAM.gov format)
  // Segment 0 = top-level dept → normalize + abbreviate
  // Segment 1 = bureau/command → fold into agency display if it adds value
  // Segment 2 = specific office → show as "Office"
  const topNorm  = uninvert(parts[0])
  const topAbbrev = ABBREV[topNorm]

  let agency
  if (topAbbrev) {
    // We have an abbreviation — append bureau name for clarity unless it's redundant
    // e.g. "USDA" + "FOREST SERVICE" → "USDA Forest Service"
    // e.g. "Dept. of Defense" + "DEPT OF THE ARMY" → "Dept. of Defense – U.S. Army"
    const rawBureau = parts[1] ? parts[1].replace(/^DEPT\s+OF\s+(THE\s+)?/i, '').trim() : null
    const bureau = rawBureau ? toTitleCase(rawBureau) : null
    // Skip bureau if it's the same department repeated or matches the abbreviation
    const bureauIsRedundant = !bureau || topAbbrev.includes(bureau)
      || uninvert(parts[1] || '').toLowerCase() === topNorm.toLowerCase()
    if (!bureauIsRedundant) {
      agency = `${topAbbrev} – ${bureau}`
    } else {
      agency = topAbbrev
    }
  } else {
    agency = topNorm
  }

  // Office = last meaningful segment. Clean up parenthetical codes like "PCAC (36C776)"
  let office = parts[parts.length - 1] || null
  if (parts.length <= 2) office = null  // don't treat bureau as office
  if (office) {
    // Strip parenthetical office codes: "PCAC (36C776)" → "PCAC"
    office = office.replace(/\s*\([A-Z0-9]{3,10}\)\s*$/, '').trim()
    // Expand known office acronyms
    const OFFICE_NAMES = {
      'PCAC': 'Program Contracting Activity Central',
      'OALC': 'Oklahoma Air Logistics Complex',
      'NAVSUP': 'Naval Supply Systems Command',
      'NAVFAC': 'Naval Facilities Engineering Command',
      'DLA': 'Defense Logistics Agency',
      'DCMA': 'Defense Contract Management Agency',
      'DISA': 'Defense Information Systems Agency',
    }
    if (OFFICE_NAMES[office]) office = OFFICE_NAMES[office]
    else if (office === office.toUpperCase() && office.length > 2) office = toTitleCase(office)
  }

  return { agency, office }
}

/**
 * Quick one-liner for summary table rows — just the top-level abbreviation.
 * Does not include bureau or office.
 */
export function topAgencyLabel(raw) {
  if (!raw) return '—'
  const top = raw.split('.')[0].trim()
  return normalizeAgency(top)
}
