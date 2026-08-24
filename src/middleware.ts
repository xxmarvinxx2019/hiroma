import { NextRequest, NextResponse } from 'next/server'
import { jwtVerify } from 'jose'
import { adminStaffPermissionForPath, firstAdminStaffRoute } from '@/app/lib/staffPermissions'

// ============================================================
// CONFIG
// ============================================================

const jwtSecret = process.env.JWT_SECRET

// Never fall back to a known signing key. A predictable fallback would let an
// attacker forge a valid session cookie in any environment missing JWT_SECRET.
if (!jwtSecret || jwtSecret.length < 32) {
  throw new Error('JWT_SECRET must be configured with at least 32 characters.')
}

const JWT_SECRET = new TextEncoder().encode(jwtSecret)

const COOKIE_NAME = 'hiroma_token'

// ── Routes each role is allowed to access ──
const ROLE_ROUTES: Record<string, string> = {
  admin:      '/dashboard/admin',
  regional:   '/dashboard/regional',
  provincial: '/dashboard/provincial',
  city:       '/dashboard/city',
  reseller:   '/dashboard/reseller',
}

// ── Public routes that don't need auth ──
const PUBLIC_ROUTES = ['/', '/login', '/login/member', '/login/distributor', '/login/admin', '/forgot-password', '/support']

function requiredStaffPermission(pathname: string, method: string): string | null {
  if (pathname.startsWith('/dashboard/area-manager') || pathname.startsWith('/api/area-manager')) return 'area_audits'
  const adminPermission = adminStaffPermissionForPath(pathname, method)
  if (adminPermission !== null) return adminPermission
  if (pathname.startsWith('/dashboard/city/support-center') || pathname.startsWith('/dashboard/admin/support-center') || pathname.startsWith('/api/admin/support-requests') || pathname.startsWith('/api/support/tickets')) return 'support_center'
  if (pathname.startsWith('/dashboard/city/staff') || pathname.startsWith('/api/city/staff')) return '__owner_only__'
  if (pathname.startsWith('/dashboard/city/profile') || pathname.startsWith('/api/city/profile')) return '__owner_only__'
  if (pathname.startsWith('/dashboard/city/resellers/register')) return 'register_reseller'
  if (pathname === '/api/city/resellers' && method !== 'GET') return 'register_reseller'
  if (pathname.startsWith('/dashboard/city/top-performers') || pathname.startsWith('/api/city/top-performers')) return 'resellers'
  if (pathname.startsWith('/dashboard/city/resellers') || pathname.startsWith('/api/city/resellers')) return 'resellers'
  if (pathname.startsWith('/dashboard/city/pins') || pathname.startsWith('/api/city/pins')) return 'pins'
  if (pathname.startsWith('/dashboard/city/inventory') || pathname.startsWith('/api/city/inventory')) return 'inventory'
  if (pathname.startsWith('/dashboard/city/orders') || pathname.startsWith('/api/city/orders') || pathname.startsWith('/api/orders/')) return 'orders'
  if (pathname.startsWith('/dashboard/city/pos') || pathname.startsWith('/api/city/pos')) return 'pos'
  if (pathname.startsWith('/dashboard/city/reports') || pathname.startsWith('/api/city/reports')) return 'orders'
  if (pathname.startsWith('/dashboard/city/payment-methods') || pathname.startsWith('/api/payment-methods')) return 'payment_methods'
  if (pathname.startsWith('/dashboard/city/pin-requests') || pathname.startsWith('/api/pin-requests')) return 'pin_requests'
  if (pathname.startsWith('/api/city/products')) return 'inventory|orders'
  if (pathname.startsWith('/api/city/packages')) return 'register_reseller|pins|pin_requests'
  if (pathname === '/dashboard/city' || pathname.startsWith('/api/city/stats')) return 'dashboard'
  return null
}

// ============================================================
// MIDDLEWARE
// ============================================================

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl

  // ── Allow public routes ──
  if (PUBLIC_ROUTES.includes(pathname) || pathname.startsWith('/verify/')) {
    return NextResponse.next()
  }

  // ── Allow API routes to handle their own auth ──
  if (pathname.startsWith('/api/') && requiredStaffPermission(pathname, req.method) === null) {
    const requestHeaders = new Headers(req.headers)
    requestHeaders.delete('x-hiroma-staff-permission')
    return NextResponse.next({ request: { headers: requestHeaders } })
  }

  // ── Allow static files ──
  if (
    pathname.startsWith('/_next/') ||
    pathname.startsWith('/favicon') ||
    pathname.includes('.')
  ) {
    return NextResponse.next()
  }

  // ── Check for auth cookie ──
  const token = req.cookies.get(COOKIE_NAME)?.value

  if (!token) {
    return NextResponse.redirect(new URL('/login', req.url))
  }

  // ── Verify JWT token ──
  try {
    const { payload } = await jwtVerify(token, JWT_SECRET)
    const role = payload.role as string

    if (!role) {
      return NextResponse.redirect(new URL('/login', req.url))
    }

    // Keep operational reseller registrations out of the Admin channel. The
    // API enforces the same policy; this redirect also removes the legacy form
    // from normal and direct-link navigation without affecting City/Branch.
    if (role === 'admin' && pathname.startsWith('/dashboard/admin/resellers/register')) {
      return NextResponse.redirect(new URL('/dashboard/admin/resellers', req.url))
    }

    if (payload.is_staff === true) {
      if (payload.staff_type === 'area_manager' && pathname.startsWith('/dashboard/') && !pathname.startsWith('/dashboard/area-manager')) {
        return NextResponse.redirect(new URL('/dashboard/area-manager', req.url))
      }
      const requiredPermission = requiredStaffPermission(pathname, req.method)
      const permissions = Array.isArray(payload.permissions) ? payload.permissions : []
      const hasPermission = !requiredPermission || requiredPermission.split('|').some((permission) => permissions.includes(permission))
      if (requiredPermission === '__owner_only__') {
        if (pathname.startsWith('/api/')) {
          return NextResponse.json({ error: 'Your staff account does not have permission for this action.' }, { status: 403 })
        }
        const fallback = role === 'admin' ? firstAdminStaffRoute(permissions) : '/dashboard/city'
        return NextResponse.redirect(new URL(fallback, req.url))
      }
      // Admin staff permissions are reloaded from the database by getCurrentUser
      // on every API request. This makes removals and deactivation immediate and
      // prevents a stale JWT from authorizing a mutation.
      if (role !== 'admin' && !hasPermission) {
        if (pathname.startsWith('/api/')) return NextResponse.json({ error: 'Your staff account does not have permission for this action.' }, { status: 403 })
        return NextResponse.redirect(new URL('/dashboard/city', req.url))
      }
    }

    if (pathname.startsWith('/api/')) {
      const requestHeaders = new Headers(req.headers)
      const requiredPermission = requiredStaffPermission(pathname, req.method)
      requestHeaders.delete('x-hiroma-staff-permission')
      if (payload.is_staff === true && role === 'admin' && requiredPermission) {
        requestHeaders.set('x-hiroma-staff-permission', requiredPermission)
      }
      return NextResponse.next({ request: { headers: requestHeaders } })
    }

    const allowedRoute = ROLE_ROUTES[role]

    // ── If accessing /dashboard root, redirect to role dashboard ──
    if (pathname === '/dashboard') {
      return NextResponse.redirect(new URL(allowedRoute, req.url))
    }

    // ── Block access to other role dashboards ──
    if (pathname.startsWith('/dashboard/')) {
      if (role === 'staff' && payload.is_staff === true && pathname.startsWith('/dashboard/city/support-center') && Array.isArray(payload.permissions) && payload.permissions.includes('support_center')) {
        return NextResponse.next()
      }
      const isDashboardAllowed = pathname.startsWith(allowedRoute)

      // Admin can access everything
      if (role === 'admin') {
        return NextResponse.next()
      }

      if (!isDashboardAllowed) {
        return NextResponse.redirect(new URL(allowedRoute, req.url))
      }
    }

    return NextResponse.next()
  } catch {
    // ── Invalid or expired token ──
    const response = NextResponse.redirect(new URL('/login', req.url))
    response.cookies.delete(COOKIE_NAME)
    return response
  }
}

// ============================================================
// MATCHER — which routes this middleware runs on
// ============================================================

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|hiroma-logo.jpg).*)',
  ],
}
