BEGIN;

-- Abort on historical conflicts so each transfer can be reconciled first.
CREATE UNIQUE INDEX payouts_normalized_disbursement_reference_key
ON payouts (
  lower(regexp_replace(btrim(disbursement_provider), '[[:space:]]+', ' ', 'g')),
  upper(regexp_replace(btrim(external_reference), '[[:space:]]+', ' ', 'g'))
)
WHERE disbursement_provider IS NOT NULL AND external_reference IS NOT NULL;

COMMIT;
