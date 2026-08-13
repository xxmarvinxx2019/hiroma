import prisma from '@/app/lib/prisma'
import { verifyPassword } from '@/app/lib/auth'

const PIN_PATTERN = /^\d{6}$/
const MAX_FAILED_ATTEMPTS = 5
const LOCKOUT_MINUTES = 15

export function isValidSecurityPin(pin: unknown): pin is string {
  return typeof pin === 'string' && PIN_PATTERN.test(pin)
}

export interface ResellerSecurityPinVerification {
  required: boolean
  valid: boolean
  locked?: boolean
  error?: string
}

export function isSensitiveResellerPinAccepted(
  verification: ResellerSecurityPinVerification,
): boolean {
  return verification.required === true && verification.valid === true
}

export function getSensitiveResellerPinFailure(
  verification: ResellerSecurityPinVerification,
) {
  if (!verification.required) {
    return {
      error: 'Configure your six-digit security PIN before continuing.',
      status: 403,
    }
  }
  return {
    error: verification.error || 'Security PIN is required.',
    status: verification.locked ? 429 : 401,
  }
}

export async function verifyResellerSecurityPin(userId: string, pin: unknown) {
  return prisma.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<{
      two_factor_enabled: boolean
      two_factor_pin_hash: string | null
      two_factor_failed_attempts: number
      two_factor_locked_until: Date | null
    }[]>`
      SELECT two_factor_enabled, two_factor_pin_hash,
             two_factor_failed_attempts, two_factor_locked_until
      FROM users
      WHERE id = ${userId}
      FOR UPDATE
    `
    const user = rows[0]

    if (!user?.two_factor_enabled) return { required: false, valid: true }
    if (!user.two_factor_pin_hash) return { required: true, valid: false, error: 'Your security PIN is not configured. Contact support.' }

    if (user.two_factor_locked_until && user.two_factor_locked_until > new Date()) {
      return { required: true, valid: false, locked: true, error: 'Too many incorrect PIN attempts. Please try again later.' }
    }

    if (!isValidSecurityPin(pin) || !(await verifyPassword(pin, user.two_factor_pin_hash))) {
      const attempts = user.two_factor_failed_attempts + 1
      const lockedUntil = attempts >= MAX_FAILED_ATTEMPTS
        ? new Date(Date.now() + LOCKOUT_MINUTES * 60 * 1000)
        : null
      await tx.user.update({
        where: { id: userId },
        data: lockedUntil
          ? { two_factor_failed_attempts: 0, two_factor_locked_until: lockedUntil }
          : { two_factor_failed_attempts: { increment: 1 }, two_factor_locked_until: null },
      })
      return {
        required: true,
        valid: false,
        locked: Boolean(lockedUntil),
        error: lockedUntil
          ? 'Too many incorrect PIN attempts. Please try again in 15 minutes.'
          : 'Incorrect six-digit security PIN.',
      }
    }

    if (user.two_factor_failed_attempts || user.two_factor_locked_until) {
      await tx.user.update({
        where: { id: userId },
        data: { two_factor_failed_attempts: 0, two_factor_locked_until: null },
      })
    }

    return { required: true, valid: true }
  })
}
