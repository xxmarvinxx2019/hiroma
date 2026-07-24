// src/app/api/admin/audit-logs/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/app/lib/auth'
import prisma from '@/app/lib/prisma'

export async function GET(req: NextRequest) {
  try {
    const user = await getCurrentUser()
    if (!user || user.role !== 'admin') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { searchParams } = req.nextUrl
    const page      = Math.max(1, parseInt(searchParams.get('page')     || '1'))
    const pageSize  = Math.max(1, parseInt(searchParams.get('pageSize') || '15'))
    const search    = searchParams.get('search')   || ''
    const category  = searchParams.get('category') || 'all'
    const riskLevel = searchParams.get('risk')     || 'all'
    const userType  = searchParams.get('userType') || 'all'
    const dateFrom  = searchParams.get('from')     || new Date().toLocaleDateString('en-CA')
    const dateTo    = searchParams.get('to')       || new Date().toLocaleDateString('en-CA')

    const fromDate = new Date(dateFrom)
    const toDate   = new Date(dateTo + 'T23:59:59')
    const offset   = (page - 1) * pageSize

    // Use parameterized queries to avoid SQL injection
    const [logsRaw, countRaw, summaryRaw, suspiciousRaw] = await Promise.all([
      prisma.$queryRaw<any[]>`
        SELECT id, user_id, user_name, user_role, member_id,
               activity_type, category, description, metadata,
               ip_address, device, risk_level, status, created_at
        FROM audit_logs
        WHERE created_at >= ${fromDate}
          AND created_at <= ${toDate}
          AND (${category} = 'all' OR category = ${category})
          AND (${riskLevel} = 'all' OR risk_level = ${riskLevel})
          AND (${userType} = 'all' OR user_role = ${userType})
          AND (
            ${search} = '' OR
            user_name ILIKE ${`%${search}%`} OR
            member_id ILIKE ${`%${search}%`} OR
            description ILIKE ${`%${search}%`} OR
            activity_type ILIKE ${`%${search}%`} OR
            ip_address ILIKE ${`%${search}%`}
          )
        ORDER BY created_at DESC
        LIMIT ${pageSize} OFFSET ${offset}
      `,
      prisma.$queryRaw<{ count: number }[]>`
        SELECT COUNT(*)::int AS count
        FROM audit_logs
        WHERE created_at >= ${fromDate}
          AND created_at <= ${toDate}
          AND (${category} = 'all' OR category = ${category})
          AND (${riskLevel} = 'all' OR risk_level = ${riskLevel})
          AND (${userType} = 'all' OR user_role = ${userType})
          AND (
            ${search} = '' OR
            user_name ILIKE ${`%${search}%`} OR
            member_id ILIKE ${`%${search}%`} OR
            description ILIKE ${`%${search}%`} OR
            activity_type ILIKE ${`%${search}%`} OR
            ip_address ILIKE ${`%${search}%`}
          )
      `,
      // Summary always based on today
      prisma.$queryRaw<{
        total_today:        number
        failed_logins:      number
        suspicious:         number
        duplicates:         number
        admin_actions:      number
        wallet_adjustments: number
      }[]>`
        SELECT
          COUNT(*)::int                                                          AS total_today,
          COUNT(CASE WHEN activity_type = 'failed_login' THEN 1 END)::int      AS failed_logins,
          COUNT(CASE WHEN status = 'suspicious' THEN 1 END)::int               AS suspicious,
          COUNT(CASE WHEN status = 'duplicate' THEN 1 END)::int                AS duplicates,
          COUNT(CASE WHEN user_role = 'admin' THEN 1 END)::int                 AS admin_actions,
          COUNT(CASE WHEN category = 'wallet' THEN 1 END)::int                 AS wallet_adjustments
        FROM audit_logs
        WHERE created_at >= ${new Date(new Date().setHours(0, 0, 0, 0))}
          AND created_at <= ${new Date(new Date().setHours(23, 59, 59, 999))}
      `,
      // Recent suspicious
      prisma.$queryRaw<any[]>`
        SELECT user_name, activity_type, description, risk_level, created_at
        FROM audit_logs
        WHERE status = 'suspicious' OR risk_level IN ('high', 'critical')
        ORDER BY created_at DESC
        LIMIT 5
      `,
    ])

    const total   = Number(countRaw[0]?.count || 0)
    const summary = summaryRaw[0] as {
      total_today:        number
      failed_logins:      number
      suspicious:         number
      duplicates:         number
      admin_actions:      number
      wallet_adjustments: number
    } | undefined

    return NextResponse.json({
      logs: logsRaw,
      meta: { total, page, pageSize, totalPages: Math.max(1, Math.ceil(total / pageSize)) },
      summary: {
        total_today:        Number(summary.total_today        || 0),
        failed_logins:      Number(summary.failed_logins      || 0),
        suspicious:         Number(summary.suspicious         || 0),
        duplicates:         Number(summary.duplicates         || 0),
        admin_actions:      Number(summary.admin_actions      || 0),
        wallet_adjustments: Number(summary.wallet_adjustments || 0),
      },
      suspicious_activities: suspiciousRaw,
    })
  } catch (error) {
    console.error('[AUDIT LOG ERROR]', error)
    return NextResponse.json({ error: 'Something went wrong.' }, { status: 500 })
  }
}