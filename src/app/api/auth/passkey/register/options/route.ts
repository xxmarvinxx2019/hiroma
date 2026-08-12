import { NextRequest, NextResponse } from 'next/server'
import { generateRegistrationOptions } from '@simplewebauthn/server'
import type { AuthenticatorTransportFuture } from '@simplewebauthn/server'
import { getCurrentUser, verifyPassword } from '@/app/lib/auth'
import prisma from '@/app/lib/prisma'
import { getPasskeyConfig, issuePasskeyChallenge } from '@/app/lib/passkeys'
import { isPasskeyEligible, normalizeDeviceName } from '@/app/lib/passkeyPolicy'

export async function POST(req: NextRequest) {
  try {
    const session = await getCurrentUser()
    if (!session || session.is_staff || !isPasskeyEligible({ role: session.role, status: 'active', login_disabled: false })) return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 })
    const body = await req.json()
    const deviceName = normalizeDeviceName(body.device_name)
    if (!deviceName || typeof body.password !== 'string') return NextResponse.json({ error: 'Enter a device name and your current password.' }, { status: 400 })
    const account = await prisma.user.findUnique({ where: { id: session.id }, include: { passkey_credentials: true } })
    if (!isPasskeyEligible(account)) return NextResponse.json({ error: 'Passkeys are not enabled for this account.' }, { status: 403 })
    if (!(await verifyPassword(body.password, account!.password_hash))) return NextResponse.json({ error: 'Current password is incorrect.' }, { status: 401 })
    const { rpID, rpName } = getPasskeyConfig(req)
    const options = await generateRegistrationOptions({
      rpID, rpName, userName: account!.username, userDisplayName: account!.full_name,
      userID: new TextEncoder().encode(account!.id), attestationType: 'none',
      excludeCredentials: account!.passkey_credentials.map(item => ({ id: item.credential_id, transports: item.transports as AuthenticatorTransportFuture[] })),
      authenticatorSelection: {
        residentKey: 'required',
        requireResidentKey: true,
        userVerification: 'required',
      },
    })
    await issuePasskeyChallenge(account!.id, options.challenge, 'register', deviceName)
    return NextResponse.json(options)
  } catch (error) {
    console.error('[PASSKEY REGISTRATION OPTIONS ERROR]', error)
    return NextResponse.json({ error: 'Unable to start passkey registration.' }, { status: 500 })
  }
}
