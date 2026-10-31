// Development-server failures and expired sessions can return empty or HTML
// responses. Show a useful error instead of leaking a JSON parser exception.
export async function readSettingsResponse<T>(response: Response, fallback: string): Promise<T> {
  let payload: unknown
  try { payload = JSON.parse(await response.text()) }
  catch { throw new Error(`${fallback} (HTTP ${response.status}). Reload the page and try again.`) }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error(`${fallback} The server returned an invalid response.`)
  }
  if (!response.ok) {
    const error = (payload as Record<string, unknown>).error
    throw new Error(typeof error === 'string' ? error : fallback)
  }
  return payload as T
}
