import { NextRequest, NextResponse } from 'next/server'
import { verifyAuthenticationResponse } from '@simplewebauthn/server'
import type { AuthenticationResponseJSON, AuthenticatorTransportFuture } from '@simplewebauthn/server'
import prisma from '@/app/lib/prisma'
import { getDashboardRoute, setAuthCookie, signToken, type UserRole } from '@/app/lib/auth'
import { consumePasskeyChallenge, getPasskeyConfig, passkeyAuditMetadata } from '@/app/lib/passkeys'
import { isPasskeyEligible } from '@/app/lib/passkeyPolicy'
import { isRealPasskeyChallenge } from '@/app/lib/passkeyAuthentication'
import { persistVerifiedPasskeyCounter } from '@/app/lib/passkeyCounter'
import { createAuditLog, formatMemberId, getClientInfo } from '@/app/lib/auditLog'
import { isLoginPortal, isRoleAllowedInPortal } from '@/app/lib/loginPortal'

const authenticationFailed = () => NextResponse.json(
  { error: 'Passkey sign-in failed. Use your password or try again.' },
  { status: 401 },
)

export async function POST(req: NextRequest) {
  const client = getClientInfo(req)
  try {
    const challenge = await consumePasskeyChallenge('authenticate')
    if (!challenge || !isRealPasskeyChallenge(challenge.user_id)) return authenticationFailed()
    const body = await req.json() as AuthenticationResponseJSON & { portal?: unknown }
    if (!isLoginPortal(body.portal) || (body.portal !== 'member' && body.portal !== 'distributor' && body.portal !== 'admin')) return authenticationFailed()
    const response = body as AuthenticationResponseJSON
    const credential = await prisma.passkeyCredential.findUnique({ where: { credential_id: response.id }, include: { user: true } })
    if (!credential || credential.user_id !== challenge.user_id || !isPasskeyEligible(credential.user)) return authenticationFailed()
    const role = credential.user.role as UserRole
    if (!isRoleAllowedInPortal(role, body.portal)) return authenticationFailed()
    const { origin, rpID } = getPasskeyConfig(req)
    const result = await verifyAuthenticationResponse({
      response, expectedChallenge: challenge.challenge, expectedOrigin: origin, expectedRPID: rpID, requireUserVerification: true,
      credential: { id: credential.credential_id, publicKey: new Uint8Array(credential.public_key), counter: Number(credential.counter), transports: credential.transports as AuthenticatorTransportFuture[] },
    })
    if (!result.verified) return authenticationFailed()
    const persisted = await persistVerifiedPasskeyCounter(
      credential,
      result.authenticationInfo.newCounter,
      result.authenticationInfo.credentialBackedUp,
      result.authenticationInfo.credentialDeviceType,
      args => prisma.passkeyCredential.updateMany(args),
    )
    if (!persisted) return authenticationFailed()
    await setAuthCookie(await signToken({ id: credential.user.id, username: credential.user.username, role, full_name: credential.user.full_name }))
    createAuditLog({ user_id: credential.user.id, user_name: credential.user.full_name, user_role: role, member_id: formatMemberId(credential.user.id, role), activity_type: 'passkey_login', category: 'auth', description: credential.user.full_name + ' logged in with a passkey', metadata: passkeyAuditMetadata(credential.credential_id), ...client })
    return NextResponse.json({ success: true, redirect: getDashboardRoute(role) })
  } catch (error) {
    console.error('[PASSKEY AUTH VERIFY ERROR]', error)
    return authenticationFailed()
  }
}
