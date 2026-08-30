import prisma from '@/app/lib/prisma'

type DepositNotice = {
  actorId?: string | null
  branchId: string
  depositId: string
  reference: string
  title: string
  message: string
  type: string
}

async function createNotices(userIds: Array<string | null | undefined>, notice: DepositNotice) {
  const recipients = [...new Set(userIds.filter((id): id is string => Boolean(id && id !== notice.actorId)))]
  if (!recipients.length) return
  await prisma.notification.createMany({
    data: recipients.map((userId) => ({
      user_id: userId,
      type: notice.type,
      title: notice.title,
      message: notice.message,
      entity_type: 'branch_cash_deposit',
      entity_id: notice.depositId,
      action_url: '/dashboard/city/deposits#bank-deposit-reconciliation',
    })),
  })
}

export async function notifyDepositConfirmers(notice: DepositNotice) {
  try {
    const profiles = await prisma.staffProfile.findMany({
      where: { owner_id: notice.branchId, is_active: true, permissions: { array_contains: 'deposit_confirm' } },
      select: { user_id: true },
    })
    await createNotices([notice.branchId, ...profiles.map(({ user_id }) => user_id)], notice)
  } catch (error) {
    console.error('[DEPOSIT CONFIRMER NOTIFICATION]', error)
  }
}

export async function notifyAssignedAreaManagers(notice: DepositNotice) {
  try {
    const profiles = await prisma.staffProfile.findMany({
      where: { staff_type: 'area_manager', is_active: true, permissions: { array_contains: `area_branch:${notice.branchId}` } },
      select: { user_id: true },
    })
    const recipients = profiles.map(({ user_id }) => user_id)
    if (!recipients.length) return
    await prisma.notification.createMany({
      data: recipients.filter((id) => id !== notice.actorId).map((userId) => ({
        user_id: userId,
        type: notice.type,
        title: notice.title,
        message: notice.message,
        entity_type: 'branch_cash_deposit',
        entity_id: notice.depositId,
        action_url: '/dashboard/area-manager#bank-deposit-reconciliation',
      })),
    })
  } catch (error) {
    console.error('[DEPOSIT AREA MANAGER NOTIFICATION]', error)
  }
}

export async function notifyDepositParticipants(notice: DepositNotice & { submittedBy: string; confirmedBy?: string | null }) {
  try {
    await createNotices([notice.submittedBy, notice.branchId, notice.confirmedBy], notice)
  } catch (error) {
    console.error('[DEPOSIT PARTICIPANT NOTIFICATION]', error)
  }
}
