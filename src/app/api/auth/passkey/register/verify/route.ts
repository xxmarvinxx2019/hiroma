import { NextRequest, NextResponse } from 'next/server'
import { verifyRegistrationResponse } from '@simplewebauthn/server'
import type { RegistrationResponseJSON } from '@simplewebauthn/server'
import { getCurrentUser } from '@/app/lib/auth'
import prisma from '@/app/lib/prisma'
import { consumePasskeyChallenge, getPasskeyConfig, passkeyAuditMetadata } from '@/app/lib/passkeys'
import { isPasskeyEligible } from '@/app/lib/passkeyPolicy'
import { createAuditLog, formatMemberId, getClientInfo } from '@/app/lib/auditLog'

export async function POST(req: NextRequest) {
  const client = getClientInfo(req)
  try {
    const session = await getCurrentUser()
    if (!session || session.is_staff || !isPasskeyEligible({ role: session.role, status: 'active', login_disabled: false })) return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 })
    const challenge = await consumePasskeyChallenge('register')
    if (!challenge || challenge.user_id !== session.id || !challenge.device_name) return NextResponse.json({ error: 'Registration expired. Please try again.' }, { status: 400 })
    const account = await prisma.user.findUnique({ where: { id: session.id } })
    if (!isPasskeyEligible(account)) return NextResponse.json({ error: 'Passkeys are not enabled for this account.' }, { status: 403 })
    const response = await req.json() as RegistrationResponseJSON
    const { origin, rpID } = getPasskeyConfig(req)
    const result = await verifyRegistrationResponse({ response, expectedChallenge: challenge.challenge, expectedOrigin: origin, expectedRPID: rpID, requireUserVerification: true })
    if (!result.verified || !result.registrationInfo) return NextResponse.json({ error: 'Passkey verification failed.' }, { status: 400 })
    const info = result.registrationInfo
    await prisma.passkeyCredential.create({ data: {
      user_id: account!.id, credential_id: info.credential.id, public_key: Buffer.from(info.credential.publicKey),
      counter: BigInt(info.credential.counter), transports: info.credential.transports || [], device_name: challenge.device_name,
      device_type: info.credentialDeviceType, backed_up: info.credentialBackedUp,
    } })
    createAuditLog({ user_id: account!.id, user_name: account!.full_name, user_role: account!.role, member_id: formatMemberId(account!.id, account!.role), activity_type: 'passkey_registered', category: 'auth', description: 'Passkey registered for ' + challenge.device_name, metadata: passkeyAuditMetadata(info.credential.id), ...client })
    return NextResponse.json({ success: true, message: 'Passkey registered.' })
  } catch (error) {
    console.error('[PASSKEY REGISTRATION VERIFY ERROR]', error)
    return NextResponse.json({ error: 'Unable to register this passkey.' }, { status: 400 })
  }
}
