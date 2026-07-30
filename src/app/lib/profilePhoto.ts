import { createClient } from '@supabase/supabase-js'

const PROFILE_BUCKET = 'Profile'
const MAX_PROFILE_PHOTO_BYTES = 400 * 1024

function storageAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !serviceRoleKey) throw new Error('Supabase Storage is not configured.')
  return createClient(url, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } })
}

export async function getProfilePhotoDisplayUrl(value: string | null | undefined) {
  if (!value || value.startsWith('data:') || /^https?:\/\//i.test(value)) return value || null
  const { data, error } = await storageAdmin().storage.from(PROFILE_BUCKET).createSignedUrl(value, 60 * 60)
  if (error) {
    console.error('[PROFILE PHOTO SIGN ERROR]', error.message)
    return null
  }
  return data.signedUrl
}

export async function uploadProfilePhoto(userId: string, dataUrl: string) {
  const match = /^data:image\/(webp|jpeg|png);base64,([A-Za-z0-9+/=]+)$/i.exec(dataUrl)
  if (!match) throw new Error('Use a JPEG, PNG, or WebP image.')

  const mimeSubtype = match[1].toLowerCase()
  const contentType = mimeSubtype === 'jpeg' ? 'image/jpeg' : `image/${mimeSubtype}`
  const bytes = Buffer.from(match[2], 'base64')
  if (!bytes.length || bytes.length > MAX_PROFILE_PHOTO_BYTES) {
    throw new Error('Compressed profile photo must be 400 KB or smaller.')
  }

  const validSignature = contentType === 'image/jpeg'
    ? bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
    : contentType === 'image/png'
      ? bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
      : bytes.subarray(0, 4).toString('ascii') === 'RIFF' && bytes.subarray(8, 12).toString('ascii') === 'WEBP'
  if (!validSignature) throw new Error('The selected file is not a valid image.')

  const extension = mimeSubtype === 'jpeg' ? 'jpg' : mimeSubtype
  const path = `users/${userId}/avatar.${extension}`
  const { error } = await storageAdmin().storage.from(PROFILE_BUCKET).upload(path, bytes, {
    contentType,
    cacheControl: '3600',
    upsert: true,
  })
  if (error) throw new Error(`Unable to upload profile photo: ${error.message}`)
  return path
}

export async function removeProfilePhoto(value: string | null | undefined) {
  if (!value || value.startsWith('data:') || /^https?:\/\//i.test(value)) return
  const { error } = await storageAdmin().storage.from(PROFILE_BUCKET).remove([value])
  if (error) console.error('[PROFILE PHOTO REMOVE ERROR]', error.message)
}
