BEGIN;
CREATE TABLE financial_operation_receipts (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),kind TEXT NOT NULL CHECK(kind IN ('registration','upgrade')),
 source_id TEXT NOT NULL REFERENCES pins(id),owner_id TEXT NOT NULL REFERENCES users(id),actor_id TEXT NOT NULL REFERENCES users(id),
 request_hash TEXT NOT NULL CHECK(request_hash ~ '^[a-f0-9]{64}$'),response JSONB NOT NULL CHECK(jsonb_typeof(response)='object'),
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(),UNIQUE(kind,source_id)
);
CREATE INDEX financial_operation_receipts_owner_idx ON financial_operation_receipts(owner_id,created_at);
CREATE FUNCTION validate_financial_operation_receipt() RETURNS TRIGGER
LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE beneficiary TEXT;
BEGIN
 IF NEW.kind='registration' THEN
  SELECT reseller_id INTO beneficiary FROM registration_financials WHERE pin_id=NEW.source_id AND city_dist_id=NEW.owner_id;
 ELSE
  SELECT reseller_id INTO beneficiary FROM upgrade_financials WHERE upgrade_pin_id=NEW.source_id AND city_dist_id=NEW.owner_id;
 END IF;
 IF beneficiary IS NULL OR NEW.response->>'success' IS DISTINCT FROM 'true'
  OR NEW.response->'reseller'->>'id' IS DISTINCT FROM beneficiary
  OR NEW.response->>'operation_reference' IS DISTINCT FROM 'FO-'||NEW.id::text
 THEN RAISE EXCEPTION 'Operation receipt must match a completed financial source.' USING ERRCODE='23514'; END IF;
 IF NOT EXISTS(SELECT 1 FROM users WHERE id=NEW.actor_id AND status::text='active' AND
   (id=NEW.owner_id OR EXISTS(SELECT 1 FROM staff_profiles s WHERE s.user_id=NEW.actor_id AND s.owner_id=NEW.owner_id
     AND s.is_active AND s.permissions::jsonb ? 'register_reseller')))
 THEN RAISE EXCEPTION 'Operation receipt actor is not authorized.' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER financial_operation_receipt_validate BEFORE INSERT ON financial_operation_receipts FOR EACH ROW EXECUTE FUNCTION validate_financial_operation_receipt();
CREATE TRIGGER financial_operation_receipt_immutable BEFORE UPDATE OR DELETE ON financial_operation_receipts FOR EACH ROW EXECUTE FUNCTION reject_financial_history_change();
CREATE TRIGGER financial_operation_receipt_no_truncate BEFORE TRUNCATE ON financial_operation_receipts FOR EACH STATEMENT EXECUTE FUNCTION reject_financial_history_change();
REVOKE ALL ON FUNCTION validate_financial_operation_receipt() FROM PUBLIC;
COMMIT;
