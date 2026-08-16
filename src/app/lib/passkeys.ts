import { NextRequest } from 'next/server'
import { cookies } from 'next/headers'
import prisma from '@/app/lib/prisma'
import { resolvePasskeyConfig } from '@/app/lib/passkeyConfig'

const CHALLENGE_COOKIE = 'hiroma_passkey_challenge'
const CHALLENGE_TTL_MS = 5 * 60 * 1000

export function getPasskeyConfig(req: NextRequest) {
  return resolvePasskeyConfig({
    requestOrigin: req.nextUrl.origin,
    configuredOrigin: process.env.PASSKEY_ORIGIN,
    configuredRPID: process.env.PASSKEY_RP_ID,
    configuredRPName: process.env.PASSKEY_RP_NAME,
    production: process.env.NODE_ENV === 'production',
  })
}

export async function issuePasskeyChallenge(userId: string | null, challenge: string, purpose: 'register' | 'authenticate', deviceName?: string) {
  await prisma.passkeyChallenge.deleteMany({ where: { expires_at: { lte: new Date() } } })
  const record = await prisma.passkeyChallenge.create({
    data: { user_id: userId, challenge, purpose, device_name: deviceName, expires_at: new Date(Date.now() + CHALLENGE_TTL_MS) },
  })
  ;(await cookies()).set(CHALLENGE_COOKIE, record.id, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    maxAge: CHALLENGE_TTL_MS / 1000,
    path: '/api/auth/passkey',
  })
}

export async function consumePasskeyChallenge(purpose: 'register' | 'authenticate') {
  const store = await cookies()
  const id = store.get(CHALLENGE_COOKIE)?.value
  store.delete(CHALLENGE_COOKIE)
  if (!id) return null
  return prisma.$transaction(async tx => {
    const record = await tx.passkeyChallenge.findUnique({ where: { id } })
    if (!record || record.purpose !== purpose || record.expires_at <= new Date()) return null
    const consumed = await tx.passkeyChallenge.deleteMany({ where: { id } })
    return consumed.count === 1 ? record : null
  })
}

export const passkeyAuditMetadata = (credentialId?: string) =>
  credentialId ? { credential_suffix: credentialId.slice(-8) } : {}