export class ReservedPayoutBlocksDeactivationError extends Error {
  constructor() {
    super('Resolve the reseller’s pending or approved payout before deactivation.')
    this.name = 'ReservedPayoutBlocksDeactivationError'
  }
}

export class ConcurrentDeactivationError extends Error {
  constructor() {
    super('The reseller status was already changed by another request.')
    this.name = 'ConcurrentDeactivationError'
  }
}
