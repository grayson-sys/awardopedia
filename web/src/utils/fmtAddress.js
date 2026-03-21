/**
 * fmtAddress.js — Deterministic address formatting for Awardopedia
 *
 * Handles two display problems without touching the DB:
 *   1. ALL CAPS → Title Case (with exceptions for abbreviations)
 *   2. Missing city/state → appended from separate DB columns
 *
 * Usage:
 *   import { fmtAddress } from '../utils/fmtAddress'
 *   fmtAddress(opp.performance_address, opp.place_of_performance_city, opp.place_of_performance_state)
 */

// Full state names for display (abbreviation → full name)
const STATE_NAMES = {
  AL:'Alabama',AK:'Alaska',AZ:'Arizona',AR:'Arkansas',CA:'California',
  CO:'Colorado',CT:'Connecticut',DE:'Delaware',DC:'District of Columbia',FL:'Florida',
  GA:'Georgia',HI:'Hawaii',ID:'Idaho',IL:'Illinois',IN:'Indiana',
  IA:'Iowa',KS:'Kansas',KY:'Kentucky',LA:'Louisiana',ME:'Maine',
  MD:'Maryland',MA:'Massachusetts',MI:'Michigan',MN:'Minnesota',MS:'Mississippi',
  MO:'Missouri',MT:'Montana',NE:'Nebraska',NV:'Nevada',NH:'New Hampshire',
  NJ:'New Jersey',NM:'New Mexico',NY:'New York',NC:'North Carolina',ND:'North Dakota',
  OH:'Ohio',OK:'Oklahoma',OR:'Oregon',PA:'Pennsylvania',RI:'Rhode Island',
  SC:'South Carolina',SD:'South Dakota',TN:'Tennessee',TX:'Texas',UT:'Utah',
  VT:'Vermont',VA:'Virginia',WA:'Washington',WV:'West Virginia',WI:'Wisconsin',WY:'Wyoming',
  GU:'Guam',PR:'Puerto Rico',VI:'U.S. Virgin Islands',AS:'American Samoa',MP:'Northern Mariana Islands',
  AE:'Armed Forces Europe',AP:'Armed Forces Pacific',AA:'Armed Forces Americas',
  // Foreign country codes that appear in SAM.gov place of performance
  PH:'Philippines',DE:'Germany',JP:'Japan',KR:'South Korea',IT:'Italy',
  GB:'United Kingdom',AU:'Australia',CA:'Canada',MX:'Mexico',
  BG:'Bulgaria',RO:'Romania',KW:'Kuwait',QA:'Qatar',BH:'Bahrain',
  JO:'Jordan',IQ:'Iraq',AF:'Afghanistan',TR:'Turkey',ES:'Spain',
  BE:'Belgium',NL:'Netherlands',NO:'Norway',PL:'Poland',GR:'Greece',
}

// Street type abbreviations that should be title-cased
const STREET_ABBR = new Set([
  'AVE','BLVD','CIR','CT','DR','EXPY','FWY','HWY','LN','PKWY',
  'PL','PLZ','RD','RTE','SR','ST','TER','TRL','WAY','ALY',
  'BLDG','STE','RM','FL','APT','UNIT',
])

// Tokens that must stay uppercase regardless of position
const KEEP_UPPER = new Set([
  'NW','NE','SW','SE','N','S','E','W',     // directionals
  'US','USA','UN',                          // country references
  // 2-letter state abbreviations
  'AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID','IL','IN','IA',
  'KS','KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ',
  'NM','NY','NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT','VT',
  'VA','WA','WV','WI','WY','DC','GU','PR','VI',
  // Military base abbreviations
  'AFB','NAS','MCB','JB','JBPHH','ARS',
])

function titleCaseAddress(raw) {
  if (!raw || raw.trim() === '') return null

  // Filter out SAM.gov placeholder text
  let cleaned = raw
    .replace(/\(No Street Address \d+\)/gi, '')
    .replace(/\n+/g, ', ')
    .replace(/,\s*,/g, ',')
    .replace(/^\s*,\s*/, '')
    .replace(/\s*,\s*$/, '')
    .trim()
  if (!cleaned) return null

  // If already mixed-case (not all-caps), return as-is with minor cleanup only
  const upper = cleaned.replace(/[^A-Za-z]/g, '')
  const isAllCaps = upper.length > 3 && upper === upper.toUpperCase()
  if (!isAllCaps) return cleaned

  return cleaned.split(/\s+/).map((token, i) => {
    const up = token.replace(/[^A-Z0-9]/g, '').toUpperCase()
    // Always keep uppercase: state abbreviations, directionals, military codes
    if (KEEP_UPPER.has(up)) return up
    // Street type abbreviations → Title Case
    if (STREET_ABBR.has(up)) return token.charAt(0).toUpperCase() + token.slice(1).toLowerCase()
    // Zip codes and numbers → unchanged
    if (/^\d/.test(token)) return token
    // Everything else → Title Case
    return token.charAt(0).toUpperCase() + token.slice(1).toLowerCase()
  }).join(' ')
}

function alreadyHasStateOrCity(addr, city, state) {
  if (!addr) return false
  const a = addr.toUpperCase()
  if (state && a.includes(state.toUpperCase())) return true
  if (city && a.includes(city.toUpperCase().split(' ')[0])) return true
  return false
}

/**
 * Format a performance address for display.
 *
 * @param {string|null} addr    - Raw performance_address from opportunity_intel
 * @param {string|null} city    - place_of_performance_city from opportunities
 * @param {string|null} state   - place_of_performance_state from opportunities
 * @returns {string|null}       - Formatted address, or null if nothing useful
 */
export function fmtAddress(addr, city, state) {
  const cased = titleCaseAddress(addr)

  // Expand state abbreviations to full names for display
  const displayState = STATE_NAMES[state] || state

  if (cased) {
    if (!alreadyHasStateOrCity(cased, city, state)) {
      const suffix = [city, displayState].filter(Boolean).join(', ')
      return suffix ? `${cased}, ${suffix}` : cased
    }
    return cased
  }

  // No valid address — fall back to city, state only
  const fallback = [city, displayState].filter(Boolean).join(', ')
  return fallback || null
}
