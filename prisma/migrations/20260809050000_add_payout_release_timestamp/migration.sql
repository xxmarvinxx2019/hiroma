ALTER TABLE payouts ADD COLUMN IF NOT EXISTS released_at TIMESTAMPTZ(6);
UPDATE payouts SET released_at=COALESCE(payout_date,processed_at,requested_at)
WHERE status='released' AND released_at IS NULL;
CREATE INDEX IF NOT EXISTS payouts_released_at_idx ON payouts(released_at) WHERE status='released';
