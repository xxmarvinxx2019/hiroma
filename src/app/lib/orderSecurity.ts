export type OrderViewerRole = 'admin' | 'regional' | 'provincial' | 'city' | 'reseller' | 'staff'

export function orderParticipantScope(userId: string, role: OrderViewerRole) {
  return role === 'admin' ? {} : { OR: [{ buyer_id: userId }, { seller_id: userId }] }
}

export function cityOrderListScope(userId: string, tab: string) {
  return tab === 'my_orders' ? { buyer_id: userId } : { seller_id: userId }
}

export type FulfillmentCandidate = {
  id: string
  full_name: string
  coverage_area?: string | null
  region_name?: string | null
  province_name?: string | null
  city_muni_name?: string | null
  barangay_name?: string | null
}

export type DeliveryLocationInput = {
  address?: string
  region?: string
  province?: string
  city?: string
  barangay?: string
}

const normalize = (value: string) => value.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter((part) => part.length >= 3)

export function recommendFulfillmentDistributor(
  candidates: readonly FulfillmentCandidate[],
  assignedDistributorId: string,
  location: DeliveryLocationInput,
) {
  const addressTokens = new Set(normalize(location.address || ''))
  const scored = candidates.map((candidate) => ({ candidate, score:
    (location.barangay && candidate.barangay_name?.toLowerCase() === location.barangay.toLowerCase() ? 1000 : 0) +
    (location.city && candidate.city_muni_name?.toLowerCase() === location.city.toLowerCase() ? 100 : 0) +
    (location.province && candidate.province_name?.toLowerCase() === location.province.toLowerCase() ? 10 : 0) +
    (location.region && candidate.region_name?.toLowerCase() === location.region.toLowerCase() ? 1 : 0) +
    normalize(candidate.coverage_area || '').reduce((score, token) => score + (addressTokens.has(token) ? 0.01 : 0), 0),
  }))
  const best = scored.sort((a, b) => b.score - a.score || a.candidate.full_name.localeCompare(b.candidate.full_name))[0]
  const assigned = candidates.find(({ id }) => id === assignedDistributorId) || null
  const candidate = best?.score ? best.candidate : assigned
  const basis = !best?.score ? 'assigned_fallback' : best.score >= 1000 ? 'exact_barangay' : best.score >= 100 ? 'exact_city' : best.score >= 10 ? 'exact_province' : best.score >= 1 ? 'same_region' : 'address_keywords'
  return candidate ? { distributor: candidate, basis } : null
}
