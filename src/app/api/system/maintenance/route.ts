import { NextResponse } from 'next/server'
import { getMaintenanceState } from '@/app/lib/maintenanceMode'

const NO_STORE_HEADERS = {
  'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
  Pragma: 'no-cache',
}

export async function GET() {
  try {
    const state = await getMaintenanceState()
    return NextResponse.json(
      { enabled: state.enabled, message: state.message, startedAt: state.startedAt },
      { headers: NO_STORE_HEADERS },
    )
  } catch (error) {
    console.error('[MAINTENANCE STATUS ERROR]', error)
    return NextResponse.json(
      {
        enabled: true,
        unavailable: true,
        message: 'Hiroma is temporarily unavailable. Please try again later.',
        startedAt: null,
      },
      { status: 503, headers: NO_STORE_HEADERS },
    )
  }
}

