import prisma from '@/app/lib/prisma'
import { verifyPassword } from '@/app/lib/auth'

const PIN_PATTERN = /^\d{6}$/
const MAX_FAILED_ATTEMPTS = 5
const LOCKOUT_MINUTES = 15

export function isValidSecurityPin(pin: unknown): pin is string {
  return typeof pin === 'string' && PIN_PATTERN.test(pin)
}

export async function verifyResellerSecurityPin(userId: string, pin: unknown) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      two_factor_enabled: true,
      two_factor_pin_hash: true,
      two_factor_failed_attempts: true,
      two_factor_locked_until: true,
    },
  })

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
    await prisma.user.update({
      where: { id: userId },
      data: {
        two_factor_failed_attempts: lockedUntil ? 0 : attempts,
        two_factor_locked_until: lockedUntil,
      },
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
    await prisma.user.update({
      where: { id: userId },
      data: { two_factor_failed_attempts: 0, two_factor_locked_until: null },
    })
  }

  return { required: true, valid: true }
}
