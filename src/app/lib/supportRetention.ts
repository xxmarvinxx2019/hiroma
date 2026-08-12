import prisma from '@/app/lib/prisma'
import { deleteSupportAttachments } from '@/app/lib/supportAttachment'
import { getSupportTicketRetentionCutoff } from '@/app/lib/supportRetentionPolicy'

export async function deleteExpiredResolvedSupportTickets(userId?: string) {
  const cutoff = getSupportTicketRetentionCutoff()
  const expired = await prisma.supportRequest.findMany({
    where: {
      status: 'resolved',
      updated_at: { lte: cutoff },
      ...(userId ? { user_id: userId } : {}),
    },
    select: {
      id: true,
      attachments: { select: { storage_path: true } },
    },
  })

  const removableIds: string[] = []
  for (const ticket of expired) {
    try {
      await deleteSupportAttachments(ticket.attachments.map((attachment) => attachment.storage_path))
      removableIds.push(ticket.id)
    } catch (error) {
      console.error(`[SUPPORT RETENTION] Unable to clean attachments for ticket ${ticket.id}.`, error)
    }
  }

  if (!removableIds.length) return 0
  const deleted = await prisma.supportRequest.deleteMany({
    where: {
      id: { in: removableIds },
      status: 'resolved',
      updated_at: { lte: cutoff },
    },
  })
  return deleted.count
}
