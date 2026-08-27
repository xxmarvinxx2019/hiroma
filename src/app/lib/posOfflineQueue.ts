'use client'

export type PosQueuedSale = {
  client_transaction_id: string
  receipt_number: string
  payload: Record<string, unknown>
  receipt: Record<string, unknown>
  status: 'saved_offline' | 'syncing' | 'needs_attention'
  error?: string
  created_at: string
}

export type PosQueuedRegistration = {
  client_intake_id: string
  receipt_number: string
  payload: Record<string, unknown>
  status: 'saved_offline' | 'syncing' | 'needs_attention'
  error?: string
  created_at: string
}

const DB_NAME = 'hiroma-pos'
const STORE = 'sales'
const REGISTRATION_STORE = 'registrations'
const SETTINGS_STORE = 'settings'

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

export const saveQueuedSale = (sale: PosQueuedSale) => operateStore('readwrite', (store) => store.put(sale))
export const deleteQueuedSale = (id: string) => operateStore('readwrite', (store) => store.delete(id))
export const listQueuedSales = () => operateStore<PosQueuedSale[]>('readonly', (store) => store.getAll())
export const saveQueuedRegistration = (row: PosQueuedRegistration) => operateStore('readwrite', (store) => store.put(row), REGISTRATION_STORE)
export const deleteQueuedRegistration = (id: string) => operateStore('readwrite', (store) => store.delete(id), REGISTRATION_STORE)
export const listQueuedRegistrations = () => operateStore<PosQueuedRegistration[]>('readonly', (store) => store.getAll(), REGISTRATION_STORE)

export const savePosBootstrap = (value: unknown) =>
  operateStore('readwrite', (store) => store.put(value, 'bootstrap'), SETTINGS_STORE)

export const loadPosBootstrap = <T>() =>
  operateStore<T | undefined>('readonly', (store) => store.get('bootstrap'), SETTINGS_STORE)

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
