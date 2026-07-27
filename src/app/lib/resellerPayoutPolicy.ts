import prisma from '@/app/lib/prisma'

export type ResellerPayoutMode = 'cash' | 'check' | 'account'

export async function getResellerPayoutMode(): Promise<ResellerPayoutMode> {
  const setting = await prisma.systemSetting.findUnique({ where: { key: 'reseller_payout_mode' } })
  return ['cash', 'check', 'account'].includes(setting?.value || '')
    ? setting!.value as ResellerPayoutMode
    : 'cash'
}
