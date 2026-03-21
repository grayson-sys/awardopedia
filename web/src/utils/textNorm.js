/**
 * textNorm.js — General text normalization utilities
 *
 * Used to clean up ALL CAPS values from SAM.gov and USASpending
 * without modifying the database.
 */

const ALWAYS_LOWER = new Set(['a','an','the','and','but','or','for','nor','of','in','on','at','to','by','up','as'])

/**
 * Convert a string to Title Case if it is ALL CAPS.
 * Mixed-case strings are returned as-is.
 * Short words (articles, prepositions) are lowercased unless they are first.
 *
 * Examples:
 *   toTitleCase("JANITORIAL SERVICES")           → "Janitorial Services"
 *   toTitleCase("All Other Commercial Machinery") → "All Other Commercial Machinery" (unchanged)
 *   toTitleCase("SERVICE CONTRACT ACT")           → "Service Contract Act"
 */
export function toTitleCase(str) {
  if (!str) return str
  const letters = str.replace(/[^A-Za-z]/g, '')
  const isAllCaps = letters.length > 2 && letters === letters.toUpperCase()
  if (!isAllCaps) return str  // already mixed-case — don't touch it

  return str
    .toLowerCase()
    .split(/\s+/)
    .map((word, i) => {
      if (i > 0 && ALWAYS_LOWER.has(word)) return word
      return word.charAt(0).toUpperCase() + word.slice(1)
    })
    .join(' ')
}
