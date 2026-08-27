export function canLocalAccountCount(isStaff: boolean, starterStaffType: string | null | undefined) {
  return isStaff && starterStaffType !== 'area_manager'
}

export function canLocalOwnerReview(params: {
  isAuthorizedApprover: boolean
  status: string
  submitterId: string | null | undefined
  starterId: string
  actorId: string
}) {
  const submitterId = params.submitterId || params.starterId
  return params.isAuthorizedApprover && params.status === 'submitted' && submitterId !== params.actorId
}
