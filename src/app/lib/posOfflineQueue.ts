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

const DB_NAME = 'hiroma-pos'
const STORE = 'sales'

function database(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1)
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'client_transaction_id' })
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error || new Error('Unable to open the offline POS queue.'))
  })
}

async function operateStore<T>(mode: IDBTransactionMode, action: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await database()
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE, mode)
    const request = action(transaction.objectStore(STORE))
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error || new Error('Offline POS storage failed.'))
    transaction.oncomplete = () => db.close()
  })
}

export const saveQueuedSale = (sale: PosQueuedSale) => operateStore('readwrite', (store) => store.put(sale))
export const deleteQueuedSale = (id: string) => operateStore('readwrite', (store) => store.delete(id))
export const listQueuedSales = () => operateStore<PosQueuedSale[]>('readonly', (store) => store.getAll())

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
