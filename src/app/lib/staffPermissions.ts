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

