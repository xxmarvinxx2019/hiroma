export const PICKUP_TIME_ZONE = 'Asia/Manila'
export const MIN_PICKUP_NOTICE_MS = 15 * 60 * 1000
export const MAX_PICKUP_ADVANCE_MS = 30 * 24 * 60 * 60 * 1000

export class InvalidPickupScheduleError extends Error {}

/** Parse an HTML datetime-local value as Philippine time (UTC+08:00, no DST). */
export function parsePickupSchedule(value: unknown, now = new Date()) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) {
    throw new InvalidPickupScheduleError('Select a valid pickup date and time.')
  }
  const scheduledAt = new Date(`${value}:00+08:00`)
  if (Number.isNaN(scheduledAt.getTime())) {
    throw new InvalidPickupScheduleError('Select a valid pickup date and time.')
  }
  const delay = scheduledAt.getTime() - now.getTime()
  if (delay < MIN_PICKUP_NOTICE_MS) {
    throw new InvalidPickupScheduleError('Pickup must be scheduled at least 15 minutes from now.')
  }
  if (delay > MAX_PICKUP_ADVANCE_MS) {
    throw new InvalidPickupScheduleError('Pickup may be scheduled up to 30 days in advance.')
  }
  return scheduledAt
}
