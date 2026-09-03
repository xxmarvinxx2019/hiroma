type NetworkSnapshotInput = {
  referrer_username: unknown
  preferred_position: unknown
  applicant_snapshot: unknown
}

export type PosRegistrationNetworkSnapshot = {
  referrerUserId: string | null
  referrerUsername: string
  parentNodeId: string | null
  uplineUsername: string
  position: 'left' | 'right'
}

type SelectedNetwork = {
  referrerUserId: string
  referrerUsername: string
  parentNodeId: string
  parentUsername: string
  position: 'left' | 'right'
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function text(value: unknown) {
  return typeof value === 'string' ? value.trim() : ''
}

function username(value: unknown) {
  return text(value).toLowerCase()
}

function position(value: unknown): 'left' | 'right' | null {
  return value === 'left' || value === 'right' ? value : null
}

export class PosRegistrationNetworkBindingError extends Error {
  constructor() {
    super('The sponsor, upline, or leg no longer matches the paid POS registration. Start an authorized correction instead of changing the released handoff.')
    this.name = 'PosRegistrationNetworkBindingError'
  }
}

export function readPosRegistrationNetworkSnapshot(
  input: NetworkSnapshotInput,
): PosRegistrationNetworkSnapshot {
  const applicant = record(input.applicant_snapshot)
  const referrerUsername = username(applicant?.referrer_username) || username(input.referrer_username)
  const uplineUsername = username(applicant?.upline_username)
  const selectedPosition = position(applicant?.preferred_position) || position(input.preferred_position)

  if (!referrerUsername || !uplineUsername || !selectedPosition) {
    throw new PosRegistrationNetworkBindingError()
  }

  return {
    referrerUserId: text(applicant?.referrer_user_id) || null,
    referrerUsername,
    parentNodeId: text(applicant?.parent_node_id) || null,
    uplineUsername,
    position: selectedPosition,
  }
}

export function assertPosRegistrationNetworkBinding(
  snapshot: PosRegistrationNetworkSnapshot,
  selected: SelectedNetwork,
) {
  const referrerMatches = snapshot.referrerUserId
    ? snapshot.referrerUserId === selected.referrerUserId
    : snapshot.referrerUsername === username(selected.referrerUsername)
  const parentMatches = snapshot.parentNodeId
    ? snapshot.parentNodeId === selected.parentNodeId
    : snapshot.uplineUsername === username(selected.parentUsername)

  if (!referrerMatches || !parentMatches || snapshot.position !== selected.position) {
    throw new PosRegistrationNetworkBindingError()
  }
}
