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
