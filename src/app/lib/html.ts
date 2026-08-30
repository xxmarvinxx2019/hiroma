const HTML_TEXT_ENTITIES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
}

/**
 * Escapes untrusted values before placing them in an HTML text context.
 * Keep persisted/API values unchanged so React views and business data do not
 * become double-encoded.
 */
export function escapeHtmlText(value: unknown): string {
  return String(value ?? '').replace(/[&<>"']/g, (character) => HTML_TEXT_ENTITIES[character])
}

/**
 * Creates a receipt-only copy whose persisted text fields are safe to place in
 * a generated HTML document. Numbers, booleans, nulls, and object shape remain
 * unchanged, so receipt calculations and formatting keep their current inputs.
 */
export function escapeHtmlTextValues<T>(value: T): T {
  if (typeof value === 'string') return escapeHtmlText(value) as T
  if (Array.isArray(value)) return value.map((item) => escapeHtmlTextValues(item)) as T
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, escapeHtmlTextValues(item)])
    ) as T
  }
  return value
}
