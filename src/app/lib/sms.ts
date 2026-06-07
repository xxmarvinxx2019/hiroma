// ============================================================
// Semaphore SMS Helper
// Docs: https://semaphore.co/docs
// ============================================================

const SEMAPHORE_API_URL  = 'https://api.semaphore.co/api/v4/messages'
const SEMAPHORE_API_KEY  = process.env.SEMAPHORE_API_KEY || ''
const SEMAPHORE_SENDER   = process.env.SEMAPHORE_SENDER_NAME || 'HIROMA'

interface SMSResult {
  success: boolean
  error?:  string
}

// ── Format PH mobile number ──
// Accepts: 09XXXXXXXXX, +639XXXXXXXXX, 639XXXXXXXXX
// Returns: 09XXXXXXXXX (Semaphore format)
function formatMobile(mobile: string): string {
  const clean = mobile.replace(/\s+/g, '').replace(/[^0-9+]/g, '')
  if (clean.startsWith('+63')) return '0' + clean.slice(3)
  if (clean.startsWith('63'))  return '0' + clean.slice(2)
  if (clean.startsWith('09'))  return clean
  return clean
}

// ── Send SMS ──
export async function sendSMS(mobile: string, message: string): Promise<SMSResult> {
  if (!SEMAPHORE_API_KEY) {
    console.warn('[SMS] SEMAPHORE_API_KEY not set — skipping SMS')
    return { success: false, error: 'API key not configured' }
  }

  const number = formatMobile(mobile)

  try {
    const res = await fetch(SEMAPHORE_API_URL, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        apikey:     SEMAPHORE_API_KEY,
        number,
        message,
        sendername: SEMAPHORE_SENDER,
      }),
    })

    const data = await res.json()

    if (!res.ok) {
      console.error('[SMS] Semaphore error:', data)
      return { success: false, error: data?.message || 'SMS send failed' }
    }

    console.log(`[SMS] ✅ Sent to ${number}`)
    return { success: true }
  } catch (error: any) {
    console.error('[SMS] Exception:', error?.message)
    return { success: false, error: error?.message }
  }
}

// ── SMS Templates ──

export function smsWelcomeReseller({
  full_name,
  username,
  password,
  package_name,
}: {
  full_name:    string
  username:     string
  password:     string
  package_name: string
}): string {
  const first_name = full_name.split(' ')[0]
  return `Welcome to HIROMA, ${first_name}!

Your account is now active.
Package: ${package_name}

Login details:
Username: ${username}
Password: ${password}

Login at: hiroma.com

Keep your credentials safe. - HIROMA Team`
}