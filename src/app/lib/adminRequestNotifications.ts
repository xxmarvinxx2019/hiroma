import { Prisma } from '@prisma/client'

type AdminRequestNotification = {
  type: string
  title: string
  message: string
  entityType: string
  entityId: string
  actionUrl: string
  amount?: number
}

/** Persist one notification for every active Admin account in the same transaction as the request. */
export async function notifyActiveAdmins(
  tx: Prisma.TransactionClient,
  notice: AdminRequestNotification,
) {
  const admins = await tx.user.findMany({
    where: { role: 'admin', status: 'active' },
    select: { id: true },
  })
  if (admins.length === 0) return

  await tx.notification.createMany({
    data: admins.map(({ id }) => ({
      user_id: id,
      type: notice.type,
      title: notice.title,
      message: notice.message,
      amount: notice.amount,
      entity_type: notice.entityType,
      entity_id: notice.entityId,
      action_url: notice.actionUrl,
    })),
  })
}
