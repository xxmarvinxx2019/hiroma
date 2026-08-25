import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/app/lib/auth'
import prisma from '@/app/lib/prisma'
import { distanceKm, recommendFulfillmentDistributor } from '@/app/lib/orderSecurity'
import { geocodeAddress } from '@/app/lib/addressGeocoding'

const distributorSelect = {
  id: true, full_name: true, username: true, mobile: true, address: true, status: true,
  distributor_profile: { select: {
    coverage_area: true, dist_level: true, region_name: true, province_name: true, city_muni_name: true, barangay_name: true,
    fulfillment_latitude: true, fulfillment_longitude: true,
  } },
} as const

type OutletRow = { user_id: string; fulfillment_outlet_name: string | null; fulfillment_outlet_address: string | null }

function withFulfillmentAddress<T extends { id: string; address: string | null; distributor_profile: { coverage_area: string } | null }>(distributor: T, outlets: Map<string, OutletRow>) {
  const outletRow = outlets.get(distributor.id)
  const outlet = outletRow?.fulfillment_outlet_address?.trim()
  return {
    ...distributor,
    fulfillment_address: outlet || distributor.address || distributor.distributor_profile?.coverage_area || null,
    fulfillment_location_source: outlet ? 'physical_outlet' : 'registered_address',
    fulfillment_outlet_name: outlet ? outletRow?.fulfillment_outlet_name || null : null,
  }
}

export async function GET(req: NextRequest) {
  try {
    const user = await getCurrentUser()
    if (!user || user.role !== 'reseller') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const currentUser = await prisma.user.findUnique({ where: { id: user.id }, select: { address: true } })
    const registeredAddress = currentUser?.address || ''
    // `hiroma` is the reserved network/root node and must never fulfill orders.
    // Nationwide inventory and orders belong only to the operational admin login.
    const nationwideSeller = await prisma.user.findFirst({
      where: { username: 'hiroadmin', role: 'admin', status: 'active' },
      select: { id: true, full_name: true, username: true, role: true },
    })

    const profile = await prisma.resellerProfile.findUnique({
      where: { user_id: user.id },
      select: { city_dist_id: true, city_dist: { select: distributorSelect } },
    })
    if (!profile?.city_dist || profile.city_dist.status !== 'active') {
      return NextResponse.json({
        distributors: [],
        assigned_distributor: null,
        default_city_dist_id: null,
        registered_address: registeredAddress,
        nationwide_seller: nationwideSeller,
        error: 'No active distributor is assigned to this reseller.',
      }, { headers: { 'Cache-Control': 'private, no-store, max-age=0' } })
    }

    const rawDistributors = await prisma.user.findMany({
      where: { role: 'city', status: 'active', distributor_profile: { is: { is_active: true, dist_level: { in: ['city', 'branch'] } } } },
      select: distributorSelect, orderBy: { full_name: 'asc' },
    })
    let outletRows: OutletRow[] = []
    try {
      outletRows = await prisma.$queryRaw<OutletRow[]>`
        SELECT "user_id", "fulfillment_outlet_name", "fulfillment_outlet_address"
        FROM "distributor_profiles"
        WHERE "fulfillment_outlet_address" IS NOT NULL
      `
    } catch {
      // The optional outlet migration may not be applied yet. Registered addresses remain the safe fallback.
    }
    const outlets = new Map(outletRows.map((row) => [row.user_id, row]))
    const distributors = rawDistributors.map((distributor) => withFulfillmentAddress(distributor, outlets))
    const assignedDistributor = withFulfillmentAddress(profile.city_dist, outlets)
    const address = (req.nextUrl.searchParams.get('address') || registeredAddress).trim()
    const region = req.nextUrl.searchParams.get('region') || ''
    const province = req.nextUrl.searchParams.get('province') || ''
    const city = req.nextUrl.searchParams.get('city') || ''
    const barangay = req.nextUrl.searchParams.get('barangay') || ''
    const recommendation = recommendFulfillmentDistributor(distributors.map((distributor) => ({
      id: distributor.id,
      full_name: distributor.full_name,
      coverage_area: distributor.distributor_profile?.coverage_area,
      region_name: distributor.distributor_profile?.region_name,
      province_name: distributor.distributor_profile?.province_name,
      city_muni_name: distributor.distributor_profile?.city_muni_name,
      barangay_name: distributor.distributor_profile?.barangay_name,
    })), profile.city_dist_id, { address, region, province, city, barangay })
    const recommendedDistributor = distributors.find(({ id }) => id === recommendation?.distributor.id) || assignedDistributor
    let informationalDistance: number | null = null
    const partnerAddress = recommendedDistributor.fulfillment_address?.trim()
    if (address && partnerAddress) {
      try {
        const [customerPoint, partnerPoint] = await Promise.all([
          geocodeAddress(address),
          geocodeAddress(partnerAddress),
        ])
        if (customerPoint && partnerPoint) {
          informationalDistance = distanceKm(customerPoint, partnerPoint)
        }
      } catch (geocodingError) {
        // Distance is informational only. A public geocoder outage must not
        // change the address-based recommendation or block checkout.
        console.warn('[FULFILLMENT DISTANCE UNAVAILABLE]', geocodingError)
      }
    }
    return NextResponse.json({ distributors, assigned_distributor: assignedDistributor, default_city_dist_id: profile.city_dist_id, registered_address: registeredAddress, recommended_distributor: recommendedDistributor, recommendation_basis: recommendation?.basis || 'assigned_fallback', distance_km: informationalDistance === null ? null : Math.round(informationalDistance * 10) / 10, distance_type: informationalDistance === null ? null : 'straight_line', distance_source: informationalDistance === null ? null : 'mapped_addresses', nationwide_seller: nationwideSeller }, { headers: { 'Cache-Control': 'private, no-store, max-age=0' } })
  } catch (error) {
    console.error('[RESELLER CITY DISTS ERROR]', error)
    return NextResponse.json({ error: 'Something went wrong.' }, { status: 500 })
  }
}
