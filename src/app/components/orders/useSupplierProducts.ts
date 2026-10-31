'use client'

import { useCallback, useEffect, useState } from 'react'
import { readSettingsResponse } from '@/app/lib/settingsResponse'
import type { OrderingRole } from '@/app/lib/orderingSupplier'

export type SupplierOrderProduct = { id: string; name: string; type: string; price: number; available_quantity: number | null; is_available: boolean }

export function useSupplierProducts(role: OrderingRole, supplierId: string) {
  const [data, setData] = useState<{ url: string; products: SupplierOrderProduct[] } | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [revision, setRevision] = useState(0)
  const url = `/api/${role}/products?${new URLSearchParams({ for_ordering: 'true', supplier_id: supplierId })}`
  const refresh = useCallback(() => { setLoading(true); setRevision(value => value + 1) }, [])
  useEffect(() => {
    const controller = new AbortController()
    fetch(url, { cache: 'no-store', signal: controller.signal })
      .then(response => readSettingsResponse<{ products: SupplierOrderProduct[] }>(response, 'Unable to load supplier stock.'))
      .then(payload => { if (!controller.signal.aborted) { setData({ url, products: payload.products }); setError('') } })
      .catch(error => { if (!controller.signal.aborted) setError(error instanceof Error ? error.message : 'Unable to load supplier stock.') })
      .finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [url, revision])
  useEffect(() => {
    window.addEventListener('focus', refresh)
    const timer = window.setInterval(refresh, 30000)
    return () => { window.removeEventListener('focus', refresh); window.clearInterval(timer) }
  }, [refresh])
  return { products: data?.url === url ? data.products : [], loading: loading || (!error && data?.url !== url), error, refresh }
}
