import type { Prisma } from '@prisma/client'

type PinTx = Prisma.TransactionClient

export class PinAlreadyClaimedError extends Error {
  constructor() {
    super('PIN is invalid or already used.')
    this.name = 'PinAlreadyClaimedError'
  }
}

export async function claimUnusedPin(tx: PinTx, pinId: string, usedBy?: string) {
  const now = new Date()
  const claimed = await tx.pin.updateMany({
    where: { id: pinId, status: 'unused' },
    data: { status: 'used', used_at: now, ...(usedBy && { used_by: usedBy }) },
  })
  if (claimed.count !== 1) throw new PinAlreadyClaimedError()
  return now
}
