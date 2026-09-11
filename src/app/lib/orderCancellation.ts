import type { JWTPayload } from '@/app/lib/auth'

export function buildOrderCancellationEvidence(
  actor: JWTPayload,
  reason?: unknown,
  roleOverride?: string,
) {
  const cleanReason =
    typeof reason === 'string' ? reason.trim().slice(0, 500) : ''
  const actorRole = roleOverride || (actor.is_staff ? 'staff' : actor.role)
  return {
    cancelled_at: new Date(),
    cancelled_by_actor_id: actor.actor_id || actor.id,
    cancelled_by_name: (actor.actor_name || actor.full_name || actor.username).slice(0, 160),
    cancelled_by_role: actorRole.slice(0, 40),
    cancellation_reason:
      cleanReason || `Cancelled by ${actorRole.replaceAll('_', ' ')}.`,
  }
}
