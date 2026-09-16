import { createHash } from 'node:crypto'

// UUID v5 in the DNS namespace: stable retries without inserting text into a UUID column.
export function notificationUuid(key: string) {
  const namespace = Buffer.from('6ba7b8109dad11d180b400c04fd430c8', 'hex')
  const bytes = createHash('sha1').update(namespace).update(key).digest().subarray(0, 16)
  bytes[6] = (bytes[6] & 0x0f) | 0x50
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const hex = bytes.toString('hex')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}
