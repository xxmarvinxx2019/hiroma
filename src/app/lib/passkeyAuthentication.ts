import { isPasskeyEligible, type PasskeyEligibleAccount } from '@/app/lib/passkeyPolicy'

const MINIMUM_RESPONSE_MS = 250
const MAXIMUM_JITTER_MS = 50
const MAXIMUM_RESPONSE_MS = MINIMUM_RESPONSE_MS + MAXIMUM_JITTER_MS

export type PasskeyAuthenticationAccount = PasskeyEligibleAccount & {
  id: string
  passkey_credentials: unknown[]
}

export function getPasskeyAuthenticationUserId(
  account: PasskeyAuthenticationAccount | null | undefined,
): string | null {
  if (!account || !isPasskeyEligible(account) || account.passkey_credentials.length === 0) return null
  return account.id
}

export function isRealPasskeyChallenge(userId: string | null | undefined): userId is string {
  return typeof userId === 'string' && userId.length > 0
}

export function getPasskeyResponseDelay(
  startedAt: number,
  now = performance.now(),
  random = Math.random(),
): number {
  const boundedRandom = Number.isFinite(random) ? Math.min(1, Math.max(0, random)) : 0
  const target = MINIMUM_RESPONSE_MS + Math.floor(boundedRandom * MAXIMUM_JITTER_MS)
  const elapsed = Number.isFinite(startedAt) && Number.isFinite(now)
    ? Math.max(0, now - startedAt)
    : 0
  return Math.min(MAXIMUM_RESPONSE_MS, Math.max(0, target - elapsed))
}

export async function normalizePasskeyResponseTiming(startedAt: number): Promise<void> {
  const delay = getPasskeyResponseDelay(startedAt)
  if (delay > 0) await new Promise(resolve => setTimeout(resolve, delay))
}
