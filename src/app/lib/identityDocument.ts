import { createHmac } from 'crypto'

export const IDENTITY_DOCUMENT_TYPES = [
  'National ID',
  'Passport',
  'Driver’s License',
  'TIN ID',
  'UMID',
  'PhilHealth ID',
  'Voter’s ID',
  'Postal ID',
  'PRC ID',
] as const

export type IdentityDocumentType = (typeof IDENTITY_DOCUMENT_TYPES)[number]

export function normalizeIdentityDocumentNumber(value: string): string {
  return value.trim().toUpperCase().replace(/[^A-Z0-9]/g, '')
}

export function validateIdentityDocument(type: string, number: string): asserts type is IdentityDocumentType {
  if (!IDENTITY_DOCUMENT_TYPES.includes(type as IdentityDocumentType)) {
    throw new Error('Please select a valid ID type.')
  }
  if (normalizeIdentityDocumentNumber(number).length < 4) {
    throw new Error('Please enter a valid ID number.')
  }
}

export function hashIdentityDocument(type: string, number: string): string {
  validateIdentityDocument(type, number)
  const secret = process.env.IDENTITY_HASH_SECRET || process.env.JWT_SECRET
  if (!secret) throw new Error('Identity matching is not configured.')

  return createHmac('sha256', secret)
    .update(`${type}|${normalizeIdentityDocumentNumber(number)}`)
    .digest('hex')
}
