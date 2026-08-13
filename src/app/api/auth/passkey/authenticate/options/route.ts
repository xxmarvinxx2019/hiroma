import { NextRequest, NextResponse } from 'next/server'
import { generateAuthenticationOptions } from '@simplewebauthn/server'
import prisma from '@/app/lib/prisma'
import { getPasskeyConfig, issuePasskeyChallenge } from '@/app/lib/passkeys'
import { getPasskeyAuthenticationUserId, normalizePasskeyResponseTiming } from '@/app/lib/passkeyAuthentication'
import { isLoginPortal } from '@/app/lib/loginPortal'

export async function POST(req: NextRequest) {
  const startedAt = performance.now()
  try {
    let username = ''
    let memberPortal = false
    try {
      const body = await req.json()
      memberPortal = isLoginPortal(body.portal) && (body.portal === 'member' || body.portal === 'distributor' || body.portal === 'admin')
      if (typeof body.username === 'string') username = body.username.trim().toLowerCase()
    } catch {
      // Malformed requests are rejected below without issuing a challenge.
    }

    if (!memberPortal) return NextResponse.json({ error: 'Passkey sign-in is only available on an authorized login portal.' }, { status: 403 })

    const account = username
      ? await prisma.user.findUnique({ where: { username }, include: { passkey_credentials: true } })
      : null
    const challengeUserId = getPasskeyAuthenticationUserId(account)
    const { rpID } = getPasskeyConfig(req)
    const options = await generateAuthenticationOptions({
      rpID,
      userVerification: 'required',
    })
    await issuePasskeyChallenge(challengeUserId, options.challenge, 'authenticate')
    await normalizePasskeyResponseTiming(startedAt)
    return NextResponse.json(options)
  } catch (error) {
    console.error('[PASSKEY AUTH OPTIONS ERROR]', error)
    await normalizePasskeyResponseTiming(startedAt)
    return NextResponse.json({ error: 'Unable to start passkey sign-in.' }, { status: 500 })
  }
}
