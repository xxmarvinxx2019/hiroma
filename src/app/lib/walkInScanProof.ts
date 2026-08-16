import { createHash, randomBytes } from 'crypto'
import type { Prisma, PrismaClient } from '@prisma/client'

export const WALK_IN_SCAN_PROOF_TTL_MS = 5 * 60 * 1000

export class InvalidWalkInScanProofError extends Error {
  constructor() {
    super('Scan the reseller Digital ID again before completing this sale.')
    this.name = 'InvalidWalkInScanProofError'
  }
}

export function hashWalkInScanProof(token: string) {
  return createHash('sha256').update(token).digest('hex')
}

export async function issueWalkInScanProof(
  db: PrismaClient,
  distributorId: string,
  resellerId: string,
  now = new Date(),
) {
  const token = randomBytes(32).toString('base64url')
  const expiresAt = new Date(now.getTime() + WALK_IN_SCAN_PROOF_TTL_MS)

  await db.walkInMemberScanProof.create({
    data: {
      token_hash: hashWalkInScanProof(token),
      distributor_id: distributorId,
      reseller_id: resellerId,
      expires_at: expiresAt,
    },
  })

  return { token, expiresAt }
}

export async function consumeWalkInScanProof(
  tx: Prisma.TransactionClient,
  token: string,
  distributorId: string,
  resellerId: string,
  now = new Date(),
) {
  if (!token || token.length > 128) throw new InvalidWalkInScanProofError()

  const claimed = await tx.walkInMemberScanProof.updateMany({
    where: {
      token_hash: hashWalkInScanProof(token),
      distributor_id: distributorId,
      reseller_id: resellerId,
      used_at: null,
      expires_at: { gt: now },
    },
    data: { used_at: now },
  })

  if (claimed.count !== 1) throw new InvalidWalkInScanProofError()
}
