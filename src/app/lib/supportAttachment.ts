import { createClient } from '@supabase/supabase-js'

const BUCKET = 'Profile'
const MAX_BYTES = 3 * 1024 * 1024
function storage() { const url = process.env.NEXT_PUBLIC_SUPABASE_URL; const key = process.env.SUPABASE_SERVICE_ROLE_KEY; if (!url || !key) throw new Error('File storage is not configured.'); return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } }) }
export async function uploadSupportScreenshot(ticketId: string, dataUrl: string, filename: string) {
  const match = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/=]+)$/i.exec(dataUrl); if (!match) throw new Error('Upload a PNG, JPEG, or WebP screenshot.')
  const bytes = Buffer.from(match[2], 'base64'); if (!bytes.length || bytes.length > MAX_BYTES) throw new Error('Screenshot must be 3 MB or smaller.')
  const type = match[1].toLowerCase(); const ext = type === 'jpeg' ? 'jpg' : type; const mime = type === 'jpeg' ? 'image/jpeg' : `image/${type}`; const path = `support/${ticketId}/${crypto.randomUUID()}.${ext}`
  const { error } = await storage().storage.from(BUCKET).upload(path, bytes, { contentType: mime, upsert: false }); if (error) throw new Error('Unable to upload screenshot.')
  return { storage_path: path, filename: filename.slice(0, 150), mime_type: mime }
}
export async function getSupportAttachmentUrl(path: string) { const { data, error } = await storage().storage.from(BUCKET).createSignedUrl(path, 60 * 60); return error ? null : data.signedUrl }
export async function deleteSupportAttachments(paths: string[]) {
  if (!paths.length) return
  const { error } = await storage().storage.from(BUCKET).remove(paths)
  if (error) throw new Error('Unable to remove stored support attachments.')
}
