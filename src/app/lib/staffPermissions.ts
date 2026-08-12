export const STAFF_PERMISSIONS = [
  { key: 'dashboard', label: 'Dashboard', description: 'View branch or distributor dashboard and summaries.' },
  { key: 'resellers', label: 'Resellers', description: 'View the reseller list and reseller details.' },
  { key: 'register_reseller', label: 'Register Reseller', description: 'Create and activate new reseller accounts.' },
  { key: 'pins', label: 'PINs', description: 'View and use the owner account PIN inventory.' },
  { key: 'inventory', label: 'Inventory', description: 'View and manage product inventory.' },
  { key: 'orders', label: 'Orders / Sales', description: 'Create walk-in sales and manage orders.' },
  { key: 'payment_methods', label: 'Payment Methods', description: 'View and manage payment methods.' },
  { key: 'pin_requests', label: 'PIN Requests', description: 'View and submit PIN requests.' },
] as const

export type StaffPermission = (typeof STAFF_PERMISSIONS)[number]['key']
export const STAFF_PERMISSION_KEYS = new Set<string>(STAFF_PERMISSIONS.map((permission) => permission.key))

export const ADMIN_STAFF_MODULES = [
  { key: 'dashboard', label: 'Dashboard', description: 'Business summaries.', action: null, actionLabel: null },
  { key: 'distributors', label: 'Distributors', description: 'Distributor accounts.', action: 'manage', actionLabel: 'Create / Edit' },
  { key: 'resellers', label: 'Resellers', description: 'Reseller accounts.', action: 'manage', actionLabel: 'Register / Edit' },
  { key: 'products', label: 'Products', description: 'Product catalog.', action: 'manage', actionLabel: 'Create / Edit' },
  { key: 'ranks', label: 'Ranks', description: 'Rank configuration.', action: 'manage', actionLabel: 'Configure' },
  { key: 'packages', label: 'Packages', description: 'Membership packages.', action: 'manage', actionLabel: 'Create / Edit' },
  { key: 'pins', label: 'PIN Manager', description: 'PIN inventory.', action: 'manage', actionLabel: 'Issue / Manage' },
  { key: 'inventory', label: 'Inventory', description: 'Company inventory.', action: 'manage', actionLabel: 'Update Stock' },
  { key: 'orders', label: 'Orders', description: 'Orders and sales.', action: 'manage', actionLabel: 'Process / Update' },
  { key: 'payouts', label: 'Payouts', description: 'Payout requests.', action: 'process', actionLabel: 'Process / Approve' },
  { key: 'payment_methods', label: 'Payment Methods', description: 'Payment accounts.', action: 'manage', actionLabel: 'Create / Edit' },
  { key: 'pin_requests', label: 'PIN Requests', description: 'Requested PINs.', action: 'process', actionLabel: 'Process / Approve' },
  { key: 'commissions', label: 'Commissions', description: 'Commission records.', action: null, actionLabel: null },
  { key: 'reports', label: 'Reports', description: 'Business and accounting reports.', action: null, actionLabel: null },
  { key: 'audit_logs', label: 'Audit Logs', description: 'Security and activity history.', action: null, actionLabel: null },
  { key: 'support_center', label: 'Customer Support', description: 'Assigned support tickets.', action: 'reply', actionLabel: 'Reply to Tickets' },
] as const

export type AdminStaffModule = (typeof ADMIN_STAFF_MODULES)[number]['key']
export type AdminStaffPermission = `${AdminStaffModule}:view` | `${AdminStaffModule}:${'manage' | 'process' | 'reply'}`
export const ADMIN_STAFF_PERMISSION_KEYS = new Set<string>(ADMIN_STAFF_MODULES.flatMap((module) => [
  `${module.key}:view`,
  ...(module.action ? [`${module.key}:${module.action}`] : []),
]))

export const ADMIN_STAFF_TYPES = [
  { key: 'customer_support', label: 'Customer Support', permissions: ['support_center:view', 'support_center:reply'] },
  { key: 'accounting', label: 'Accounting (Read Only)', permissions: ['dashboard:view', 'orders:view', 'payouts:view', 'payment_methods:view', 'commissions:view', 'reports:view'] },
  { key: 'inventory', label: 'Inventory (Read Only)', permissions: ['dashboard:view', 'products:view', 'packages:view', 'pins:view', 'inventory:view', 'orders:view'] },
  { key: 'operations', label: 'Operations (Read Only)', permissions: ['dashboard:view', 'distributors:view', 'resellers:view', 'orders:view', 'pin_requests:view', 'reports:view'] },
  { key: 'custom', label: 'Custom Access', permissions: [] },
] as const satisfies ReadonlyArray<{ key: string; label: string; permissions: readonly AdminStaffPermission[] }>

export type AdminStaffType = (typeof ADMIN_STAFF_TYPES)[number]['key']
export const ADMIN_STAFF_TYPE_KEYS = new Set<string>(ADMIN_STAFF_TYPES.map(({ key }) => key))

export function cleanAdminStaffPermissions(value: unknown): AdminStaffPermission[] {
  if (!Array.isArray(value)) return []
  const cleaned = [...new Set(value.filter((item): item is AdminStaffPermission => typeof item === 'string' && ADMIN_STAFF_PERMISSION_KEYS.has(item)))]
  const granted = new Set<string>(cleaned)
  return cleaned.filter((permission) => {
    const [module, access] = permission.split(':')
    return access === 'view' || granted.has(`${module}:view`)
  })
}

function requiredModulePermission(module: AdminStaffModule, method: string, action: string | null): AdminStaffPermission {
  if (method === 'GET' || method === 'HEAD') return `${module}:view`
  return `${module}:${action || 'manage'}` as AdminStaffPermission
}

export function adminStaffPermissionForPath(pathname: string, method = 'GET'): AdminStaffPermission | '__owner_only__' | null {
  if (pathname.startsWith('/api/auth/')) return null
  if (pathname.startsWith('/dashboard/admin/support-staff') || pathname.startsWith('/api/admin/support-staff')) return '__owner_only__'
  if (pathname.startsWith('/dashboard/admin/settings') || pathname.startsWith('/api/admin/settings')) return '__owner_only__'
  if (pathname.startsWith('/dashboard/admin/commission-testing') || pathname.startsWith('/api/admin/commission-testing')) return '__owner_only__'
  if (pathname.startsWith('/dashboard/admin/report-testing') || pathname.startsWith('/api/admin/report-testing')) return '__owner_only__'
  if (pathname.startsWith('/dashboard/admin/flushout') || pathname.startsWith('/api/admin/flushout')) return '__owner_only__'

  const mappings: ReadonlyArray<[boolean, AdminStaffModule, string | null]> = [
    [pathname.startsWith('/dashboard/admin/support-center') || pathname.startsWith('/api/admin/support-requests') || pathname.startsWith('/api/support/tickets'), 'support_center', 'reply'],
    [pathname.startsWith('/dashboard/admin/audit-logs') || pathname.startsWith('/api/admin/audit-logs'), 'audit_logs', null],
    [pathname.startsWith('/dashboard/admin/distributors') || pathname.startsWith('/api/admin/distributors'), 'distributors', 'manage'],
    [pathname.startsWith('/dashboard/admin/resellers') || pathname.startsWith('/api/admin/resellers') || pathname.startsWith('/dashboard/admin/top-performers') || pathname.startsWith('/api/admin/top-performers'), 'resellers', 'manage'],
    [pathname.startsWith('/dashboard/admin/products') || pathname.startsWith('/api/admin/products'), 'products', 'manage'],
    [pathname.startsWith('/dashboard/admin/ranks') || pathname.startsWith('/api/admin/ranks'), 'ranks', 'manage'],
    [pathname.startsWith('/dashboard/admin/packages') || pathname.startsWith('/api/admin/packages'), 'packages', 'manage'],
    [pathname.startsWith('/dashboard/admin/pins') || pathname.startsWith('/api/admin/pins'), 'pins', 'manage'],
    [pathname.startsWith('/dashboard/admin/inventory') || pathname.startsWith('/api/admin/inventory'), 'inventory', 'manage'],
    [pathname.startsWith('/dashboard/admin/orders') || pathname.startsWith('/api/admin/orders') || pathname.startsWith('/api/orders/'), 'orders', 'manage'],
    [pathname.startsWith('/dashboard/admin/payouts') || pathname.startsWith('/api/admin/payouts'), 'payouts', 'process'],
    [pathname.startsWith('/dashboard/admin/payment-methods') || pathname.startsWith('/api/payment-methods'), 'payment_methods', 'manage'],
    [pathname.startsWith('/dashboard/admin/pin-requests') || pathname.startsWith('/api/pin-requests'), 'pin_requests', 'process'],
    [pathname.startsWith('/dashboard/admin/commissions') || pathname.startsWith('/api/admin/commissions'), 'commissions', null],
    [pathname.startsWith('/dashboard/admin/reports') || pathname.startsWith('/api/admin/reports'), 'reports', null],
    [pathname.startsWith('/api/admin/stats') || pathname === '/dashboard/admin', 'dashboard', null],
  ]
  const mapping = mappings.find(([matches]) => matches)
  if (mapping) return requiredModulePermission(mapping[1], pathname.startsWith('/dashboard/') ? 'GET' : method, mapping[2])
  if (pathname.startsWith('/dashboard/admin') || pathname.startsWith('/api/admin')) return '__owner_only__'
  return null
}

export function firstAdminStaffRoute(permissions: readonly string[]): string {
  const routes: ReadonlyArray<[AdminStaffModule, string]> = [
    ['dashboard', '/dashboard/admin'], ['support_center', '/dashboard/admin/support-center'], ['orders', '/dashboard/admin/orders'],
    ['payouts', '/dashboard/admin/payouts'], ['reports', '/dashboard/admin/reports'], ['inventory', '/dashboard/admin/inventory'],
    ['resellers', '/dashboard/admin/resellers'], ['distributors', '/dashboard/admin/distributors'], ['products', '/dashboard/admin/products'],
    ['ranks', '/dashboard/admin/ranks'], ['packages', '/dashboard/admin/packages'], ['pins', '/dashboard/admin/pins'],
    ['payment_methods', '/dashboard/admin/payment-methods'], ['pin_requests', '/dashboard/admin/pin-requests'],
    ['commissions', '/dashboard/admin/commissions'], ['audit_logs', '/dashboard/admin/audit-logs'],
  ]
  return routes.find(([module]) => permissions.includes(`${module}:view`))?.[1] || '/login/admin'
}
