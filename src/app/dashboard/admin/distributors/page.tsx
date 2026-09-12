'use client'

import { useState, useEffect, useCallback } from 'react'
import { usePathname } from 'next/navigation'
import Pagination, { PaginationMeta } from '@/app/components/ui/Pagination'

// ============================================================
// TYPES
// ============================================================

interface AssignParentTarget {
  user_id: string
  full_name: string
  username: string
  dist_level: string
  profile_id: string
}

interface Distributor {
  id: string
  full_name: string
  username: string
  mobile: string
  address: string | null
  status: string
  created_at: string
  sales_total: number
  distributor_profile: {
    id: string
    dist_level: string
    coverage_area: string
    is_active: boolean
    contract_signed_at: string | null
    region_name: string | null
    province_name: string | null
    city_muni_name: string | null
    fulfillment_latitude: number | string | null
    fulfillment_longitude: number | string | null
    parent: {
      user: { full_name: string; username: string }
      dist_level: string
      coverage_area: string
    } | null
  } | null
}

// ============================================================
// HELPERS
// ============================================================

const levelColors: Record<string, string> = {
  regional: 'bg-[#eef0f8] text-[#0D1B3E]',
  provincial: 'bg-[#fef6e4] text-[#9a6f1e]',
  city: 'bg-[#e8f7ef] text-[#1a7a4a]',
  branch: 'bg-[#f3e8ff] text-[#7e22ce]',
}

const levelIcons: Record<string, string> = {
  regional: '🗺️',
  provincial: '🏛️',
  city: '🏙️',
}

// ============================================================
// PAGE
// ============================================================

export default function DistributorsPage() {
  const pathname = usePathname()
  const isBranchDirectory = pathname.startsWith('/dashboard/admin/branches')
  const [distributors, setDistributors] = useState<Distributor[]>([])
  const [totals, setTotals] = useState({
    regional: 0,
    provincial: 0,
    city: 0,
    branch: 0,
  })
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<
    'all' | 'regional' | 'provincial' | 'city' | 'branch'
  >(isBranchDirectory ? 'branch' : 'all')
  const [page, setPage] = useState(1)
  const [meta, setMeta] = useState<PaginationMeta>({
    total: 0,
    page: 1,
    pageSize: 15,
    totalPages: 1,
  })
  const [assignTarget, setAssignTarget] = useState<AssignParentTarget | null>(
    null,
  )
  const [assignParentId, setAssignParentId] = useState('')
  const [assignOptions, setAssignOptions] = useState<
    {
      id: string
      full_name: string
      username: string
      dist_level: string
      coverage_area: string
    }[]
  >([])
  const [assignSaving, setAssignSaving] = useState(false)
  const [editTarget, setEditTarget] = useState<Distributor | null>(null)
  const [editForm, setEditForm] = useState({
    full_name: '',
    mobile: '',
    address: '',
    email: '',
    coverage_area: '',
    fulfillment_latitude: '',
    fulfillment_longitude: '',
  })
  const [editSaving, setEditSaving] = useState(false)
  const [editError, setEditError] = useState('')
  const [editSecurityPin, setEditSecurityPin] = useState('')
  const [editPinPromptOpen, setEditPinPromptOpen] = useState(false)
  const [editPinError, setEditPinError] = useState('')
  const [togglingId, setTogglingId] = useState<string | null>(null)
  const [resettingId, setResettingId] = useState<string | null>(null)
  const [resetResult, setResetResult] = useState<{
    id: string
    password: string
  } | null>(null)
  const [resetTarget, setResetTarget] = useState<Distributor | null>(null)
  const [resetSecurityPin, setResetSecurityPin] = useState('')
  const [resetError, setResetError] = useState('')

  const generatePassword = () => {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789@#'
    return Array.from(
      { length: 10 },
      () => chars[Math.floor(Math.random() * chars.length)],
    ).join('')
  }

  const handleResetPassword = async () => {
    if (!resetTarget || resetSecurityPin.length !== 6) return
    setResettingId(resetTarget.id)
    setResetError('')
    const newPassword = generatePassword()
    const res = await fetch('/api/admin/distributors', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        distributor_id: resetTarget.id,
        action: 'reset_password',
        password: newPassword,
        security_pin: resetSecurityPin,
      }),
    })
    const data = await res.json()
    setResettingId(null)
    if (res.ok && data.success) {
      setResetResult({ id: resetTarget.id, password: newPassword })
      setResetTarget(null)
      setResetSecurityPin('')
    } else {
      setResetError(data.error || 'Unable to reset the distributor password.')
    }
  }
  const [assignError, setAssignError] = useState('')
  const [assignSuccess, setAssignSuccess] = useState('')
  const [search, setSearch] = useState('')
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState({
    full_name: '',
    username: '',
    email: '',
    mobile: '',
    password: '',
    address: '',
    dist_level: isBranchDirectory ? 'branch' : 'city',
    coverage_area: '',
    parent_dist_id: '',
    region_code: '',
    region_name: '',
    province_code: '',
    province_name: '',
    city_muni_code: '',
    city_muni_name: '',
    barangay_code: '',
    barangay_name: '',
    street_address: '',
    zip_code: '',
  })
  const [formLoading, setFormLoading] = useState(false)
  const [formError, setFormError] = useState('')
  const [formSuccess, setFormSuccess] = useState('')
  const [territoryCheck, setTerritoryCheck] = useState<{
    loading: boolean
    available: boolean | null
    holder?: { level: string; coverage_area: string; holder_name: string; holder_username: string } | null
  }>({ loading: false, available: null })

  const [parentOptions, setParentOptions] = useState<
    {
      id: string
      full_name: string
      username: string
      dist_level: string
      coverage_area: string
      region_code?: string
      province_code?: string
      is_admin?: boolean
    }[]
  >([])

  // PSGC location state
  const [regions, setRegions] = useState<{ code: string; name: string }[]>([])
  const [provinces, setProvinces] = useState<{ code: string; name: string }[]>(
    [],
  )
  const [cityMunis, setCityMunis] = useState<{ code: string; name: string }[]>(
    [],
  )
  const [barangays, setBarangays] = useState<{ code: string; name: string }[]>(
    [],
  )
  const [loadingProv, setLoadingProv] = useState(false)
  const [loadingCity, setLoadingCity] = useState(false)
  const [loadingBarangays, setLoadingBarangays] = useState(false)

  // Load regions on mount
  useEffect(() => {
    fetch('https://psgc.gitlab.io/api/regions/')
      .then((r) => r.json())
      .then((data) =>
        setRegions(
          data
            .map((r: { code: string; name: string }) => ({
              code: r.code,
              name: r.name,
            }))
            .sort((a: { name: string }, b: { name: string }) =>
              a.name.localeCompare(b.name),
            ),
        ),
      )
      .catch(() => {})
  }, [])

  // Load provinces when region changes
  useEffect(() => {
    if (!form.region_code) {
      setProvinces([])
      setCityMunis([])
      setBarangays([])
      return
    }
    setLoadingProv(true)
    fetch(`https://psgc.gitlab.io/api/regions/${form.region_code}/provinces/`)
      .then((r) => r.json())
      .then((data) => {
        if (!Array.isArray(data) || data.length === 0) {
          setProvinces([])
          setLoadingCity(true)
          return fetch(
            `https://psgc.gitlab.io/api/regions/${form.region_code}/cities-municipalities/`,
          )
            .then((r) => r.json())
            .then((cities) => {
              setCityMunis(
                cities
                  .map((c: { code: string; name: string }) => ({
                    code: c.code,
                    name: c.name,
                  }))
                  .sort((a: { name: string }, b: { name: string }) =>
                    a.name.localeCompare(b.name),
                  ),
              )
              setForm((f) => ({
                ...f,
                province_code: 'DIRECT',
                province_name: '',
              }))
            })
            .catch(() => setCityMunis([]))
            .finally(() => setLoadingCity(false))
        }
        setProvinces(
          data
            .map((p: { code: string; name: string }) => ({
              code: p.code,
              name: p.name,
            }))
            .sort((a: { name: string }, b: { name: string }) =>
              a.name.localeCompare(b.name),
            ),
        )
      })
      .catch(() => setProvinces([]))
      .finally(() => setLoadingProv(false))
    setForm((f) => ({
      ...f,
      province_code: '',
      province_name: '',
      city_muni_code: '',
      city_muni_name: '',
      barangay_code: '',
      barangay_name: '',
      zip_code: '',
    }))
    setCityMunis([])
  }, [form.region_code])

  // Load cities when province changes
  useEffect(() => {
    if (!form.province_code || form.province_code === 'DIRECT') {
      if (form.province_code !== 'DIRECT') {
        setCityMunis([])
        setBarangays([])
      }
      return
    }
    setLoadingCity(true)
    fetch(
      `https://psgc.gitlab.io/api/provinces/${form.province_code}/cities-municipalities/`,
    )
      .then((r) => r.json())
      .then((data) =>
        setCityMunis(
          data
            .map((c: { code: string; name: string }) => ({
              code: c.code,
              name: c.name,
            }))
            .sort((a: { name: string }, b: { name: string }) =>
              a.name.localeCompare(b.name),
            ),
        ),
      )
      .catch(() => setCityMunis([]))
      .finally(() => setLoadingCity(false))
    setForm((f) => ({
      ...f,
      city_muni_code: '',
      city_muni_name: '',
      barangay_code: '',
      barangay_name: '',
      zip_code: '',
    }))
  }, [form.province_code])

  // Load official barangays after selecting a city or municipality.
  useEffect(() => {
    if (!form.city_muni_code) {
      setBarangays([])
      setForm((f) => ({ ...f, barangay_code: '', barangay_name: '' }))
      return
    }
    setLoadingBarangays(true)
    setForm((f) => ({
      ...f,
      barangay_code: '',
      barangay_name: '',
      zip_code: '',
    }))
    fetch(
      `https://psgc.gitlab.io/api/cities-municipalities/${form.city_muni_code}/barangays/`,
    )
      .then((r) => r.json())
      .then((data) =>
        setBarangays(
          data
            .map((b: { code: string; name: string }) => ({
              code: b.code,
              name: b.name,
            }))
            .sort((a: { name: string }, b: { name: string }) =>
              a.name.localeCompare(b.name),
            ),
        ),
      )
      .catch(() => setBarangays([]))
      .finally(() => setLoadingBarangays(false))
  }, [form.city_muni_code])

  // Confirm availability against the server whenever the exclusive coverage changes.
  useEffect(() => {
    const code = form.dist_level === 'regional'
      ? form.region_code
      : form.dist_level === 'provincial'
        ? form.province_code
        : form.city_muni_code
    if (!code || code === 'DIRECT') {
      setTerritoryCheck({ loading: false, available: null })
      return
    }
    const controller = new AbortController()
    setTerritoryCheck({ loading: true, available: null })
    const params = new URLSearchParams({ territory_level: form.dist_level, territory_code: code })
    fetch(`/api/admin/distributors?${params}`, { signal: controller.signal })
      .then((response) => response.json().then((data) => ({ ok: response.ok, data })))
      .then(({ ok, data }) => {
        if (!ok) throw new Error(data.error || 'Unable to check territory.')
        setTerritoryCheck({ loading: false, available: Boolean(data.available), holder: data.territory })
      })
      .catch((error) => {
        if (error instanceof DOMException && error.name === 'AbortError') return
        setTerritoryCheck({ loading: false, available: null })
      })
    return () => controller.abort()
  }, [form.dist_level, form.region_code, form.province_code, form.city_muni_code])

  // Fetch parent options when level changes
  useEffect(() => {
    if (form.dist_level === 'regional') {
      setParentOptions([])
      setForm((f) => ({ ...f, parent_dist_id: '' }))
      return
    }
    const parentLevel =
      form.dist_level === 'provincial' ? 'regional' : 'provincial,regional'
    fetch(`/api/admin/distributors?parent_level=${parentLevel}`)
      .then((r) => r.json())
      .then((data) => {
        const filtered = (data.distributors || []).filter(
          (d: { distributor_profile?: { dist_level: string } }) => {
            if (form.dist_level === 'provincial')
              return d.distributor_profile?.dist_level === 'regional'
            return ['provincial', 'regional'].includes(
              d.distributor_profile?.dist_level || '',
            )
          },
        )
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const opts = filtered.map((d: any) => ({
          id: d.distributor_profile?.id || d.id, // profile ID for parent_dist_id
          full_name: d.full_name,
          username: d.username,
          dist_level: d.distributor_profile?.dist_level || '',
          coverage_area: d.distributor_profile?.coverage_area || '',
          region_code: d.distributor_profile?.region_code || '',
          province_code: d.distributor_profile?.province_code || '',
          is_admin: false,
        }))
        // Add admin as fallback option at the end
        if (data.adminUser) {
          opts.push({
            id: data.adminUser.id,
            full_name: data.adminUser.full_name,
            username: data.adminUser.username,
            dist_level: 'admin',
            coverage_area: 'All areas',
            region_code: '',
            province_code: '',
            is_admin: true,
          })
        }
        setParentOptions(opts)
      })
    setForm((f) => ({ ...f, parent_dist_id: '' }))
  }, [form.dist_level])

  // Auto-select parent whenever parentOptions loads or location codes change
  useEffect(() => {
    if (parentOptions.length === 0) return

    const adminOption = parentOptions.find((p) => p.is_admin)

    if (['city', 'branch'].includes(form.dist_level) && form.province_code) {
      const match = parentOptions.find(
        (p) =>
          p.dist_level === 'provincial' &&
          p.province_code === form.province_code,
      )
      setForm((f) => ({
        ...f,
        parent_dist_id: match?.id || adminOption?.id || '',
      }))
    } else if (form.dist_level === 'provincial' && form.region_code) {
      const match = parentOptions.find(
        (p) =>
          p.dist_level === 'regional' && p.region_code === form.region_code,
      )
      setForm((f) => ({
        ...f,
        parent_dist_id: match?.id || adminOption?.id || '',
      }))
    }
  }, [parentOptions, form.province_code, form.region_code])

  const openAssignModal = (dist: Distributor) => {
    setAssignTarget({
      user_id: dist.id,
      full_name: dist.full_name,
      username: dist.username,
      dist_level: dist.distributor_profile?.dist_level || '',
      profile_id: dist.distributor_profile?.id || '',
    })
    setAssignParentId('')
    setAssignError('')
    setAssignSuccess('')
    // Load eligible parents
    const level = dist.distributor_profile?.dist_level
    const parentLevel =
      level === 'provincial'
        ? 'regional'
        : ['city', 'branch'].includes(level || '')
          ? 'provincial,regional'
          : ''
    if (!parentLevel) return
    fetch(`/api/admin/distributors?parent_level=${parentLevel}`)
      .then((r) => r.json())
      .then((data) => {
        setAssignOptions(
          (data.distributors || [])
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            .filter((d: any) => d.id !== dist.id)
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            .map((d: any) => ({
              id: d.distributor_profile?.id || '', // profile id for parent_dist_id
              full_name: d.full_name,
              username: d.username,
              dist_level: d.distributor_profile?.dist_level || '',
              coverage_area: d.distributor_profile?.coverage_area || '',
            })),
        )
      })
  }

  const handleAssignParent = async () => {
    if (!assignTarget) return
    setAssignSaving(true)
    setAssignError('')
    setAssignSuccess('')
    const res = await fetch('/api/admin/distributors', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        distributor_id: assignTarget.user_id,
        parent_dist_id: assignParentId || null,
      }),
    })
    const data = await res.json()
    setAssignSaving(false)
    if (res.ok) {
      setAssignSuccess(data.message || 'Parent assigned successfully.')
      fetchDistributors()
    } else {
      setAssignError(data.error || 'Something went wrong.')
    }
  }

  const handleToggleStatus = async (dist: Distributor) => {
    setTogglingId(dist.id)
    await fetch('/api/admin/distributors', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        distributor_id: dist.id,
        action: 'toggle_status',
      }),
    })
    setTogglingId(null)
    fetchDistributors()
  }

  const openEdit = (dist: Distributor) => {
    setEditTarget(dist)
    setEditForm({
      full_name: dist.full_name,
      mobile: dist.mobile || '',
      address: dist.address || '',
      email: '',
      coverage_area: dist.distributor_profile?.coverage_area || '',
      fulfillment_latitude: dist.distributor_profile?.fulfillment_latitude == null ? '' : String(dist.distributor_profile.fulfillment_latitude),
      fulfillment_longitude: dist.distributor_profile?.fulfillment_longitude == null ? '' : String(dist.distributor_profile.fulfillment_longitude),
    })
    setEditError('')
    setEditSecurityPin('')
    setEditPinPromptOpen(false)
    setEditPinError('')
  }

  const closeEdit = () => {
    setEditTarget(null)
    setEditSecurityPin('')
    setEditPinPromptOpen(false)
    setEditPinError('')
    setEditError('')
  }

  const captureEditGps = () => {
    setEditError('')
    if (!navigator.geolocation) { setEditError('GPS is not supported on this device or browser.'); return }
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => setEditForm((current) => ({ ...current, fulfillment_latitude: coords.latitude.toFixed(7), fulfillment_longitude: coords.longitude.toFixed(7) })),
      () => setEditError('Location permission was denied or the GPS location is unavailable.'),
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 },
    )
  }

  const changesSensitiveContact =
    Boolean(editTarget) &&
    (editForm.mobile.trim() !== (editTarget.mobile || '').trim() ||
      Boolean(editForm.email.trim()))

  const handleEditSave = async () => {
    if (!editTarget) return
    if (changesSensitiveContact && editSecurityPin.length !== 6) {
      setEditPinPromptOpen(true)
      setEditPinError('')
      return
    }
    setEditSaving(true)
    setEditError('')
    setEditPinError('')
    const res = await fetch('/api/admin/distributors', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        distributor_id: editTarget.id,
        action: 'edit',
        ...editForm,
        security_pin: editSecurityPin,
      }),
    })
    const data = await res.json()
    setEditSaving(false)
    if (data.error) {
      if (changesSensitiveContact) {
        setEditPinPromptOpen(true)
        setEditPinError(data.error)
        setEditSecurityPin('')
      } else setEditError(data.error)
      return
    }
    closeEdit()
    fetchDistributors()
  }

  useEffect(() => {
    setPage(1)
  }, [filter, search])

  const fetchDistributors = useCallback(() => {
    setLoading(true)
    const params = new URLSearchParams({
      page: String(page),
      pageSize: '15',
      ...(!isBranchDirectory && { exclude_branches: 'true' }),
      ...(isBranchDirectory
        ? { level: 'branch' }
        : filter !== 'all' && { level: filter }),
      ...(search && { search }),
    })
    fetch(`/api/admin/distributors?${params}`)
      .then((r) => r.json())
      .then((data) => {
        setDistributors(data.distributors || [])
        if (data.totals) setTotals(data.totals)
        if (data.meta) setMeta(data.meta)
        setLoading(false)
      })
  }, [filter, search, page, isBranchDirectory])

  useEffect(() => {
    fetchDistributors()
  }, [fetchDistributors])

  const filtered = distributors

  const handleFormSubmit = async () => {
    if (territoryCheck.loading || territoryCheck.available !== true) {
      setFormError(territoryCheck.available === false
        ? 'The selected territory is already taken. Choose another location or deactivate/reconcile the existing assignment first.'
        : 'Wait for the territory availability check before registering.')
      return
    }
    if (
      !form.full_name ||
      !form.username ||
      !form.email.trim() ||
      !form.mobile ||
      !form.password ||
      !form.region_code ||
      !form.province_code ||
      !form.city_muni_code ||
      !form.barangay_code ||
      !form.street_address.trim() ||
      !/^\d{4}$/.test(form.zip_code)
    ) {
      setFormError('Please fill in all required fields.')
      return
    }
    const address = [
      form.street_address.trim(),
      form.barangay_name,
      form.city_muni_name,
      form.province_name,
      form.region_name,
      form.zip_code,
    ]
      .filter(Boolean)
      .join(', ')
    setFormLoading(true)
    setFormError('')
    setFormSuccess('')

    const res = await fetch('/api/admin/distributors', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...form,
        address,
        // Don't send admin user ID as parent — admin has no distributor profile
        parent_dist_id: (() => {
          if (isBranchDirectory) return null
          const sel = parentOptions.find((p) => p.id === form.parent_dist_id)
          if (!sel || sel.is_admin) return null
          return form.parent_dist_id || null
        })(),
      }),
    })
    const data = await res.json()

    if (!res.ok) {
      setFormError(
        data.error ||
          `Failed to create ${isBranchDirectory ? 'branch' : 'distributor'}.`,
      )
    } else {
      setFormSuccess(
        `${isBranchDirectory ? 'Branch' : 'Distributor'} registered successfully!`,
      )
      setForm({
        full_name: '',
        username: '',
        email: '',
        mobile: '',
        password: '',
        address: '',
        dist_level: isBranchDirectory ? 'branch' : 'city',
        coverage_area: '',
        parent_dist_id: '',
        region_code: '',
        region_name: '',
        province_code: '',
        province_name: '',
        city_muni_code: '',
        city_muni_name: '',
        barangay_code: '',
        barangay_name: '',
        street_address: '',
        zip_code: '',
      })
      fetchDistributors()
      setTimeout(() => {
        setShowForm(false)
        setFormSuccess('')
      }, 1500)
    }
    setFormLoading(false)
  }

  return (
    <div className="max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-semibold text-[#0D1B3E]">
            {isBranchDirectory ? 'Hiroma Branches' : 'Distributors'}
          </h1>
          <p className="text-sm text-gray-400 mt-0.5">
            {isBranchDirectory
              ? 'Manage company-owned branches, locations, and branch access'
              : 'Manage regional, provincial, and city distributors'}
          </p>
        </div>
        <button
          onClick={() => {
            setShowForm(true)
            setFormError('')
            setFormSuccess('')
          }}
          className="bg-[#C9A84C] text-[#0D1B3E] text-xs font-semibold rounded-lg px-4 py-2 hover:bg-[#E8C96A] transition-colors"
        >
          + Register {isBranchDirectory ? 'branch' : 'distributor'}
        </button>
      </div>

      {/* Summary Cards */}
      <div
        className={`grid grid-cols-1 ${isBranchDirectory ? 'sm:grid-cols-2' : 'sm:grid-cols-3'} gap-4 mb-6`}
      >
        {(isBranchDirectory
          ? (['branch'] as const)
          : (['regional', 'provincial', 'city'] as const)
        ).map((level) => {
          const count = totals[level]
          return (
            <div
              key={level}
              className="bg-white rounded-xl border border-[#0D1B3E]/8 p-4 cursor-pointer hover:border-[#C9A84C]/40 transition-colors"
              onClick={() => setFilter(filter === level ? 'all' : level)}
              style={{
                borderTop: filter === level ? '2px solid #C9A84C' : undefined,
              }}
            >
              <div className="flex items-center gap-2 mb-2">
                <span>{level === 'branch' ? 'B' : levelIcons[level]}</span>
                <span className="text-xs text-gray-400 capitalize">
                  {level === 'branch' ? 'Hiroma Branch' : level}
                </span>
              </div>
              <p className="text-2xl font-semibold text-[#0D1B3E]">{count}</p>
              <p className="text-xs text-gray-400 mt-0.5">
                {level === 'branch' ? 'branches' : 'distributors'}
              </p>
            </div>
          )
        })}
      </div>

      {/* Search & Filter */}
      <div className="bg-white rounded-xl border border-[#0D1B3E]/8 overflow-hidden">
        <div className="flex items-center gap-3 px-4 py-3 border-b border-[#0D1B3E]/8">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name, username, email, mobile, area..."
            className="flex-1 bg-[#F0F2F8] border border-[#0D1B3E]/15 rounded-lg px-3 py-2 text-sm text-[#0D1B3E] outline-none focus:border-[#C9A84C] transition-colors placeholder:text-gray-400"
          />
          <div className="flex gap-1">
            {(isBranchDirectory
              ? (['branch'] as const)
              : (['all', 'regional', 'provincial', 'city'] as const)
            ).map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`text-xs px-3 py-1.5 rounded-lg capitalize transition-colors ${
                  filter === f
                    ? 'bg-[#010521] text-white'
                    : 'bg-[#F0F2F8] text-gray-400 hover:text-[#0D1B3E]'
                }`}
              >
                {isBranchDirectory ? 'All branches' : f}
              </button>
            ))}
          </div>
        </div>

        {/* Table Header */}
        <div className="grid grid-cols-7 px-4 py-2 bg-[#F0F2F8]">
          {[
            isBranchDirectory ? 'Branch' : 'Distributor',
            'Level',
            'Coverage area',
            'Total Sales',
            'Status',
            'Registered',
            'Actions',
          ].map((h) => (
            <p
              key={h}
              className="text-xs text-gray-400 uppercase tracking-wide font-medium"
            >
              {h}
            </p>
          ))}
        </div>

        {/* Rows */}
        {loading ? (
          <div className="px-4 py-12 text-center">
            <div className="w-6 h-6 border-2 border-[#C9A84C] border-t-transparent rounded-full animate-spin mx-auto mb-2" />
            <p className="text-gray-400 text-sm">Loading...</p>
          </div>
        ) : filtered.length === 0 ? (
          <div className="px-4 py-12 text-center text-gray-400 text-sm">
            No {isBranchDirectory ? 'branches' : 'distributors'} found
          </div>
        ) : (
          filtered.map((dist) => (
            <div
              key={dist.id}
              className="grid grid-cols-7 px-4 py-3 border-b border-[#0D1B3E]/5 hover:bg-[#F0F2F8]/50 transition-colors items-center"
            >
              <div>
                <p className="text-xs font-medium text-[#0D1B3E]">
                  {dist.full_name}
                </p>
                <p className="text-xs text-gray-400">@{dist.username}</p>
                <p className="text-xs text-gray-400">{dist.mobile}</p>
              </div>
              <span>
                <span
                  className={`text-xs px-2 py-0.5 rounded-full capitalize ${levelColors[dist.distributor_profile?.dist_level || 'city']}`}
                >
                  {dist.distributor_profile?.dist_level === 'branch'
                    ? 'B'
                    : levelIcons[
                        dist.distributor_profile?.dist_level || 'city'
                      ]}{' '}
                  {dist.distributor_profile?.dist_level === 'branch'
                    ? 'Hiroma Branch'
                    : dist.distributor_profile?.dist_level}
                </span>
              </span>
              <p className="text-xs text-gray-500">
                {dist.distributor_profile?.coverage_area || '—'}
              </p>
              <div>
                <p className="text-xs font-semibold text-[#1a7a4a]">
                  ₱
                  {Number(dist.sales_total || 0).toLocaleString('en-PH', {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  })}
                </p>
                <p className="text-[10px] text-gray-400">total sales</p>
              </div>
              <span>
                <span
                  className={`text-xs px-2 py-0.5 rounded-full ${
                    dist.status === 'active'
                      ? 'bg-[#e8f7ef] text-[#1a7a4a]'
                      : 'bg-[#fdecea] text-[#a03030]'
                  }`}
                >
                  {dist.status}
                </span>
              </span>
              <p className="text-xs text-gray-400">
                {new Date(dist.created_at).toLocaleDateString('en-PH')}
              </p>
              <div className="flex items-center gap-1.5">
                {!isBranchDirectory &&
                  dist.distributor_profile?.dist_level !== 'regional' && (
                    <button
                      onClick={() => openAssignModal(dist)}
                      className="w-7 h-7 rounded-lg bg-[#fef6e4] hover:bg-[#C9A84C] flex items-center justify-center transition-colors group"
                      title={
                        dist.distributor_profile?.parent
                          ? 'Change Parent'
                          : 'Assign Parent'
                      }
                    >
                      <svg
                        width="12"
                        height="12"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        className="text-[#C9A84C] group-hover:text-white"
                      >
                        <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                        <circle cx="9" cy="7" r="4" />
                        <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
                        <path d="M16 3.13a4 4 0 0 1 0 7.75" />
                      </svg>
                    </button>
                  )}
                {/* Edit */}
                <button
                  onClick={() => openEdit(dist)}
                  className="w-7 h-7 rounded-lg bg-[#eef0f8] hover:bg-[#010521] flex items-center justify-center transition-colors group"
                  title={`Edit ${isBranchDirectory ? 'branch' : 'distributor'}`}
                >
                  <svg
                    width="12"
                    height="12"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className="text-[#0D1B3E] group-hover:text-white"
                  >
                    <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                    <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                  </svg>
                </button>
                {/* Deactivate/Activate */}
                <button
                  disabled={togglingId === dist.id}
                  onClick={() => handleToggleStatus(dist)}
                  className={
                    'w-7 h-7 rounded-lg flex items-center justify-center transition-colors group disabled:opacity-50 ' +
                    (dist.status === 'active'
                      ? 'bg-[#fdecea] hover:bg-[#a03030]'
                      : 'bg-[#e8f7ef] hover:bg-[#1a7a4a]')
                  }
                  title={dist.status === 'active' ? 'Deactivate' : 'Activate'}
                >
                  {dist.status === 'active' ? (
                    <svg
                      width="12"
                      height="12"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      className="text-[#a03030] group-hover:text-white"
                    >
                      <circle cx="12" cy="12" r="10" />
                      <path d="M8 12h8" />
                    </svg>
                  ) : (
                    <svg
                      width="12"
                      height="12"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      className="text-[#1a7a4a] group-hover:text-white"
                    >
                      <circle cx="12" cy="12" r="10" />
                      <path d="M12 8v8M8 12h8" />
                    </svg>
                  )}
                </button>
                {/* Reset Password */}
                <button
                  disabled={resettingId === dist.id}
                  onClick={() => {
                    setResetTarget(dist)
                    setResetSecurityPin('')
                    setResetError('')
                  }}
                  className={`${
                    isBranchDirectory ? 'h-7 px-2.5 gap-1.5' : 'w-7 h-7'
                  } rounded-lg bg-[#eef0f8] hover:bg-[#010521] flex items-center justify-center transition-colors group disabled:opacity-50`}
                  title="Reset password"
                  aria-label={`Reset password for ${dist.full_name}`}
                >
                  <svg
                    width="12"
                    height="12"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className="text-[#0D1B3E] group-hover:text-white"
                  >
                    <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                    <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                  </svg>
                  {isBranchDirectory && (
                    <span className="whitespace-nowrap text-[10px] font-semibold text-[#0D1B3E] group-hover:text-white">
                      Reset Password
                    </span>
                  )}
                </button>
              </div>
            </div>
          ))
        )}
        <Pagination meta={meta} onPageChange={setPage} />
      </div>

      {/* Register Form Modal */}
      {showForm && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center px-4">
          <div className="bg-white rounded-2xl w-full max-w-lg max-h-[92vh] shadow-2xl overflow-hidden flex flex-col">
            <div className="bg-[#010521] px-6 py-4 flex items-center justify-between">
              <h2 className="text-white font-semibold text-sm">
                Register new{' '}
                {isBranchDirectory ? 'Hiroma branch' : 'distributor'}
              </h2>
              <button
                onClick={() => setShowForm(false)}
                className="text-white/50 hover:text-white text-lg cursor-pointer"
              >
                ✕
              </button>
            </div>

            <div className="p-6 flex flex-col gap-4 overflow-y-auto">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-gray-400 mb-1">
                    {isBranchDirectory ? 'Branch name' : 'Full name'}{' '}
                    <span className="text-[#C9A84C]">*</span>
                  </label>
                  <input
                    value={form.full_name}
                    onChange={(e) =>
                      setForm({ ...form, full_name: e.target.value })
                    }
                    placeholder={
                      isBranchDirectory
                        ? 'Hiroma Sogod Branch'
                        : 'Juan dela Cruz'
                    }
                    className="w-full bg-[#F0F2F8] border border-[#0D1B3E]/15 rounded-lg px-3 py-2 text-sm outline-none focus:border-[#C9A84C]"
                  />
                </div>
                <div>
                  <label className="block text-xs text-gray-400 mb-1">
                    Username <span className="text-[#C9A84C]">*</span>
                  </label>
                  <input
                    value={form.username}
                    onChange={(e) =>
                      setForm({ ...form, username: e.target.value })
                    }
                    placeholder={isBranchDirectory ? 'branch.sogod' : 'juandc'}
                    className="w-full bg-[#F0F2F8] border border-[#0D1B3E]/15 rounded-lg px-3 py-2 text-sm outline-none focus:border-[#C9A84C]"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-gray-400 mb-1">
                    Email address <span className="text-[#C9A84C]">*</span>
                  </label>
                  <input
                    type="email"
                    value={form.email}
                    onChange={(e) =>
                      setForm({ ...form, email: e.target.value })
                    }
                    placeholder={
                      isBranchDirectory
                        ? 'sogod.branch@hiroma.com'
                        : 'distributor@email.com'
                    }
                    className="w-full bg-[#F0F2F8] border border-[#0D1B3E]/15 rounded-lg px-3 py-2 text-sm outline-none focus:border-[#C9A84C]"
                  />
                </div>

                <div>
                  <label className="block text-xs text-gray-400 mb-1">
                    Mobile <span className="text-[#C9A84C]">*</span>
                  </label>
                  <input
                    value={form.mobile}
                    onChange={(e) =>
                      setForm({ ...form, mobile: e.target.value })
                    }
                    placeholder="+63 9XX XXX XXXX"
                    className="w-full bg-[#F0F2F8] border border-[#0D1B3E]/15 rounded-lg px-3 py-2 text-sm outline-none focus:border-[#C9A84C]"
                  />
                </div>
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="text-xs text-gray-400">
                      Password <span className="text-[#C9A84C]">*</span>
                    </label>
                    <button
                      type="button"
                      onClick={() =>
                        setForm({ ...form, password: generatePassword() })
                      }
                      className="text-[10px] text-[#C9A84C] hover:underline"
                    >
                      ⚡ Auto-generate
                    </button>
                  </div>
                  <input
                    type="text"
                    value={form.password}
                    onChange={(e) =>
                      setForm({ ...form, password: e.target.value })
                    }
                    placeholder="Set initial password"
                    className="w-full bg-[#F0F2F8] border border-[#0D1B3E]/15 rounded-lg px-3 py-2 text-sm outline-none focus:border-[#C9A84C] font-mono"
                  />
                </div>
                {isBranchDirectory ? (
                  <div>
                    <label className="block text-xs text-gray-400 mb-1">
                      Account type
                    </label>
                    <div className="w-full bg-[#F0F2F8] border border-[#0D1B3E]/15 rounded-lg px-3 py-2 text-sm text-[#0D1B3E]">
                      Company-owned Hiroma Branch
                    </div>
                  </div>
                ) : (
                  <div>
                    <label className="block text-xs text-gray-400 mb-1">
                      Distributor level{' '}
                      <span className="text-[#C9A84C]">*</span>
                    </label>
                    <select
                      value={form.dist_level}
                      onChange={(e) =>
                        setForm({ ...form, dist_level: e.target.value })
                      }
                      className="w-full bg-[#F0F2F8] border border-[#0D1B3E]/15 rounded-lg px-3 py-2 text-sm outline-none focus:border-[#C9A84C]"
                    >
                      <option value="regional">Regional</option>
                      <option value="provincial">Provincial</option>
                      <option value="city">City</option>
                    </select>
                  </div>
                )}
              </div>

              <div className="grid grid-cols-2 gap-3">
                {/* Region */}
                <div>
                  <label className="block text-xs text-gray-400 mb-1">
                    Region <span className="text-[#C9A84C]">*</span>
                  </label>
                  <select
                    value={form.region_code}
                    onChange={(e) => {
                      const selected = regions.find(
                        (r) => r.code === e.target.value,
                      )
                      const regionCode = e.target.value
                      setForm((f) => ({
                        ...f,
                        region_code: regionCode,
                        region_name: selected?.name || '',
                      }))
                    }}
                    className="w-full bg-[#F0F2F8] border border-[#0D1B3E]/15 rounded-lg px-3 py-2 text-sm text-[#0D1B3E] outline-none focus:border-[#C9A84C]"
                  >
                    <option value="">Select region...</option>
                    {regions.map((r) => (
                      <option key={r.code} value={r.code}>
                        {r.name}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Full physical address is required for every distributor level. */}
                {form.province_code !== 'DIRECT' && (
                  <div>
                    <label className="block text-xs text-gray-400 mb-1">
                      Province <span className="text-[#C9A84C]">*</span>
                    </label>
                    <select
                      value={form.province_code}
                      onChange={(e) => {
                        const selected = provinces.find(
                          (p) => p.code === e.target.value,
                        )
                        setForm((f) => ({
                          ...f,
                          province_code: e.target.value,
                          province_name: selected?.name || '',
                        }))
                      }}
                      disabled={!form.region_code || loadingProv}
                      className="w-full bg-[#F0F2F8] border border-[#0D1B3E]/15 rounded-lg px-3 py-2 text-sm text-[#0D1B3E] outline-none focus:border-[#C9A84C] disabled:opacity-50"
                    >
                      <option value="">
                        {loadingProv ? 'Loading...' : 'Select province...'}
                      </option>
                      {provinces.map((p) => (
                        <option key={p.code} value={p.code}>
                          {p.name}
                        </option>
                      ))}
                    </select>
                  </div>
                )}

                <div>
                  <label className="block text-xs text-gray-400 mb-1">
                    City / Municipality{' '}
                    <span className="text-[#C9A84C]">*</span>
                  </label>
                  <select
                    value={form.city_muni_code}
                    onChange={(e) => {
                      const selected = cityMunis.find(
                        (c) => c.code === e.target.value,
                      )
                      setForm((f) => ({
                        ...f,
                        city_muni_code: e.target.value,
                        city_muni_name: selected?.name || '',
                      }))
                    }}
                    disabled={!form.province_code || loadingCity}
                    className="w-full bg-[#F0F2F8] border border-[#0D1B3E]/15 rounded-lg px-3 py-2 text-sm text-[#0D1B3E] outline-none focus:border-[#C9A84C] disabled:opacity-50"
                  >
                    <option value="">
                      {loadingCity
                        ? 'Loading...'
                        : 'Select city/municipality...'}
                    </option>
                    {cityMunis.map((c) => (
                      <option key={c.code} value={c.code}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs text-gray-400 mb-1">
                    Barangay <span className="text-[#C9A84C]">*</span>
                  </label>
                  <select
                    value={form.barangay_code}
                    onChange={(e) => {
                      const selected = barangays.find(
                        (b) => b.code === e.target.value,
                      )
                      setForm((f) => ({
                        ...f,
                        barangay_code: e.target.value,
                        barangay_name: selected?.name || '',
                      }))
                    }}
                    disabled={!form.city_muni_code || loadingBarangays}
                    className="w-full bg-[#F0F2F8] border border-[#0D1B3E]/15 rounded-lg px-3 py-2 text-sm text-[#0D1B3E] outline-none focus:border-[#C9A84C] disabled:opacity-50"
                  >
                    <option value="">
                      {loadingBarangays ? 'Loading...' : 'Select barangay...'}
                    </option>
                    {barangays.map((b) => (
                      <option key={b.code} value={b.code}>
                        {b.name}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Coverage area preview */}
                {form.region_name && (
                  <div className="bg-[#e8f7ef] rounded-lg px-3 py-2">
                    <p className="text-xs text-gray-400 mb-0.5">
                      Coverage area (auto-generated)
                    </p>
                    <p className="text-xs font-medium text-[#1a7a4a]">
                      {(form.dist_level === 'regional'
                        ? [form.region_name]
                        : form.dist_level === 'provincial'
                          ? [form.province_name, form.region_name]
                          : [
                              form.city_muni_name,
                              form.province_name,
                              form.region_name,
                            ]
                      )
                        .filter(Boolean)
                        .join(', ')}
                    </p>
                  </div>
                )}
                {(territoryCheck.loading || territoryCheck.available !== null) && (
                  <div className={`rounded-lg border px-3 py-2 ${
                    territoryCheck.loading
                      ? 'border-slate-200 bg-slate-50'
                      : territoryCheck.available
                        ? 'border-emerald-200 bg-emerald-50'
                        : 'border-red-200 bg-red-50'
                  }`}>
                    <p className={`text-xs font-semibold ${
                      territoryCheck.loading
                        ? 'text-slate-500'
                        : territoryCheck.available
                          ? 'text-emerald-700'
                          : 'text-red-700'
                    }`}>
                      {territoryCheck.loading
                        ? 'Checking territory availability...'
                        : territoryCheck.available
                          ? '✓ Territory available'
                          : 'Territory already taken'}
                    </p>
                    {!territoryCheck.available && territoryCheck.holder && (
                      <p className="mt-1 text-[11px] text-red-600">
                        Assigned to {territoryCheck.holder.holder_name} (@{territoryCheck.holder.holder_username}) as {territoryCheck.holder.level}. Contact Admin before changing this assignment.
                      </p>
                    )}
                  </div>
                )}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-[1fr_120px] gap-3">
                <div>
                  <label className="block text-xs text-gray-400 mb-1">
                    House No. / Street / Purok / Subdivision{' '}
                    <span className="text-[#C9A84C]">*</span>
                  </label>
                  <input
                    value={form.street_address}
                    onChange={(e) =>
                      setForm({ ...form, street_address: e.target.value })
                    }
                    placeholder="e.g. Blk 2 Lot 5, Rizal St."
                    className="w-full bg-[#F0F2F8] border border-[#0D1B3E]/15 rounded-lg px-3 py-2 text-sm outline-none focus:border-[#C9A84C]"
                  />
                </div>
                <div>
                  <label className="block text-xs text-gray-400 mb-1">
                    ZIP Code <span className="text-[#C9A84C]">*</span>
                  </label>
                  <input
                    value={form.zip_code}
                    inputMode="numeric"
                    maxLength={4}
                    onChange={(e) =>
                      setForm({
                        ...form,
                        zip_code: e.target.value.replace(/\D/g, '').slice(0, 4),
                      })
                    }
                    placeholder="e.g. 6529"
                    className="w-full bg-[#F0F2F8] border border-[#0D1B3E]/15 rounded-lg px-3 py-2 text-sm outline-none focus:border-[#C9A84C]"
                  />
                </div>
              </div>

              {/* Parent Distributor is intentionally the final input. */}
              {!isBranchDirectory && parentOptions.length > 0 && (
                <div>
                  <label className="block text-xs text-gray-400 mb-1">
                    Parent Distributor
                    {form.parent_dist_id ? (
                      <span className="text-[#1a7a4a] ml-1">
                        ✓ Auto-matched by location
                      </span>
                    ) : (
                      <span className="text-gray-300 ml-1">
                        (will fallback to admin if no match)
                      </span>
                    )}
                  </label>
                  <select
                    value={form.parent_dist_id}
                    onChange={(e) =>
                      setForm({ ...form, parent_dist_id: e.target.value })
                    }
                    className="w-full bg-[#F0F2F8] border border-[#0D1B3E]/15 rounded-lg px-3 py-2 text-sm text-[#0D1B3E] outline-none focus:border-[#C9A84C]"
                  >
                    <option value="">No parent (assign later)</option>
                    {parentOptions
                      .filter((p) => !p.is_admin)
                      .map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.full_name} (@{p.username}) · {p.coverage_area} [
                          {p.dist_level}]
                        </option>
                      ))}
                    {parentOptions
                      .filter((p) => p.is_admin)
                      .map((p) => (
                        <option key={p.id} value={p.id}>
                          ⬆ {p.full_name} (Admin — all areas)
                        </option>
                      ))}
                  </select>
                </div>
              )}

              {formError && (
                <div className="bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                  <p className="text-red-500 text-xs">{formError}</p>
                </div>
              )}
              {formSuccess && (
                <div className="bg-[#e8f7ef] border border-[#1a7a4a]/30 rounded-lg px-3 py-2">
                  <p className="text-[#1a7a4a] text-xs">{formSuccess}</p>
                </div>
              )}

              <div className="flex gap-2 pt-2">
                <button
                  onClick={() => setShowForm(false)}
                  className="flex-1 bg-[#F0F2F8] text-[#0D1B3E] text-sm rounded-lg py-2.5 hover:bg-[#e4e7f0] transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleFormSubmit}
                  disabled={formLoading || territoryCheck.loading || territoryCheck.available !== true}
                  className="flex-1 bg-[#C9A84C] text-[#0D1B3E] font-semibold text-sm rounded-lg py-2.5 hover:bg-[#E8C96A] transition-colors disabled:opacity-60"
                >
                  {formLoading
                    ? 'Registering...'
                    : `Register ${isBranchDirectory ? 'branch' : 'distributor'}`}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Assign Parent Modal */}
      {assignTarget && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl w-full max-w-md">
            <div className="px-5 py-4 border-b border-[#0D1B3E]/8 flex items-center justify-between">
              <div>
                <h2 className="text-sm font-semibold text-[#0D1B3E]">
                  Assign Parent Distributor
                </h2>
                <p className="text-xs text-gray-400 mt-0.5">
                  {assignTarget.full_name} (@{assignTarget.username}) ·{' '}
                  {assignTarget.dist_level}
                </p>
              </div>
              <button
                onClick={() => setAssignTarget(null)}
                className="text-gray-400 hover:text-[#0D1B3E] text-lg leading-none"
              >
                ✕
              </button>
            </div>
            <div className="p-5 space-y-4">
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">
                  Select{' '}
                  {assignTarget.dist_level === 'provincial'
                    ? 'Regional'
                    : 'Provincial or Regional'}{' '}
                  Parent
                </label>
                <select
                  value={assignParentId}
                  onChange={(e) => setAssignParentId(e.target.value)}
                  className="w-full bg-[#F0F2F8] border border-[#0D1B3E]/15 rounded-lg px-3 py-2 text-sm text-[#0D1B3E] outline-none focus:border-[#C9A84C]"
                >
                  <option value="">
                    — Remove parent (use location matching) —
                  </option>
                  {assignOptions.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.full_name} (@{o.username}) · {o.coverage_area} [
                      {o.dist_level}]
                    </option>
                  ))}
                </select>
                {assignOptions.length === 0 && (
                  <p className="text-xs text-gray-400 mt-1">
                    No eligible parent distributors found.
                  </p>
                )}
              </div>

              <div className="bg-[#F0F2F8] rounded-lg px-3 py-2">
                <p className="text-xs text-gray-400 leading-relaxed">
                  Selecting{' '}
                  <span className="font-medium text-[#0D1B3E]">
                    — Remove parent —
                  </span>{' '}
                  will clear the explicit assignment. The system will
                  automatically route orders based on location matching.
                </p>
              </div>

              {assignSuccess && (
                <p className="text-xs text-[#1a7a4a] bg-[#e8f7ef] px-3 py-2 rounded-lg">
                  {assignSuccess}
                </p>
              )}
              {assignError && (
                <p className="text-xs text-[#a03030] bg-[#fdecea] px-3 py-2 rounded-lg">
                  {assignError}
                </p>
              )}

              <div className="flex gap-2 pt-1">
                <button
                  onClick={() => setAssignTarget(null)}
                  className="flex-1 bg-[#F0F2F8] text-gray-500 text-sm py-2 rounded-lg hover:bg-[#e4e6ef] transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleAssignParent}
                  disabled={assignSaving}
                  className="flex-1 bg-[#010521] text-white text-sm py-2 rounded-lg hover:bg-[#162850] transition-colors disabled:opacity-50 font-medium"
                >
                  {assignSaving ? 'Saving...' : 'Save Assignment'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
      {/* Owner-confirmed Reset Password Modal */}
      {resetTarget && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6">
            <h2 className="text-base font-semibold text-[#0D1B3E]">
              Reset {isBranchDirectory ? 'branch' : 'distributor'} password
            </h2>
            <p className="mt-1 text-xs leading-5 text-gray-500">
              This signs out existing sessions and removes registered passkeys
              for{' '}
              <span className="font-semibold text-[#0D1B3E]">
                {resetTarget.full_name}
              </span>
              .
            </p>
            <label className="mt-4 mb-1 block text-xs text-gray-500">
              Admin Security PIN
            </label>
            <input
              type="password"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              value={resetSecurityPin}
              onChange={(event) =>
                setResetSecurityPin(
                  event.target.value.replace(/\D/g, '').slice(0, 6),
                )
              }
              placeholder="6-digit Security PIN"
              className="w-full rounded-lg border border-[#0D1B3E]/15 bg-[#F0F2F8] px-3 py-2 text-sm outline-none focus:border-[#C9A84C]"
            />
            {resetError && (
              <p className="mt-3 rounded-lg bg-[#fdecea] px-3 py-2 text-xs text-[#a03030]">
                {resetError}
              </p>
            )}
            <div className="mt-5 flex gap-2">
              <button
                type="button"
                onClick={() => setResetTarget(null)}
                disabled={Boolean(resettingId)}
                className="flex-1 rounded-lg bg-[#F0F2F8] py-2.5 text-sm text-[#0D1B3E] disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void handleResetPassword()}
                disabled={Boolean(resettingId) || resetSecurityPin.length !== 6}
                className="flex-1 rounded-lg bg-[#C9A84C] py-2.5 text-sm font-medium text-white disabled:opacity-50"
              >
                {resettingId ? 'Resetting...' : 'Confirm Reset'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Reset Password Result Modal */}
      {resetResult && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6 text-center">
            <div className="w-12 h-12 bg-[#e8f7ef] rounded-full flex items-center justify-center mx-auto mb-3">
              <svg
                width="20"
                height="20"
                viewBox="0 0 24 24"
                fill="none"
                stroke="#1a7a4a"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <h2 className="text-base font-semibold text-[#0D1B3E] mb-1">
              Password Reset!
            </h2>
            <p className="text-xs text-gray-400 mb-4">
              Share this new password with the{' '}
              {isBranchDirectory ? 'authorized branch manager' : 'distributor'}
            </p>
            <div className="bg-[#F0F2F8] rounded-xl px-4 py-3 mb-4 flex items-center justify-between gap-3">
              <span className="font-mono text-sm font-semibold text-[#0D1B3E] tracking-wider">
                {resetResult.password}
              </span>
              <button
                onClick={() =>
                  navigator.clipboard.writeText(resetResult!.password)
                }
                className="text-[10px] text-[#C9A84C] hover:underline whitespace-nowrap"
              >
                Copy
              </button>
            </div>
            <button
              onClick={() => setResetResult(null)}
              className="w-full py-2 rounded-lg bg-[#010521] text-white text-sm font-medium hover:bg-[#162850]"
            >
              Done
            </button>
          </div>
        </div>
      )}

      {/* Edit Modal */}
      {editTarget && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6">
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-base font-semibold text-[#0D1B3E]">
                Edit {isBranchDirectory ? 'Branch' : 'Distributor'}
              </h2>
              <button
                onClick={closeEdit}
                className="text-gray-400 hover:text-[#0D1B3E]"
                aria-label={`Close edit ${isBranchDirectory ? 'branch' : 'distributor'}`}
              >
                ✕
              </button>
            </div>
            <div className="space-y-3">
              {[
                { label: 'Full Name', key: 'full_name', type: 'text' },
                { label: 'Mobile', key: 'mobile', type: 'text' },
                { label: 'Address', key: 'address', type: 'text' },
                { label: 'Email', key: 'email', type: 'email' },
                { label: 'Coverage Area', key: 'coverage_area', type: 'text' },
              ].map(({ label, key, type }) => (
                <div key={key}>
                  <label className="block text-xs text-gray-500 mb-1">
                    {label}
                    {['mobile', 'email'].includes(key) && (
                      <span className="ml-1 text-[#C9A84C]">🔒 protected</span>
                    )}
                  </label>
                  <input
                    type={type}
                    value={editForm[key as keyof typeof editForm]}
                    onChange={(e) =>
                      setEditForm((f) => ({ ...f, [key]: e.target.value }))
                    }
                    className="w-full border border-[#0D1B3E]/15 rounded-lg px-3 py-2 text-sm text-[#0D1B3E] outline-none focus:border-[#C9A84C]"
                  />
                </div>
              ))}
              <div className="rounded-xl border border-[#0D1B3E]/10 bg-[#F8F9FC] p-3">
                <div className="flex items-center justify-between gap-3">
                  <div><p className="text-xs font-semibold text-[#0D1B3E]">Fulfillment GPS</p><p className="mt-0.5 text-[10px] leading-4 text-gray-500">Optional. Capture this only while physically at the partner or branch pickup location.</p></div>
                  <button type="button" onClick={captureEditGps} className="shrink-0 rounded-lg border border-[#1a7a4a]/30 bg-[#e8f7ef] px-3 py-2 text-xs font-medium text-[#1a7a4a]">⌖ Capture GPS</button>
                </div>
                <div className="mt-3 grid grid-cols-2 gap-2">
                  <label><span className="mb-1 block text-[10px] text-gray-500">Latitude</span><input type="number" step="0.0000001" min="-90" max="90" value={editForm.fulfillment_latitude} onChange={(event) => setEditForm((current) => ({ ...current, fulfillment_latitude: event.target.value }))} className="w-full rounded-lg border border-[#0D1B3E]/15 bg-white px-2 py-2 text-xs outline-none focus:border-[#C9A84C]" /></label>
                  <label><span className="mb-1 block text-[10px] text-gray-500">Longitude</span><input type="number" step="0.0000001" min="-180" max="180" value={editForm.fulfillment_longitude} onChange={(event) => setEditForm((current) => ({ ...current, fulfillment_longitude: event.target.value }))} className="w-full rounded-lg border border-[#0D1B3E]/15 bg-white px-2 py-2 text-xs outline-none focus:border-[#C9A84C]" /></label>
                </div>
              </div>
              {editError && (
                <p className="text-xs text-[#a03030]">{editError}</p>
              )}
            </div>
            <div className="flex gap-2 mt-5">
              <button
                onClick={closeEdit}
                className="flex-1 py-2 rounded-lg border border-[#0D1B3E]/15 text-sm text-gray-500 hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                onClick={handleEditSave}
                disabled={editSaving}
                className="flex-1 py-2 rounded-lg bg-[#010521] text-white text-sm font-medium hover:bg-[#162850] disabled:opacity-50"
              >
                {editSaving ? 'Saving...' : 'Save Changes'}
              </button>
            </div>
          </div>
        </div>
      )}

      {editTarget && editPinPromptOpen && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="edit-pin-title"
            className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-2xl"
          >
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-[#fef6e4] text-xl">
              🔐
            </div>
            <h2
              id="edit-pin-title"
              className="mt-3 text-center text-base font-semibold text-[#0D1B3E]"
            >
              Confirm sensitive changes
            </h2>
            <p className="mt-2 text-center text-xs leading-5 text-gray-500">
              Enter the Admin owner&apos;s 6-digit Security PIN before changing{' '}
              {[
                editForm.mobile.trim() !== (editTarget.mobile || '').trim()
                  ? 'mobile number'
                  : '',
                editForm.email.trim() ? 'email address' : '',
              ]
                .filter(Boolean)
                .join(' and ')}
              .
            </p>
            <label className="mt-4 mb-1 block text-xs text-gray-500">
              Admin Security PIN
            </label>
            <input
              autoFocus
              type="password"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              value={editSecurityPin}
              onChange={(event) => {
                setEditSecurityPin(
                  event.target.value.replace(/\D/g, '').slice(0, 6),
                )
                setEditPinError('')
              }}
              onKeyDown={(event) => {
                if (
                  event.key === 'Enter' &&
                  editSecurityPin.length === 6 &&
                  !editSaving
                )
                  void handleEditSave()
              }}
              placeholder="Enter 6-digit Security PIN"
              className="w-full rounded-lg border border-[#0D1B3E]/15 bg-[#F0F2F8] px-3 py-2.5 text-center text-sm tracking-[0.3em] outline-none focus:border-[#C9A84C]"
            />
            {editPinError && (
              <p className="mt-3 rounded-lg bg-[#fdecea] px-3 py-2 text-xs text-[#a03030]">
                {editPinError}
              </p>
            )}
            <div className="mt-5 flex gap-2">
              <button
                type="button"
                onClick={() => {
                  setEditPinPromptOpen(false)
                  setEditSecurityPin('')
                  setEditPinError('')
                }}
                disabled={editSaving}
                className="flex-1 rounded-lg border border-[#0D1B3E]/15 py-2.5 text-sm text-gray-500 disabled:opacity-50"
              >
                Back
              </button>
              <button
                type="button"
                onClick={() => void handleEditSave()}
                disabled={editSaving || editSecurityPin.length !== 6}
                className="flex-1 rounded-lg bg-[#C9A84C] py-2.5 text-sm font-medium text-white disabled:opacity-50"
              >
                {editSaving ? 'Saving…' : 'Confirm & save'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
