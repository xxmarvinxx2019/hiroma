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

export function permanentReceiptNumber(terminalId: string, transactionId: string): string {
  return `HRM-${terminalId.slice(0, 8).toUpperCase()}-${transactionId.replaceAll('-', '').toUpperCase()}`
}
