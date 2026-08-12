import prisma from '@/app/lib/prisma'
import { getPersonNameCoreParts, normalizePersonName } from '@/app/lib/nameFormat'
import { hashIdentityDocument } from '@/app/lib/identityDocument'

const MAX_ACCOUNTS_PER_PERSON = 7

type ExistingIdentityAccount = {
  username: string
  full_name: string
  birthday: string | null
  identity_document_hash: string | null
}

function cleanUsernamePart(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '')
}

function toBirthdayKey(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return date.toISOString().slice(0, 10)
}

function buildStem(fullName: string, lastNameLetters = 1): string {
  const parts = getPersonNameCoreParts(fullName)
  const firstName = cleanUsernamePart(parts[0] || '')
  if (parts.length === 1) return firstName

  const middleInitials = parts.slice(1, -1)
    .map((part) => cleanUsernamePart(part).charAt(0))
    .join('')
  const lastName = cleanUsernamePart(parts.at(-1) || '')
  return `${firstName}${middleInitials}${lastName.slice(0, Math.max(1, lastNameLetters))}`
}

export type UsernamePlan = {
  username: string
  accountNumber: number
  existingAccountCount: number
  maxAccounts: number
  remainingAfterRegistration: number
  isFirstAccount: boolean
  identityKey: string
  confirmationRequired: boolean
  matchingUsernames: string[]
}

export async function generateUsernamePlan(input: {
  fullName: string
  birthday: string
  birthplace: string
  identityDocumentType?: string
  identityDocumentNumber?: string
  mobile?: string
  email?: string
  identityConfirmation?: 'same' | 'different'
}): Promise<UsernamePlan> {
  const fullName = normalizePersonName(input.fullName)
  const legalNameCoreKey = getLegalNameCoreKey(fullName)
  const birthdayKey = toBirthdayKey(input.birthday)
  const identityDocumentHash = input.identityDocumentType && input.identityDocumentNumber
    ? hashIdentityDocument(input.identityDocumentType, input.identityDocumentNumber)
    : null

  if (!legalNameCoreKey || legalNameCoreKey === '|' || !birthdayKey || !input.birthplace.trim()) {
    throw new Error('Full name, valid birth date, and place of birth are required to generate a username.')
  }

  const sameNameAccounts = await prisma.$queryRaw<ExistingIdentityAccount[]>`
    SELECT username,
           full_name,
           birthday::text AS birthday,
           identity_document_hash
    FROM users
    WHERE role = 'reseller'
      AND status != 'inactive'
      AND (
        birthday::text = ${birthdayKey}
        OR (${identityDocumentHash}::text IS NOT NULL AND identity_document_hash = ${identityDocumentHash})
      )
    ORDER BY created_at ASC
  `

  const samePersonAccounts = sameNameAccounts.filter((account) =>
    (account.birthday === birthdayKey && getLegalNameCoreKey(account.full_name) === legalNameCoreKey) ||
    (identityDocumentHash !== null && account.identity_document_hash === identityDocumentHash)
  )
  const confirmationRequired = samePersonAccounts.length > 0 && !input.identityConfirmation
  const existingAccountCount = input.identityConfirmation === 'same' ? samePersonAccounts.length : 0
  if (existingAccountCount >= MAX_ACCOUNTS_PER_PERSON) {
    throw new Error(`Maximum accounts (${MAX_ACCOUNTS_PER_PERSON}) reached for this person.`)
  }

  const isFirstAccount = existingAccountCount === 0
  let accountNumber = existingAccountCount + 1
  let stem: string

  if (!isFirstAccount) {
    // Keep the stem assigned to this exact person (for example DCR).
    stem = samePersonAccounts[0]?.username.replace(/\d{2}$/, '') || buildStem(fullName, 1)
  } else {
    // A different person with the same name receives more last-name letters.
    let lastNameLetters = sameNameAccounts.length > 0 ? 2 : 1
    stem = buildStem(fullName, lastNameLetters)
    while (lastNameLetters < 20) {
      const candidate = `${stem}${String(accountNumber).padStart(2, '0')}`
      const exists = await prisma.user.findUnique({ where: { username: candidate }, select: { id: true } })
      if (!exists) break
      lastNameLetters += 1
      stem = buildStem(fullName, lastNameLetters)
    }
  }

  let username = `${stem}${String(accountNumber).padStart(2, '0')}`
  while (await prisma.user.findUnique({ where: { username }, select: { id: true } })) {
    accountNumber += 1
    if (accountNumber > 99) throw new Error('Unable to generate a unique username. Please contact admin.')
    username = `${stem}${String(accountNumber).padStart(2, '0')}`
  }

  return {
    username,
    accountNumber,
    existingAccountCount,
    maxAccounts: MAX_ACCOUNTS_PER_PERSON,
    remainingAfterRegistration: MAX_ACCOUNTS_PER_PERSON - (existingAccountCount + 1),
    isFirstAccount,
    identityKey: `${legalNameCoreKey}|${birthdayKey}`,
    confirmationRequired,
    matchingUsernames: samePersonAccounts.map((account) => account.username),
  }
}

function getLegalNameCoreKey(fullName: string): string {
  const parts = getPersonNameCoreParts(fullName)
  return `${cleanUsernamePart(parts[0] || '')}|${cleanUsernamePart(parts.at(-1) || '')}`
}
