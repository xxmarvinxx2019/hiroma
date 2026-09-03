ALTER TABLE "pos_registration_intakes"
ADD COLUMN "identity_document_hash" VARCHAR(64);

CREATE INDEX "pos_registration_intakes_owner_id_identity_document_hash_status_idx"
ON "pos_registration_intakes"("owner_id", "identity_document_hash", "status");

CREATE OR REPLACE FUNCTION lock_pos_registration_intake_identity_write()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
  IF NEW.identity_document_hash IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(
      hashtextextended(
        'hiroma:pos-registration:' || lower(NEW.identity_document_hash),
        0
      )
    );
  END IF;
  RETURN NEW;
END;
$function$;

CREATE TRIGGER pos_registration_intakes_identity_write_lock
BEFORE INSERT OR UPDATE OF identity_document_hash, released_at
ON "pos_registration_intakes"
FOR EACH ROW
EXECUTE FUNCTION lock_pos_registration_intake_identity_write();
