import prisma from '@/app/lib/prisma'
import { MAINTENANCE_SETTING_KEYS, parseMaintenanceState, type MaintenanceState } from '@/app/lib/maintenanceState'

export * from '@/app/lib/maintenanceState'

export async function getMaintenanceState(): Promise<MaintenanceState> {
  const rows = await prisma.systemSetting.findMany({
    where: { key: { in: MAINTENANCE_SETTING_KEYS } },
    select: { key: true, value: true, updated_at: true, updated_by: true },
  })

  return parseMaintenanceState(rows)
}

