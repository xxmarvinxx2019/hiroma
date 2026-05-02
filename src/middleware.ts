import { NextRequest, NextResponse } from 'next/server'
import { jwtVerify } from 'jose'

// ============================================================
// CONFIG
// ============================================================

const JWT_SECRET = new TextEncoder().encode(
  process.env.JWT_SECRET || 'hiroma_super_secret_jwt_key_2026'
)

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
const PUBLIC_ROUTES = ['/', '/login', '/forgot-password']

// ============================================================
// MIDDLEWARE
// ============================================================

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl

  // ── Allow public routes ──
  if (PUBLIC_ROUTES.includes(pathname)) {
    return NextResponse.next()
  }

  // ── Allow API routes to handle their own auth ──
  if (pathname.startsWith('/api/')) {
    return NextResponse.next()
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

    const allowedRoute = ROLE_ROUTES[role]

    // ── If accessing /dashboard root, redirect to role dashboard ──
    if (pathname === '/dashboard') {
      return NextResponse.redirect(new URL(allowedRoute, req.url))
    }

    // ── Block access to other role dashboards ──
    if (pathname.startsWith('/dashboard/')) {
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