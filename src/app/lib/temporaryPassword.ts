import { getPersonNameInitials, hasCompletePersonName } from '@/app/lib/nameFormat'

export function generateTemporaryPassword(fullName: string): string {
  if (!hasCompletePersonName(fullName)) return ''

  const randomValue = new Uint32Array(1)
  globalThis.crypto.getRandomValues(randomValue)
  const randomDigits = String(randomValue[0] % 1_000_000).padStart(6, '0')

  return `${getPersonNameInitials(fullName)}${randomDigits}`
}
