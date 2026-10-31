import { createHmac, randomUUID } from 'node:crypto'
import type { Prisma } from '@prisma/client'

export type OperationKind = 'registration' | 'upgrade'
export type OperationIdentity = { kind: OperationKind; sourceId: string; ownerId: string; actorId: string; requestHash: string }
export class OperationRecoveryConflict extends Error {}
type Reader = Pick<Prisma.TransactionClient, '$queryRaw'>

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (value && typeof value === 'object') return `{${Object.entries(value).filter(([, v]) => v !== undefined).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(',')}}`
  return JSON.stringify(value) ?? 'null'
}
export function operationIdentity(kind: OperationKind, sourceId: unknown, ownerId: string, actorId: string, body: unknown): OperationIdentity {
  if (typeof sourceId !== 'string' || !sourceId || sourceId.length > 255) throw new OperationRecoveryConflict('A valid original PIN reference is required.')
  const secret = process.env.FINANCIAL_OPERATION_HASH_SECRET || process.env.JWT_SECRET
  if (!secret || secret.length < 32) throw new Error('A recovery fingerprint secret of at least 32 characters is required.')
  return { kind, sourceId, ownerId, actorId, requestHash: createHmac('sha256', secret).update(canonical(body)).digest('hex') }
}
export async function readOperationReceipt(db: Reader, identity: Pick<OperationIdentity, 'kind' | 'sourceId' | 'ownerId' | 'actorId'>) {
  const [receipt] = await db.$queryRaw<{ id: string; owner_id: string; actor_id: string; request_hash: string; response: Prisma.JsonObject }[]>`
    SELECT id::text,owner_id,actor_id,request_hash,response FROM financial_operation_receipts
    WHERE kind=${identity.kind} AND source_id=${identity.sourceId}
  `
  if (!receipt) return null
  if (receipt.owner_id !== identity.ownerId || (identity.actorId !== identity.ownerId && receipt.actor_id !== identity.actorId)) throw new OperationRecoveryConflict('This transaction is not available to your account.')
  return receipt
}
export async function replayFinancialOperation<T extends object = Prisma.JsonObject>(db: Reader, identity: OperationIdentity) {
  const receipt = await readOperationReceipt(db, identity)
  if (!receipt) return null
  if (receipt.request_hash !== identity.requestHash) throw new OperationRecoveryConflict('This PIN transaction already completed with different details. Check its original result instead of resubmitting changed details.')
  return { ...(receipt.response as unknown as T), recovered: true }
}
export async function lockFinancialOperation(tx: Pick<Prisma.TransactionClient, '$executeRaw'>, identity: OperationIdentity) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'financial-operation:' + identity.kind + ':' + identity.sourceId}))`
}
export async function recordFinancialOperation<T extends object>(tx: Pick<Prisma.TransactionClient, '$executeRaw'>, identity: OperationIdentity, result: T) {
  const id = randomUUID()
  const response = { ...result, operation_reference: `FO-${id}` }
  await tx.$executeRaw`
    INSERT INTO financial_operation_receipts(id,kind,source_id,owner_id,actor_id,request_hash,response)
    VALUES(${id}::uuid,${identity.kind},${identity.sourceId},${identity.ownerId},${identity.actorId},${identity.requestHash},${JSON.stringify(response)}::jsonb)
  `
  return response
}
