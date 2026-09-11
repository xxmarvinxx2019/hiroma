export function maskPayoutDestination(value: string | null | undefined) {
  if (!value) return null
  const parts = value.split('·').map(part => part.trim())
  const account = parts.at(-1) || ''
  const masked = account.length > 4 ? `${'*'.repeat(Math.min(7, account.length - 4))}${account.slice(-4)}` : '****'
  return [...parts.slice(0, -1), masked].join(' · ')
}
