import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser, verifyPassword } from '@/app/lib/auth'
import prisma from '@/app/lib/prisma'
import { isPasskeyEligible } from '@/app/lib/passkeyPolicy'
import { createAuditLog, formatMemberId, getClientInfo } from '@/app/lib/auditLog'
import { passkeyAuditMetadata } from '@/app/lib/passkeys'

export async function GET() {
  try {
    const session = await getCurrentUser()
    if (!session || session.is_staff || !isPasskeyEligible({ role: session.role, status: 'active', login_disabled: false })) return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 })
    const account = await prisma.user.findUnique({ where: { id: session.id }, include: { passkey_credentials: { orderBy: { created_at: 'desc' } } } })
    if (!account || !isPasskeyEligible(account)) return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 })
    return NextResponse.json({ eligible: isPasskeyEligible(account), devices: isPasskeyEligible(account) ? account.passkey_credentials.map(item => ({ id: item.id, name: item.device_name, created_at: item.created_at, last_used_at: item.last_used_at, backed_up: item.backed_up })) : [] })
  } catch (error) {
    console.error('[PASSKEY DEVICES GET ERROR]', error)
    return NextResponse.json({ error: 'Unable to load passkey devices.' }, { status: 500 })
  }
}

export async function DELETE(req: NextRequest) {
  const client = getClientInfo(req)
  try {
    const session = await getCurrentUser()
    if (!session || session.is_staff || !isPasskeyEligible({ role: session.role, status: 'active', login_disabled: false })) return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 })
    const { id, password } = await req.json()
    if (typeof id !== 'string' || typeof password !== 'string') return NextResponse.json({ error: 'Device and current password are required.' }, { status: 400 })
    const account = await prisma.user.findUnique({ where: { id: session.id } })
    if (!isPasskeyEligible(account)) return NextResponse.json({ error: 'Passkeys are not enabled for this account.' }, { status: 403 })
    if (!(await verifyPassword(password, account!.password_hash))) return NextResponse.json({ error: 'Current password is incorrect.' }, { status: 401 })
    const credential = await prisma.passkeyCredential.findFirst({ where: { id, user_id: account!.id } })
    if (!credential) return NextResponse.json({ error: 'Passkey device not found.' }, { status: 404 })
    await prisma.passkeyCredential.delete({ where: { id: credential.id } })
    createAuditLog({ user_id: account!.id, user_name: account!.full_name, user_role: account!.role, member_id: formatMemberId(account!.id, account!.role), activity_type: 'passkey_removed', category: 'auth', description: 'Passkey removed for ' + credential.device_name, metadata: passkeyAuditMetadata(credential.credential_id), risk_level: 'medium', ...client })
    return NextResponse.json({ success: true, message: 'Passkey removed. Password sign-in remains available.' })
  } catch (error) {
    console.error('[PASSKEY DEVICE DELETE ERROR]', error)
    return NextResponse.json({ error: 'Unable to remove this passkey.' }, { status: 500 })
  }
}
