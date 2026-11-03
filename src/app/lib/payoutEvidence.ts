type ReleasedPayout = {
  status: string
  disbursement_provider: string | null
  external_reference: string | null
  disbursed_amount: unknown
  disbursed_at: Date | null
}

export function matchesReleasedPayout(payout: ReleasedPayout | undefined, evidence: {
  provider: string
  reference: string
  amount: number
  disbursedAt: Date | null
}) {
  const normalize = (value: string | null) => value?.trim().replace(/\s+/g, ' ').toUpperCase()
  return payout?.status === 'released'
    && Boolean(evidence.provider && evidence.reference)
    && normalize(payout.disbursement_provider) === normalize(evidence.provider)
    && normalize(payout.external_reference) === normalize(evidence.reference)
    && payout.disbursed_amount != null
    && Number(payout.disbursed_amount) === evidence.amount
    && evidence.disbursedAt != null
    && payout.disbursed_at?.getTime() === evidence.disbursedAt.getTime()
}
