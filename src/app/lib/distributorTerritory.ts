import { Prisma } from '@prisma/client'
import prisma from '@/app/lib/prisma'

export type ExclusiveDistributorLevel = 'regional' | 'provincial' | 'city' | 'branch'
type TerritoryClient = Prisma.TransactionClient | typeof prisma

export function territoryKey(level: ExclusiveDistributorLevel, input: {
  regionCode?: string | null
  provinceCode?: string | null
  cityMuniCode?: string | null
}) {
  if (level === 'regional') return input.regionCode?.trim() || null
  if (level === 'provincial') return input.provinceCode?.trim() || null
  return input.cityMuniCode?.trim() || null
}

export async function findActiveTerritoryHolder(
  db: TerritoryClient,
  level: ExclusiveDistributorLevel,
  code: string,
) {
  const normalized = code.trim()
  if (!normalized) return null
  return db.distributorProfile.findFirst({
    where: {
      is_active: true,
      ...(level === 'regional'
        ? { dist_level: 'regional', region_code: normalized }
        : level === 'provincial'
          ? { dist_level: 'provincial', province_code: normalized }
          : { dist_level: { in: ['city', 'branch'] }, city_muni_code: normalized }),
    },
    select: {
      id: true,
      dist_level: true,
      coverage_area: true,
      user: { select: { id: true, full_name: true, username: true } },
    },
  })
}

export function territoryConflictMessage(level: ExclusiveDistributorLevel) {
  if (level === 'regional') return 'This region is already assigned to an active Regional Distributor.'
  if (level === 'provincial') return 'This province is already assigned to an active Provincial Distributor.'
  return 'This city/municipality is already assigned to an active City Distributor or Hiroma Branch.'
}


export function distributorTerritoryWriteError(error: unknown): string | undefined {
  const message = (error instanceof Error ? error.message : '') + JSON.stringify(error)
  if (message.includes('DISTRIBUTOR_PARENT_TERRITORY_MISMATCH')) return 'The parent distributor must serve the same province or region as this distributor.'
  if (message.includes('DISTRIBUTOR_CHILD_TERRITORY_MISMATCH')) return 'This location change conflicts with existing child distributors. Reassign them first.'
  if (message.includes('DISTRIBUTOR_TERRITORY_REQUIRED') || message.includes('TERRITORY_CODE_REQUIRED')) return 'Complete the distributor region, province and city/municipality assignment before activation.'
  if (['TERRITORY_ALREADY_ASSIGNED', 'distributor_active_region_unique', 'distributor_active_province_unique', 'distributor_active_city_branch_unique'].some(key => message.includes(key))) return 'This location is already assigned to an active distributor at that level.'
}
