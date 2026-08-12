import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/app/lib/prisma'
import { createSupportCaptcha, getSupportClientAddress, supportClientFingerprint } from '@/app/lib/supportAbuseProtection'

export async function GET(request: NextRequest) {
  try {
    const fingerprint = supportClientFingerprint(getSupportClientAddress(request.headers))
    const recent = await prisma.supportCaptchaChallenge.count({
      where: { client_fingerprint: fingerprint, created_at: { gte: new Date(Date.now() - 15 * 60 * 1000) } },
    })
    if (recent >= 10) return NextResponse.json({ error: 'Too many verification requests. Please try again later.' }, { status: 429 })

    const challenge = createSupportCaptcha()
    await prisma.supportCaptchaChallenge.create({
      data: { id: challenge.id, answer_digest: challenge.answerDigest, client_fingerprint: fingerprint, expires_at: challenge.expiresAt },
    })
    return NextResponse.json({ id: challenge.id, question: challenge.question, expires_at: challenge.expiresAt.toISOString() })
  } catch (error) {
    console.error('[SUPPORT CAPTCHA GET]', error)
    return NextResponse.json({ error: 'Human verification is temporarily unavailable.' }, { status: 503 })
  }
}
