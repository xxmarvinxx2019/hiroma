import prisma from '@/app/lib/prisma'

type PosNotificationInput = {
  ownerId: string
  actorId?: string | null
  permission: 'pos_approve' | 'register_reseller'
  type: string
  title: string
  message: string
  entityType: string
  entityId: string
  actionUrl: string
}

/** Notify the location owner and every active staff member assigned to review this work. */
export async function notifyPosReviewers(input: PosNotificationInput) {
  try {
    const reviewers = await prisma.staffProfile.findMany({
      where: {
        owner_id: input.ownerId,
        is_active: true,
        permissions: { array_contains: input.permission },
      },
      select: { user_id: true },
    })
    const recipients = [...new Set([input.ownerId, ...reviewers.map((row) => row.user_id)])]
      .filter((id) => id && id !== input.actorId)
    if (recipients.length === 0) return

    await prisma.notification.createMany({
      data: recipients.map((userId) => ({
        user_id: userId,
        type: input.type,
        title: input.title,
        message: input.message,
        entity_type: input.entityType,
        entity_id: input.entityId,
        action_url: input.actionUrl,
      })),
    })
  } catch (error) {
    // The business transaction must remain successful even if a notification provider is unavailable.
    console.error('[POS REVIEWER NOTIFICATION]', error)
  }
}
