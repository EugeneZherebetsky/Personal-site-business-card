/**
 * Keeps free-text company and source names consistent.
 *
 * Saving only tidies values that are clearly one of the standard sources typed
 * differently (case, spacing, a common typo), so detail such as
 * "referral (Daniil)" is never thrown away. Grouping for analytics and
 * duplicate hints is broader and never changes stored data.
 */

export const STANDARD_SOURCES = ['LinkedIn', 'Referral', 'Company site', 'Recruiter', 'Jack & Jill', 'J&J', 'Job board'] as const

const SOURCE_SPELLINGS: Record<string, (typeof STANDARD_SOURCES)[number]> = {
  linkedin: 'LinkedIn',
  'linked in': 'LinkedIn',
  referral: 'Referral',
  referal: 'Referral',
  referrals: 'Referral',
  refferal: 'Referral',
  'company site': 'Company site',
  'company website': 'Company site',
  'company careers site': 'Company site',
  'careers site': 'Company site',
  'career site': 'Company site',
  'careers page': 'Company site',
  recruiter: 'Recruiter',
  'recruitment agency': 'Recruiter',
  'jack & jill': 'Jack & Jill',
  'jack and jill': 'Jack & Jill',
  'j&j': 'J&J',
  'j & j': 'J&J',
  'job board': 'Job board',
}

function squash(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, ' ')
}

/** The value to store: a standard label when the whole entry is one, otherwise the trimmed entry. */
export function canonicalSource(raw: string | null | undefined) {
  const trimmed = (raw ?? '').trim()
  return SOURCE_SPELLINGS[squash(trimmed)] ?? trimmed
}

/** The bucket a source counts towards in analytics, e.g. "referral (Daniil)" → Referral. */
export function sourceGroup(raw: string | null | undefined) {
  const value = squash(raw ?? '')
  if (!value) return ''
  if (SOURCE_SPELLINGS[value]) return SOURCE_SPELLINGS[value]
  if (/linked\s?in/.test(value)) return 'LinkedIn'
  if (/^(ref+er+a?ls?|referred)\b/.test(value)) return 'Referral'
  if (/^jack\s?(&|and)\s?jill\b/.test(value)) return 'Jack & Jill'
  if (/^(company|careers?)\s(site|website|page)\b/.test(value)) return 'Company site'
  if (/^recruit/.test(value)) return 'Recruiter'
  return (raw ?? '').trim()
}

/** Suggestions for the source field: the standard list plus the user's own labels, without spelling variants. */
export function sourceSuggestions(existing: Array<string | null | undefined>) {
  const seen = new Map<string, string>()
  ;[...STANDARD_SOURCES, ...existing.map((value) => canonicalSource(value))].forEach((value) => {
    if (value && !seen.has(squash(value))) seen.set(squash(value), value)
  })
  return [...seen.values()]
}

const LEGAL_SUFFIXES = new Set(['kft', 'zrt', 'nyrt', 'bt', 'gmbh', 'ag', 'se', 'ltd', 'limited', 'inc', 'llc', 'plc', 'sa', 'sas', 'bv', 'nv', 'spa', 'srl', 'co', 'corp', 'corporation', 'group', 'holding', 'holdings'])

/** Comparison key for a company name: case, punctuation, brackets and legal suffixes ignored. */
export function companyKey(name: string | null | undefined) {
  const words = (name ?? '')
    .toLowerCase()
    .replace(/\([^)]*\)/g, ' ')
    .replace(/[.,'’]/g, '')
    .replace(/[^a-z0-9&áéíóöőúüű]+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean)
  while (words.length > 1 && LEGAL_SUFFIXES.has(words[words.length - 1])) words.pop()
  return words.join(' ')
}

/** True when two names look like the same employer, e.g. "MOL" and "MOL Group", or "Deloitte" and "Deloitte Hungary". */
export function sameCompany(left: string | null | undefined, right: string | null | undefined) {
  const a = companyKey(left)
  const b = companyKey(right)
  if (!a || !b) return false
  return a === b || a.startsWith(`${b} `) || b.startsWith(`${a} `)
}

/** One suggestion per employer, using the spelling used most often. */
export function companySuggestions(names: Array<string | null | undefined>) {
  const counts = new Map<string, Map<string, number>>()
  names.forEach((name) => {
    const trimmed = (name ?? '').trim()
    const key = companyKey(trimmed)
    if (!key) return
    const spellings = counts.get(key) ?? new Map<string, number>()
    spellings.set(trimmed, (spellings.get(trimmed) ?? 0) + 1)
    counts.set(key, spellings)
  })
  return [...counts.values()]
    .map((spellings) => [...spellings.entries()].sort((left, right) => right[1] - left[1])[0][0])
    .sort((left, right) => left.localeCompare(right))
}
