CREATE TABLE request_receipts (
  request_key TEXT PRIMARY KEY,
  fingerprint CHAR(64) NOT NULL,
  result JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TRIGGER request_receipts_immutable
BEFORE UPDATE OR DELETE ON request_receipts
FOR EACH ROW EXECUTE FUNCTION reject_financial_history_change();

CREATE TRIGGER request_receipts_no_truncate
BEFORE TRUNCATE ON request_receipts
FOR EACH STATEMENT EXECUTE FUNCTION reject_financial_history_change();
