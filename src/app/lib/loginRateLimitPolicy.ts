export const LOGIN_IP_WINDOW_MINUTES = 5
export const LOGIN_IP_WINDOW_LIMIT = 30
export const LOGIN_ACCOUNT_WINDOW_MINUTES = 15
export const LOGIN_ACCOUNT_WINDOW_LIMIT = 8

export function normalizeLoginIdentifier(value: string) {
  return value.trim().toLocaleLowerCase('en-PH')
}

export function loginRateLimitDecision(ipCount: number, accountCount: number) {
  if (ipCount > LOGIN_IP_WINDOW_LIMIT) {
    return { allowed: false as const, retryAfterSeconds: LOGIN_IP_WINDOW_MINUTES * 60 }
  }
  if (accountCount > LOGIN_ACCOUNT_WINDOW_LIMIT) {
    return { allowed: false as const, retryAfterSeconds: LOGIN_ACCOUNT_WINDOW_MINUTES * 60 }
  }
  return { allowed: true as const, retryAfterSeconds: 0 }
}
