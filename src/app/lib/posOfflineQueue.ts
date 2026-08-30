'use client'

export type PosQueuedSale = {
  client_transaction_id: string
  receipt_number: string
  payload: Record<string, unknown>
  receipt: Record<string, unknown>
  status: 'saved_offline' | 'syncing' | 'needs_attention'
  error?: string
  created_at: string
  offline_scope_id?: string
}

export type PosQueuedRegistration = {
  client_intake_id: string
  receipt_number: string
  payload: Record<string, unknown>
  status: 'saved_offline' | 'syncing' | 'needs_attention'
  error?: string
  created_at: string
  offline_scope_id?: string
}

export type PosOfflineScope = { owner_id: string; terminal_id: string }

type EncryptedPayload = {
  offline_encryption_version: 1
  iv: string
  ciphertext: string
}

type StoredQueuedSale = Pick<PosQueuedSale, 'client_transaction_id' | 'created_at' | 'offline_scope_id'> & {
  encrypted_payload: EncryptedPayload
}

type StoredQueuedRegistration = Pick<PosQueuedRegistration, 'client_intake_id' | 'created_at' | 'offline_scope_id'> & {
  encrypted_payload: EncryptedPayload
}

const DB_NAME = 'hiroma-pos'
const STORE = 'sales'
const REGISTRATION_STORE = 'registrations'
const SETTINGS_STORE = 'settings'
const ACTIVE_SCOPE_KEY = 'hiroma_pos_active_scope_v1'
const SEALED_SCOPE_KEY = 'hiroma_pos_scope_sealed_v1'
const ENCRYPTION_KEY_PREFIX = 'offline-crypto-key:'
const ENCRYPTION_VERSION = 1

function bytesToBase64(bytes: Uint8Array) {
  let binary = ''
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000))
  }
  return btoa(binary)
}

function base64ToBytes(value: string) {
  const binary = atob(value)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
  return bytes
}

function isEncryptedPayload(value: unknown): value is EncryptedPayload {
  if (!value || typeof value !== 'object') return false
  const row = value as Partial<EncryptedPayload>
  return row.offline_encryption_version === ENCRYPTION_VERSION
    && typeof row.iv === 'string'
    && typeof row.ciphertext === 'string'
}

function isStoredQueuedSale(value: unknown): value is StoredQueuedSale {
  return Boolean(value && typeof value === 'object' && isEncryptedPayload((value as StoredQueuedSale).encrypted_payload))
}

function isStoredQueuedRegistration(value: unknown): value is StoredQueuedRegistration {
  return Boolean(value && typeof value === 'object' && isEncryptedPayload((value as StoredQueuedRegistration).encrypted_payload))
}

export function posOfflineScopeId(scope: PosOfflineScope) {
  return `${scope.owner_id}:${scope.terminal_id}`
}

function scopeFromBootstrap(value: unknown): PosOfflineScope | null {
  if (!value || typeof value !== 'object') return null
  const row = value as { location?: { id?: unknown } | null; terminal?: { id?: unknown } | null }
  return typeof row.location?.id === 'string' && typeof row.terminal?.id === 'string'
    ? { owner_id: row.location.id, terminal_id: row.terminal.id }
    : null
}

function activeScope(): PosOfflineScope | null {
  try {
    const value = JSON.parse(localStorage.getItem(ACTIVE_SCOPE_KEY) || 'null') as Partial<PosOfflineScope> | null
    return typeof value?.owner_id === 'string' && typeof value?.terminal_id === 'string'
      ? { owner_id: value.owner_id, terminal_id: value.terminal_id }
      : null
  } catch {
    localStorage.removeItem(ACTIVE_SCOPE_KEY)
    return null
  }
}

function requireActiveScope() {
  const scope = activeScope()
  if (!scope) throw new Error('Sign in online once to unlock this terminal\'s protected offline data.')
  return scope
}

export function queuedRecordBelongsToScope(row: { offline_scope_id?: string }, scope: PosOfflineScope) {
  return row.offline_scope_id === posOfflineScopeId(scope)
}

function database(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 3)
    let settled = false
    const timeout = window.setTimeout(() => {
      if (settled) return
      settled = true
      reject(new Error('Offline POS storage is busy. Close other POS windows and try again.'))
    }, 3000)
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'client_transaction_id' })
      if (!db.objectStoreNames.contains(REGISTRATION_STORE)) db.createObjectStore(REGISTRATION_STORE, { keyPath: 'client_intake_id' })
      if (!db.objectStoreNames.contains(SETTINGS_STORE)) db.createObjectStore(SETTINGS_STORE)
    }
    request.onblocked = () => {
      if (settled) return
      settled = true
      window.clearTimeout(timeout)
      reject(new Error('Offline POS storage upgrade is blocked. Close other POS windows and reopen the app.'))
    }
    request.onsuccess = () => {
      const db = request.result
      db.onversionchange = () => db.close()
      if (settled) {
        db.close()
        return
      }
      settled = true
      window.clearTimeout(timeout)
      resolve(db)
    }
    request.onerror = () => {
      if (settled) return
      settled = true
      window.clearTimeout(timeout)
      reject(request.error || new Error('Unable to open the offline POS queue.'))
    }
  })
}

async function operateStore<T>(mode: IDBTransactionMode, action: (store: IDBObjectStore) => IDBRequest<T>, storeName = STORE): Promise<T> {
  const db = await database()
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(storeName, mode)
    const request = action(transaction.objectStore(storeName))
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error || new Error('Offline POS storage failed.'))
    transaction.oncomplete = () => db.close()
    transaction.onabort = () => db.close()
    transaction.onerror = () => db.close()
  })
}

async function loadOrCreateScopeKey(scope: PosOfflineScope): Promise<CryptoKey> {
  const keyName = `${ENCRYPTION_KEY_PREFIX}${posOfflineScopeId(scope)}`
  const create = async () => {
    const existing = await operateStore<unknown>('readonly', (store) => store.get(keyName), SETTINGS_STORE)
    if (existing instanceof CryptoKey && existing.algorithm.name === 'AES-GCM' && existing.extractable === false) {
      return existing
    }

    const generated = await crypto.subtle.generateKey(
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt'],
    )
    try {
      await operateStore('readwrite', (store) => store.add(generated, keyName), SETTINGS_STORE)
      return generated
    } catch {
      const winner = await operateStore<unknown>('readonly', (store) => store.get(keyName), SETTINGS_STORE)
      if (winner instanceof CryptoKey && winner.algorithm.name === 'AES-GCM' && winner.extractable === false) {
        return winner
      }
      throw new Error('Unable to initialize protected offline storage. Reopen the POS while online and try again.')
    }
  }

  if (navigator.locks) {
    return navigator.locks.request(`hiroma-pos-key:${posOfflineScopeId(scope)}`, create)
  }
  return create()
}

async function encryptOfflineValue(scope: PosOfflineScope, storeName: string, recordId: string, value: unknown): Promise<EncryptedPayload> {
  const key = await loadOrCreateScopeKey(scope)
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const additionalData = new TextEncoder().encode(`${posOfflineScopeId(scope)}:${storeName}:${recordId}`)
  const plaintext = new TextEncoder().encode(JSON.stringify(value))
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData }, key, plaintext)
  return {
    offline_encryption_version: ENCRYPTION_VERSION,
    iv: bytesToBase64(iv),
    ciphertext: bytesToBase64(new Uint8Array(ciphertext)),
  }
}

async function decryptOfflineValue<T>(scope: PosOfflineScope, storeName: string, recordId: string, value: EncryptedPayload): Promise<T> {
  try {
    const key = await loadOrCreateScopeKey(scope)
    const additionalData = new TextEncoder().encode(`${posOfflineScopeId(scope)}:${storeName}:${recordId}`)
    const plaintext = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: base64ToBytes(value.iv), additionalData },
      key,
      base64ToBytes(value.ciphertext),
    )
    return JSON.parse(new TextDecoder().decode(plaintext)) as T
  } catch {
    throw new Error('Protected offline data could not be opened on this terminal. Reconnect and contact the branch manager before creating another receipt.')
  }
}

async function storeQueuedSale(scope: PosOfflineScope, sale: PosQueuedSale) {
  const scoped = { ...sale, offline_scope_id: posOfflineScopeId(scope) }
  const stored: StoredQueuedSale = {
    client_transaction_id: sale.client_transaction_id,
    created_at: sale.created_at,
    offline_scope_id: scoped.offline_scope_id,
    encrypted_payload: await encryptOfflineValue(scope, STORE, sale.client_transaction_id, scoped),
  }
  return operateStore('readwrite', (store) => store.put(stored))
}

async function storeQueuedRegistration(scope: PosOfflineScope, row: PosQueuedRegistration) {
  const scoped = { ...row, offline_scope_id: posOfflineScopeId(scope) }
  const stored: StoredQueuedRegistration = {
    client_intake_id: row.client_intake_id,
    created_at: row.created_at,
    offline_scope_id: scoped.offline_scope_id,
    encrypted_payload: await encryptOfflineValue(scope, REGISTRATION_STORE, row.client_intake_id, scoped),
  }
  return operateStore('readwrite', (store) => store.put(stored), REGISTRATION_STORE)
}

export function filterQueuedRecordsForScope<T extends { offline_scope_id?: string }>(rows: T[], scope: PosOfflineScope) {
  return rows.filter((row) => queuedRecordBelongsToScope(row, scope))
}

export const saveQueuedSale = (sale: PosQueuedSale) => {
  const scope = requireActiveScope()
  return storeQueuedSale(scope, sale)
}

export async function deleteQueuedSale(id: string) {
  const scope = requireActiveScope()
  const row = await operateStore<PosQueuedSale | StoredQueuedSale | undefined>('readonly', (store) => store.get(id))
  if (!row || !queuedRecordBelongsToScope(row, scope)) return
  await operateStore('readwrite', (store) => store.delete(id))
}

export async function listQueuedSales() {
  const scope = requireActiveScope()
  const rows = await operateStore<Array<PosQueuedSale | StoredQueuedSale>>('readonly', (store) => store.getAll())
  return Promise.all(filterQueuedRecordsForScope(rows, scope).map((row) => isStoredQueuedSale(row)
    ? decryptOfflineValue<PosQueuedSale>(scope, STORE, row.client_transaction_id, row.encrypted_payload)
    : row))
}

export const saveQueuedRegistration = (row: PosQueuedRegistration) => {
  const scope = requireActiveScope()
  return storeQueuedRegistration(scope, row)
}

export async function deleteQueuedRegistration(id: string) {
  const scope = requireActiveScope()
  const row = await operateStore<PosQueuedRegistration | StoredQueuedRegistration | undefined>('readonly', (store) => store.get(id), REGISTRATION_STORE)
  if (!row || !queuedRecordBelongsToScope(row, scope)) return
  await operateStore('readwrite', (store) => store.delete(id), REGISTRATION_STORE)
}

export async function listQueuedRegistrations() {
  const scope = requireActiveScope()
  const rows = await operateStore<Array<PosQueuedRegistration | StoredQueuedRegistration>>('readonly', (store) => store.getAll(), REGISTRATION_STORE)
  return Promise.all(filterQueuedRecordsForScope(rows, scope).map((row) => isStoredQueuedRegistration(row)
    ? decryptOfflineValue<PosQueuedRegistration>(scope, REGISTRATION_STORE, row.client_intake_id, row.encrypted_payload)
    : row))
}

async function migrateLegacyRows(scope: PosOfflineScope, claimUnscoped: boolean) {
  const scopeId = posOfflineScopeId(scope)
  const sales = await operateStore<Array<PosQueuedSale | StoredQueuedSale>>('readonly', (store) => store.getAll())
  for (const sale of sales) {
    if (!isStoredQueuedSale(sale) && (sale.offline_scope_id === scopeId || (!sale.offline_scope_id && claimUnscoped))) {
      await storeQueuedSale(scope, { ...sale, offline_scope_id: scopeId })
    }
  }
  const registrations = await operateStore<Array<PosQueuedRegistration | StoredQueuedRegistration>>('readonly', (store) => store.getAll(), REGISTRATION_STORE)
  for (const registration of registrations) {
    if (!isStoredQueuedRegistration(registration) && (registration.offline_scope_id === scopeId || (!registration.offline_scope_id && claimUnscoped))) {
      await storeQueuedRegistration(scope, { ...registration, offline_scope_id: scopeId })
    }
  }
}

export async function activatePosOfflineScope(value: unknown) {
  const scope = scopeFromBootstrap(value)
  if (!scope) throw new Error('The server did not provide a valid POS owner and terminal identity.')
  const legacyBootstrap = await operateStore<unknown>('readonly', (store) => store.get('bootstrap'), SETTINGS_STORE)
  const legacyScope = scopeFromBootstrap(legacyBootstrap)
  const sameLegacyScope = legacyScope && posOfflineScopeId(legacyScope) === posOfflineScopeId(scope)
  localStorage.setItem(ACTIVE_SCOPE_KEY, JSON.stringify(scope))
  localStorage.removeItem(SEALED_SCOPE_KEY)
  await migrateLegacyRows(scope, Boolean(sameLegacyScope))
  const bootstrapKey = `bootstrap:${posOfflineScopeId(scope)}`
  const protectedBootstrap = await encryptOfflineValue(scope, SETTINGS_STORE, bootstrapKey, value)
  await operateStore('readwrite', (store) => store.put(protectedBootstrap, bootstrapKey), SETTINGS_STORE)
  if (sameLegacyScope) await operateStore('readwrite', (store) => store.delete('bootstrap'), SETTINGS_STORE)
}

export function sealPosOfflineScope() {
  localStorage.removeItem(ACTIVE_SCOPE_KEY)
  localStorage.setItem(SEALED_SCOPE_KEY, '1')
}

export async function savePosBootstrap(value: unknown) {
  await activatePosOfflineScope(value)
}

export async function loadPosBootstrap<T>() {
  let scope = activeScope()
  if (!scope && localStorage.getItem(SEALED_SCOPE_KEY) !== '1') {
    const legacyBootstrap = await operateStore<unknown>('readonly', (store) => store.get('bootstrap'), SETTINGS_STORE)
    if (scopeFromBootstrap(legacyBootstrap)) {
      await activatePosOfflineScope(legacyBootstrap)
      scope = activeScope()
    }
  }
  if (!scope) return undefined
  const bootstrapKey = `bootstrap:${posOfflineScopeId(scope)}`
  const stored = await operateStore<T | EncryptedPayload | undefined>('readonly', (store) => store.get(bootstrapKey), SETTINGS_STORE)
  if (!stored) return undefined
  if (isEncryptedPayload(stored)) {
    return decryptOfflineValue<T>(scope, SETTINGS_STORE, bootstrapKey, stored)
  }
  await activatePosOfflineScope(stored)
  return stored
}

export type PosReceiptRange = {
  terminal_id: string
  start: number
  end: number
  next: number
}

export function permanentReceiptNumber(locationCode: string, terminalCode: string, date: Date, sequence: number): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Manila',
    year: '2-digit',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date)
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value || ''
  const stamp = `${value('year')}${value('month')}${value('day')}`
  return `HRM-${locationCode}-${terminalCode}-${stamp}-${String(sequence).padStart(6, '0')}`
}
