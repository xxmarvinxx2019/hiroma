import { createHash } from 'node:crypto'
import type { Prisma } from '@prisma/client'

export class RequestReceiptError extends Error {
  constructor(message: string, readonly status: number) { super(message) }
}

export function createRequestIdentity(req: Request, kind: string, owner: string, actor: string, body: Record<string, unknown>) {
  const id = req.headers.get('Idempotency-Key')
  if (!id) return null
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) {
    throw new RequestReceiptError('Invalid request reference.', 400)
  }
  const payload = { ...body }
  delete payload.security_pin
  const fingerprint = createHash('sha256').update(JSON.stringify(payload)).digest('hex')
  return { key: JSON.stringify([kind, owner, actor, id.toLowerCase()]), fingerprint }
}

type Identity = ReturnType<typeof createRequestIdentity>
type Reader = Pick<Prisma.TransactionClient, '$queryRaw'>

export async function readRequestReceipt(db: Reader, request: Identity) {
  if (!request) return null
  const [row] = await db.$queryRaw<{ fingerprint: string; result: Prisma.JsonObject }[]>`
    SELECT fingerprint, result FROM request_receipts WHERE request_key = ${request.key}
  `
  if (!row) return null
  if (row.fingerprint !== request.fingerprint) throw new RequestReceiptError('This request reference already completed with different details.', 409)
  return row.result
}

export async function lockRequestReceipt(tx: Prisma.TransactionClient, request: Identity) {
  if (!request) return null
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${request.key}, 0))`
  return readRequestReceipt(tx, request)
}

export async function saveRequestReceipt(tx: Prisma.TransactionClient, request: Identity, result: object) {
  if (!request) return
  await tx.$executeRaw`
    INSERT INTO request_receipts(request_key, fingerprint, result)
    VALUES (${request.key}, ${request.fingerprint}, ${JSON.stringify(result)}::jsonb)
  `
}
