import { createHash } from 'crypto'
import prisma from '@/app/lib/prisma'

type GeocodePoint = { latitude: number; longitude: number; label: string | null }

declare global {
  var hiromaNominatimLastRequestAt: number | undefined
  var hiromaNominatimQueue: Promise<void> | undefined
}

const normalizeAddress = (address: string) => address.trim().replace(/\s+/g, ' ').toLowerCase()
const addressHash = (address: string) => createHash('sha256').update(normalizeAddress(address)).digest('hex')

async function waitForPublicRateLimit() {
  const previous = global.hiromaNominatimQueue || Promise.resolve()
  let release!: () => void
  global.hiromaNominatimQueue = new Promise<void>((resolve) => { release = resolve })
  await previous
  const elapsed = Date.now() - (global.hiromaNominatimLastRequestAt || 0)
  if (elapsed < 1100) await new Promise((resolve) => setTimeout(resolve, 1100 - elapsed))
  global.hiromaNominatimLastRequestAt = Date.now()
  release()
}

async function geocodeSingleAddress(address: string): Promise<GeocodePoint | null> {
  const normalized = normalizeAddress(address)
  if (normalized.length < 8) return null
  const hash = addressHash(normalized)
  const cached = await prisma.addressGeocodeCache.findUnique({ where: { address_hash: hash } })
  const negativeCacheValid = cached?.lookup_status === 'not_found' && Date.now() - cached.last_lookup_at.getTime() < 7 * 24 * 60 * 60 * 1000
  if (cached?.latitude != null && cached.longitude != null) return { latitude: Number(cached.latitude), longitude: Number(cached.longitude), label: cached.result_label }
  if (negativeCacheValid) return null

  await waitForPublicRateLimit()
  const params = new URLSearchParams({ q: address, format: 'jsonv2', limit: '1', countrycodes: 'ph', addressdetails: '0' })
  const contactEmail = process.env.GEOCODING_CONTACT_EMAIL?.trim()
  if (contactEmail) params.set('email', contactEmail)
  const response = await fetch(`https://nominatim.openstreetmap.org/search?${params}`, {
    headers: { 'User-Agent': 'HiromaDigital/1.0', Accept: 'application/json', 'Accept-Language': 'en' },
    cache: 'no-store',
    signal: AbortSignal.timeout(15000),
  })
  if (!response.ok) throw new Error(`Geocoding service returned ${response.status}`)
  const results = await response.json() as Array<{ lat?: string; lon?: string; display_name?: string }>
  const latitude = Number(results[0]?.lat)
  const longitude = Number(results[0]?.lon)
  const found = Number.isFinite(latitude) && Number.isFinite(longitude)
  await prisma.addressGeocodeCache.upsert({
    where: { address_hash: hash },
    update: { latitude: found ? latitude : null, longitude: found ? longitude : null, result_label: found ? results[0]?.display_name || null : null, lookup_status: found ? 'found' : 'not_found', last_lookup_at: new Date() },
    create: { address_hash: hash, latitude: found ? latitude : null, longitude: found ? longitude : null, result_label: found ? results[0]?.display_name || null : null, lookup_status: found ? 'found' : 'not_found' },
  })
  return found ? { latitude, longitude, label: results[0]?.display_name || null } : null
}

export async function geocodeAddress(address: string): Promise<GeocodePoint | null> {
  const normalized = address.trim().replace(/\s+/g, ' ')
  if (normalized.length < 8) return null

  // Public maps may not contain a local street or purok. Try the complete
  // address first, then a single locality-level fallback without the first
  // comma-separated segment. Each candidate has its own persistent cache key.
  const parts = normalized.split(',').map((part) => part.trim()).filter(Boolean)
  const candidates = [normalized]
  if (parts.length >= 3) candidates.push(parts.slice(1).join(', '))

  for (const candidate of [...new Set(candidates)]) {
    const point = await geocodeSingleAddress(candidate)
    if (point) return point
  }
  return null
}
