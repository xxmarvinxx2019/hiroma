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

const DB_NAME = 'hiroma-pos'
const STORE = 'sales'
const REGISTRATION_STORE = 'registrations'
const SETTINGS_STORE = 'settings'
const ACTIVE_SCOPE_KEY = 'hiroma_pos_active_scope_v1'
const SEALED_SCOPE_KEY = 'hiroma_pos_scope_sealed_v1'

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

export function filterQueuedRecordsForScope<T extends { offline_scope_id?: string }>(rows: T[], scope: PosOfflineScope) {
  return rows.filter((row) => queuedRecordBelongsToScope(row, scope))
}

export const saveQueuedSale = (sale: PosQueuedSale) => {
  const scope = requireActiveScope()
  return operateStore('readwrite', (store) => store.put({ ...sale, offline_scope_id: posOfflineScopeId(scope) }))
}

export async function deleteQueuedSale(id: string) {
  const scope = requireActiveScope()
  const row = await operateStore<PosQueuedSale | undefined>('readonly', (store) => store.get(id))
  if (!row || !queuedRecordBelongsToScope(row, scope)) return
  await operateStore('readwrite', (store) => store.delete(id))
}

export async function listQueuedSales() {
  const scope = requireActiveScope()
  const rows = await operateStore<PosQueuedSale[]>('readonly', (store) => store.getAll())
  return filterQueuedRecordsForScope(rows, scope)
}

export const saveQueuedRegistration = (row: PosQueuedRegistration) => {
  const scope = requireActiveScope()
  return operateStore('readwrite', (store) => store.put({ ...row, offline_scope_id: posOfflineScopeId(scope) }), REGISTRATION_STORE)
}

export async function deleteQueuedRegistration(id: string) {
  const scope = requireActiveScope()
  const row = await operateStore<PosQueuedRegistration | undefined>('readonly', (store) => store.get(id), REGISTRATION_STORE)
  if (!row || !queuedRecordBelongsToScope(row, scope)) return
  await operateStore('readwrite', (store) => store.delete(id), REGISTRATION_STORE)
}

export async function listQueuedRegistrations() {
  const scope = requireActiveScope()
  const rows = await operateStore<PosQueuedRegistration[]>('readonly', (store) => store.getAll(), REGISTRATION_STORE)
  return filterQueuedRecordsForScope(rows, scope)
}

async function migrateLegacyRows(scope: PosOfflineScope) {
  const scopeId = posOfflineScopeId(scope)
  const sales = await operateStore<PosQueuedSale[]>('readonly', (store) => store.getAll())
  for (const sale of sales) {
    if (!sale.offline_scope_id) await operateStore('readwrite', (store) => store.put({ ...sale, offline_scope_id: scopeId }))
  }
  const registrations = await operateStore<PosQueuedRegistration[]>('readonly', (store) => store.getAll(), REGISTRATION_STORE)
  for (const registration of registrations) {
    if (!registration.offline_scope_id) await operateStore('readwrite', (store) => store.put({ ...registration, offline_scope_id: scopeId }), REGISTRATION_STORE)
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
  if (sameLegacyScope) await migrateLegacyRows(scope)
  await operateStore('readwrite', (store) => store.put(value, `bootstrap:${posOfflineScopeId(scope)}`), SETTINGS_STORE)
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
  return operateStore<T | undefined>('readonly', (store) => store.get(`bootstrap:${posOfflineScopeId(scope)}`), SETTINGS_STORE)
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
