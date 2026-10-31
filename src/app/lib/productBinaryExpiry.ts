import { Prisma } from '@prisma/client'
import { getProductPuExpiryMonths } from './productPuExpiryPolicy'

export async function expireProductPu(tx: Prisma.TransactionClient, userId: string, at = new Date()) {
  await tx.$queryRaw`SELECT expire_product_binary_pu(${userId}, ${at}::timestamptz)`
}

export async function addProductPuLot(tx: Prisma.TransactionClient, userId: string, eventId: string,
  leg: 'left' | 'right', pu: number, earnedAt: Date, at: Date) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('product-pu-expiry-policy'))`
  const months = await getProductPuExpiryMonths(tx)
  await tx.$executeRaw`
    INSERT INTO product_binary_pu_lots(recipient_user_id,order_event_id,leg,original_pu,remaining_pu,earned_at,expires_at)
    VALUES(${userId},${eventId}::uuid,${leg},${pu},${pu},${earnedAt},
      ((${earnedAt}::timestamptz AT TIME ZONE 'Asia/Manila')+make_interval(months => ${months}::int)) AT TIME ZONE 'Asia/Manila')
  `
  if (leg === 'left') {
    await tx.$executeRaw`UPDATE product_binary_positions SET left_carryover_pu=left_carryover_pu+${pu} WHERE user_id=${userId}`
  } else {
    await tx.$executeRaw`UPDATE product_binary_positions SET right_carryover_pu=right_carryover_pu+${pu} WHERE user_id=${userId}`
  }
  // A delayed settlement never renews volume that has already expired.
  await expireProductPu(tx, userId, at)
}

export async function consumeProductPuFifo(tx: Prisma.TransactionClient, userId: string, puPerLeg: number, at: Date) {
  if (puPerLeg === 0) return
  for (const leg of ['left', 'right']) {
    const rows = await tx.$queryRaw<{ consumed: bigint }[]>`
      WITH ordered AS (
        SELECT id,remaining_pu,
          COALESCE(SUM(remaining_pu) OVER (ORDER BY earned_at,id ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING),0) preceding
        FROM product_binary_pu_lots
        WHERE recipient_user_id=${userId} AND leg=${leg} AND remaining_pu>0 AND expires_at>${at}
      ), taken AS (
        UPDATE product_binary_pu_lots l SET
          remaining_pu=l.remaining_pu-LEAST(o.remaining_pu,GREATEST(0,${puPerLeg}-o.preceding))::int,
          consumed_pu=l.consumed_pu+LEAST(o.remaining_pu,GREATEST(0,${puPerLeg}-o.preceding))::int
        FROM ordered o WHERE l.id=o.id AND o.preceding<${puPerLeg}
        RETURNING LEAST(o.remaining_pu,GREATEST(0,${puPerLeg}-o.preceding))::int amount
      ) SELECT COALESCE(SUM(amount),0) consumed FROM taken
    `
    if (Number(rows[0]?.consumed) !== puPerLeg) throw new Error('Product PU FIFO balance does not reconcile.')
  }
}
