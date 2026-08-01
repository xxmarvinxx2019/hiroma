const PERSON_SUFFIXES = new Set(['jr', 'jr.', 'sr', 'sr.', 'ii', 'iii', 'iv', 'v'])

/**
 * Normalizes spacing and capitalizes the first letter of every name segment
 * without changing the remaining letters the member intentionally entered.
 */
export function normalizePersonName(value: string): string {
  return value
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/(^|[\s'’-])\p{L}/gu, (match) => match.toUpperCase())
}
export function isPersonSuffix(value: string): boolean {
  return PERSON_SUFFIXES.has(value.trim().toLowerCase())
}

export function getPersonNameCoreParts(value: string): string[] {
  const parts = normalizePersonName(value).split(/\s+/).filter(Boolean)
  if (parts.length > 1 && isPersonSuffix(parts.at(-1) || '')) return parts.slice(0, -1)
  return parts
}

export function buildPersonName(input: {
  firstName: string
  middleName?: string
  lastName: string
  suffix?: string
}): string {
  return normalizePersonName([
    input.firstName,
    input.middleName,
    input.lastName,
    input.suffix,
  ].filter((part) => part?.trim()).join(' '))
}

export function hasCompletePersonName(value: string): boolean {
  return getPersonNameCoreParts(value).length >= 2
}

export function getPersonNameInitials(value: string): string {
  return getPersonNameCoreParts(value).map((part) => part.match(/\p{L}/u)?.[0] ?? '')
    .join('')
    .toLocaleLowerCase('en-US')
}
