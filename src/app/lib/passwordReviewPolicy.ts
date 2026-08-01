const MANILA_OFFSET_MS = 8 * 60 * 60 * 1000

export type PasswordReviewReason =
  | 'temporary_first_login'
  | 'temporary_day_3'
  | 'temporary_day_7'
  | 'temporary_day_30'
  | 'quarterly'

export function getManilaStartOfDay(value: Date) {
  const shifted = new Date(value.getTime() + MANILA_OFFSET_MS)
  return new Date(Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate()) - MANILA_OFFSET_MS)
}

export function addManilaCalendarDays(value: Date, days: number) {
  return new Date(getManilaStartOfDay(value).getTime() + days * 24 * 60 * 60 * 1000)
}

export function isPasswordReviewDue(required: boolean, dueAt: Date | null, now = new Date()) {
  return required || Boolean(dueAt && dueAt.getTime() <= now.getTime())
}

export function getPasswordReviewReason(isTemporary: boolean, stage: number): PasswordReviewReason {
  if (!isTemporary || stage >= 4) return 'quarterly'
  if (stage === 0) return 'temporary_first_login'
  if (stage === 1) return 'temporary_day_3'
  if (stage === 2) return 'temporary_day_7'
  return 'temporary_day_30'
}

export function getNextRetainedPasswordReview(createdAt: Date, now = new Date()) {
  const today = getManilaStartOfDay(now)
  const checkpoints = [
    { stage: 1, dueAt: addManilaCalendarDays(createdAt, 2) },
    { stage: 2, dueAt: addManilaCalendarDays(createdAt, 6) },
    { stage: 3, dueAt: addManilaCalendarDays(createdAt, 29) },
  ]
  return checkpoints.find((checkpoint) => checkpoint.dueAt.getTime() > today.getTime())
    || { stage: 4, dueAt: addManilaCalendarDays(now, 90) }
}

export function getNextQuarterlyPasswordReview(now = new Date()) {
  return addManilaCalendarDays(now, 90)
}
