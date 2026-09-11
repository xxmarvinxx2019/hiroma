import { createClient } from '@supabase/supabase-js'

// Reuse the existing private financial-evidence bucket. Only service-role code
// can access it; reviewers receive short-lived signed URLs.
const BUCKET = 'deposit-proofs'
const MAX_BYTES = 5 * 1024 * 1024

function storage() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('PIN payment proof storage is not configured.')
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } })
}

export async function uploadPinRequestPaymentProof(cityId: string, requestId: string, evidenceId: string, dataUrl: string) {
  const match = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/=]+)$/i.exec(dataUrl)
  if (!match) throw new Error('Upload a PNG, JPEG, or WebP payment proof.')
  const bytes = Buffer.from(match[2], 'base64')
  if (!bytes.length || bytes.length > MAX_BYTES) throw new Error('Payment proof must be 5 MB or smaller.')
  const subtype = match[1].toLowerCase()
  const mime = subtype === 'jpeg' ? 'image/jpeg' : `image/${subtype}`
  const valid = mime === 'image/jpeg'
    ? bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
    : mime === 'image/png'
      ? bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
      : bytes.subarray(0, 4).toString('ascii') === 'RIFF' && bytes.subarray(8, 12).toString('ascii') === 'WEBP'
  if (!valid) throw new Error('The selected payment proof is not a valid image.')
  const path = `pin-payments/cities/${cityId}/requests/${requestId}/${evidenceId}.${subtype === 'jpeg' ? 'jpg' : subtype}`
  const { error } = await storage().storage.from(BUCKET).upload(path, bytes, { contentType: mime, upsert: false })
  if (error) throw new Error(`Unable to upload payment proof: ${error.message}`)
  return path
}

export async function getPinRequestPaymentProofUrl(path: string | null) {
  if (!path) return null
  const { data, error } = await storage().storage.from(BUCKET).createSignedUrl(path, 15 * 60)
  return error ? null : data.signedUrl
}

export async function removePinRequestPaymentProof(path: string | null) {
  if (!path) return
  await storage().storage.from(BUCKET).remove([path])
}
