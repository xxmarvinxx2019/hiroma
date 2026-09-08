export const MAINTENANCE_MODE_KEY = 'maintenance_mode'
export const MAINTENANCE_MESSAGE_KEY = 'maintenance_message'
export const MAINTENANCE_STARTED_AT_KEY = 'maintenance_started_at'

export const MAINTENANCE_SETTING_KEYS = [
  MAINTENANCE_MODE_KEY,
  MAINTENANCE_MESSAGE_KEY,
  MAINTENANCE_STARTED_AT_KEY,
]

export const DEFAULT_MAINTENANCE_MESSAGE =
  'Hiroma is temporarily under maintenance. Please try again later.'

export interface MaintenanceSettingRow {
  key: string
  value: string
  updated_at: Date
  updated_by: string | null
}

export interface MaintenanceState {
  enabled: boolean
  message: string
  startedAt: string | null
  updatedAt: string | null
  updatedBy: string | null
}

export function parseMaintenanceState(rows: readonly MaintenanceSettingRow[]): MaintenanceState {
  const settings = new Map(rows.map((row) => [row.key, row]))
  const mode = settings.get(MAINTENANCE_MODE_KEY)
  const message = settings.get(MAINTENANCE_MESSAGE_KEY)?.value.trim()
  const startedAt = settings.get(MAINTENANCE_STARTED_AT_KEY)?.value.trim()

  return {
    enabled: mode?.value === 'on',
    message: message || DEFAULT_MAINTENANCE_MESSAGE,
    startedAt: startedAt || null,
    updatedAt: mode?.updated_at?.toISOString() || null,
    updatedBy: mode?.updated_by || null,
  }
}

