export const config = {
  regions: ['sin1'],
  crons: [
    { path: '/api/cron/release-payouts', schedule: '0 16 * * *' },
    {
      path: '/api/cron/process-product-binary',
      schedule: process.env.PRODUCT_BINARY_FREQUENT_CRON === 'true' ? '* * * * *' : '0 2 * * *',
    },
    { path: '/api/cron/reset-ranks', schedule: '0 16 * * *' },
    { path: '/api/cron/expire-pin-requests', schedule: '0 16 * * *' },
    { path: '/api/cron/expire-unpaid-orders', schedule: '0 16 * * *' },
    { path: '/api/cron/expire-binary-points', schedule: '0 16 * * *' },
    { path: '/api/cron/expire-product-pu', schedule: '15 16 * * *' },
  ],
}
