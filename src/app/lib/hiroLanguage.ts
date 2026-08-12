export type HiroLanguage = 'en' | 'tl' | 'ceb'

const explicit: Array<[HiroLanguage, RegExp]> = [
  ['tl', /\b(tagalog|filipino)(\s+(please|po))?\b|\bmag[ -]?tagalog\b/i],
  ['ceb', /\b(bisaya|cebuano)(\s+(please|palihug))?\b|\bmag[ -]?bisaya\b/i],
  ['en', /\benglish(\s+please)?\b|\bspeak english\b/i],
]

const tagalog = new Set(['ako', 'aking', 'ano', 'bakit', 'gusto', 'hindi', 'ikaw', 'ko', 'magkano', 'may', 'paano', 'po', 'saan', 'salamat', 'yung'])
const bisaya = new Set(['ako', 'akong', 'asa', 'ba', 'gani', 'gyud', 'imo', 'imong', 'karon', 'kay', 'ko', 'mao', 'ngano', 'pila', 'pwede', 'unsa'])
const english = new Set(['what', 'how', 'where', 'when', 'why', 'please', 'balance', 'order', 'wallet', 'payout', 'help', 'available'])

export function detectHiroLanguage(input: string, fallback: HiroLanguage = 'en'): HiroLanguage {
  for (const [language, pattern] of explicit) if (pattern.test(input)) return language
  const words = input.toLowerCase().normalize('NFKD').replace(/[^a-z\s]/g, ' ').split(/\s+/).filter(Boolean)
  let tl = 0
  let ceb = 0
  let en = 0
  for (const word of words) {
    if (tagalog.has(word)) tl += 1
    if (bisaya.has(word)) ceb += 1
    if (english.has(word)) en += 1
  }
  if (tl > ceb && tl > 0) return 'tl'
  if (ceb > tl && ceb > 0) return 'ceb'
  if (en > tl && en > ceb && en > 0) return 'en'
  return fallback
}

export function isLanguageRequest(input: string): boolean {
  return explicit.some(([, pattern]) => pattern.test(input))
}

export function isTicketConfirmation(input: string): boolean | null {
  const normalized = input.toLowerCase().trim()
  if (/^(yes|yes please|sure|okay|ok|oo|opo|sige|go ahead|please do|create it|himua|gawin mo)([.!])?$/.test(normalized)) return true
  if (/^(no|no thanks|not now|hindi|ayaw|dili|wag|cancel)([.!])?$/.test(normalized)) return false
  return null
}
