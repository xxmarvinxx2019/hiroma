export const HIRO_INACTIVITY_MS = 5 * 60 * 1000

export const HIRO_INACTIVITY_MESSAGE =
  'This conversation ended automatically after 5 minutes of inactivity. Start a new chat whenever you need Hiro.'

const HIRO_CLOSE_PATTERNS = [
  /^(?:please\s+)?(?:close|end|stop)(?:\s+(?:the|this|our|my))?\s+(?:chat|convo|conco|conversation)(?:\s+please)?$/,
  /^(?:close|end|stop)\s+na(?:\s+(?:ang|ni|nato|ako(?:ng)?))?\s*(?:chat|convo|conco|conversation)?$/,
  /^(?:human|tapos)\s+na(?:\s+(?:ang|ta|tayo|ko|ako))?$/,
  /^(?:mao|iyon|yan|that)(?:\s+ra|\s+lang|\s+is)?(?:\s+all)?$/,
  /^(?:bye|goodbye|good bye|see you|salamat(?:\s+(?:hiro|bye))?|thank you(?:\s+(?:hiro|bye))?|thanks(?:\s+(?:hiro|bye))?)$/,
]

export function isHiroCloseRequest(message: string): boolean {
  const normalized = message
    .toLocaleLowerCase('en')
    .replace(/[.!?,;:]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

  return normalized.length > 0 && HIRO_CLOSE_PATTERNS.some((pattern) => pattern.test(normalized))
}

export function isHiroConversationInactive(
  lastActivity: Date,
  now = Date.now(),
  inactivityMs = HIRO_INACTIVITY_MS,
): boolean {
  const elapsed = now - lastActivity.getTime()
  return Number.isFinite(elapsed) && elapsed >= inactivityMs
}
