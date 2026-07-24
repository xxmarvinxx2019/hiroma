// src/app/lib/auditLog.ts
// Call this from any route to log an activity

import prisma from '@/app/lib/prisma'
import { NextRequest } from 'next/server'

export type AuditCategory =
  | 'auth'
  | 'order'
  | 'commission'
  | 'wallet'
  | 'admin'
  | 'pin'
  | 'reseller'
  | 'payout'
  | 'product'
  | 'distributor'

export type AuditRiskLevel = 'low' | 'warning' | 'medium' | 'high' | 'critical'
export type AuditStatus    = 'normal' | 'suspicious' | 'duplicate' | 'under_review' | 'completed' | 'failed'

export interface AuditLogParams {
  user_id?:      string | null
  user_name?:    string
  user_role?:    string
  member_id?:    string
  activity_type: string
  category:      AuditCategory
  description:   string
  metadata?:     Record<string, any>
  ip_address?:   string
  device?:       string
  risk_level?:   AuditRiskLevel
  status?:       AuditStatus
}

export function getClientInfo(req: NextRequest): { ip_address: string; device: string } {
  const ip = (
    req.headers.get('x-forwarded-for')?.split(',')[0] ||
    req.headers.get('x-real-ip') ||
    '—'
  ).trim()

  const ua     = req.headers.get('user-agent') || ''
  let device   = 'Unknown'
  if (/iPhone|iPad/i.test(ua))          device = 'iPhone'
  else if (/Android/i.test(ua))         device = 'Android'
  else if (/Windows/i.test(ua))         device = 'Windows'
  else if (/Mac/i.test(ua))             device = 'Mac'
  else if (/Linux/i.test(ua))           device = 'Linux'

  return { ip_address: ip, device }
}

export function createAuditLog(params: AuditLogParams): void {
  // Fire and forget — never awaited, never blocks the main flow
  prisma.$executeRaw`
      INSERT INTO audit_logs (
        user_id, user_name, user_role, member_id,
        activity_type, category, description,
        metadata, ip_address, device, risk_level, status
      ) VALUES (
        ${params.user_id || null},
        ${params.user_name || null},
        ${params.user_role || null},
        ${params.member_id || null},
        ${params.activity_type},
        ${params.category},
        ${params.description},
        ${JSON.stringify(params.metadata || {})}::jsonb,
        ${params.ip_address || null},
        ${params.device || null},
        ${params.risk_level || 'low'},
        ${params.status || 'normal'}
      )
    `
    .catch(err => console.error('[AUDIT LOG ERROR]', err))
}

// Helper to generate member ID from user ID
export function formatMemberId(userId: string, role: string): string {
  const prefix = role === 'admin' ? 'AD' : 'HI'
  return `${prefix}-${userId.slice(0, 6).toUpperCase()}`
}