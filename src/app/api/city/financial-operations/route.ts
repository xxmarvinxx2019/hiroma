import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/app/lib/auth'
import prisma from '@/app/lib/prisma'
import { operationIdentity, readOperationReceipt, replayFinancialOperation, OperationRecoveryConflict, type OperationKind } from '@/app/lib/financialOperationRecovery'

async function recover(req: NextRequest, comparePayload: boolean) {
  try {
    const user = await getCurrentUser()
    if (!user || user.role !== 'city' || (user.is_staff && !user.permissions?.includes('register_reseller'))) return NextResponse.json({ error: 'Registration permission is required.' }, { status: 403 })
    const body = comparePayload ? await req.json() : null
    const kind = req.nextUrl.searchParams.get('kind')
    const sourceId = req.nextUrl.searchParams.get('source_id')
    if (kind !== 'registration' && kind !== 'upgrade') return NextResponse.json({ error: 'Invalid operation kind.' }, { status: 400 })
    const identity = operationIdentity(kind as OperationKind, sourceId, user.id, user.actor_id || user.id, body)
    const result = comparePayload ? await replayFinancialOperation(prisma, identity) : (await readOperationReceipt(prisma, identity))?.response
    return NextResponse.json(result ? { state: 'completed', result } : { state: 'not_confirmed', message: 'No committed receipt is visible yet. The original request may still be processing. Retry only the same PIN transaction.' }, { headers: { 'Cache-Control': 'private, no-store' } })
  } catch (error) {
    if (error instanceof OperationRecoveryConflict) return NextResponse.json({ error: error.message }, { status: 409 })
    console.error('[FINANCIAL OPERATION RECOVERY]', error instanceof Error ? error.message : 'Recovery failed')
    return NextResponse.json({ error: 'Unable to confirm the original transaction. Do not use another PIN; check again when the connection returns.' }, { status: 503 })
  }
}
export async function GET(req: NextRequest) { return recover(req, false) }
export async function POST(req: NextRequest) { return recover(req, true) }
