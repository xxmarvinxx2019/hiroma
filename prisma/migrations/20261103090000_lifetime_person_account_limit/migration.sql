BEGIN;
-- Lifetime memberships are independent of account status and registration outlet.
CREATE FUNCTION person_account_key(legal_name TEXT, born DATE) RETURNS TEXT
LANGUAGE sql IMMUTABLE STRICT SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT encode(sha256(convert_to(
   regexp_replace(lower(normalize(regexp_replace(trim(legal_name), '\s+(jr\.?|sr\.?|ii|iii|iv|v)$', '', 'i'), NFKC)), '[[:space:]''’.-]+', '', 'g')
   || '|' || to_char(born,'YYYY-MM-DD'), 'UTF8')), 'hex')
$$;
CREATE TABLE person_account_totals (
 person_key TEXT PRIMARY KEY, account_count INTEGER NOT NULL CHECK(account_count BETWEEN 1 AND 7)
);
CREATE TABLE person_account_memberships (
 user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE RESTRICT,
 person_key TEXT NOT NULL REFERENCES person_account_totals(person_key),
 created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX person_account_memberships_person ON person_account_memberships(person_key);
CREATE TABLE person_account_documents (
 document_hash TEXT PRIMARY KEY, person_key TEXT NOT NULL REFERENCES person_account_totals(person_key)
);
CREATE FUNCTION enforce_lifetime_person_accounts() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE member users%ROWTYPE; key TEXT; previous_key TEXT; document_key TEXT; changed INTEGER;
BEGIN
 SELECT * INTO member FROM users WHERE id=NEW.id;
 SELECT person_key INTO previous_key FROM person_account_memberships WHERE user_id=NEW.id;
 IF NOT FOUND AND member.role::text<>'reseller' THEN RETURN NULL; END IF;
 IF member.role::text<>'reseller' THEN
   RAISE EXCEPTION 'A registered reseller identity cannot be removed by changing its role.' USING ERRCODE='23514';
 END IF;
 IF member.birthday IS NULL OR member.identity_document_hash IS NULL OR length(trim(member.full_name))=0 THEN
   RAISE EXCEPTION 'Complete legal name, birthday and verified ID are required for the lifetime account limit.' USING ERRCODE='23514';
 END IF;
 key:=person_account_key(member.full_name,member.birthday);
 IF previous_key IS NOT NULL AND previous_key<>key THEN
   RAISE EXCEPTION 'Registered legal name and birthday require identity review and cannot be reassigned.' USING ERRCODE='23514';
 END IF;
 IF previous_key IS NULL THEN
   INSERT INTO person_account_totals(person_key,account_count) VALUES(key,1)
   ON CONFLICT(person_key) DO UPDATE SET account_count=person_account_totals.account_count+1
   WHERE person_account_totals.account_count<7;
   GET DIAGNOSTICS changed=ROW_COUNT;
   IF changed<>1 THEN RAISE EXCEPTION 'Maximum accounts (7) reached for this person, including inactive and suspended accounts.' USING ERRCODE='23514'; END IF;
   INSERT INTO person_account_memberships(user_id,person_key) VALUES(member.id,key);
 END IF;
 INSERT INTO person_account_documents(document_hash,person_key) VALUES(member.identity_document_hash,key)
 ON CONFLICT(document_hash) DO NOTHING;
 SELECT person_key INTO document_key FROM person_account_documents WHERE document_hash=member.identity_document_hash;
 IF document_key IS DISTINCT FROM key THEN
   RAISE EXCEPTION 'This ID belongs to an existing identity with different legal details. Identity review is required.' USING ERRCODE='23514';
 END IF;
 RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION enforce_lifetime_person_accounts() FROM PUBLIC;
CREATE CONSTRAINT TRIGGER users_lifetime_person_accounts
AFTER INSERT OR UPDATE ON users DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION enforce_lifetime_person_accounts();
-- Validate and enroll every historical reseller, including inactive/suspended.
-- Missing identity data, inconsistent shared IDs, or >7 accounts abort the migration.
UPDATE users SET full_name=full_name WHERE role::text='reseller';
SET CONSTRAINTS users_lifetime_person_accounts IMMEDIATE;
SET CONSTRAINTS users_lifetime_person_accounts DEFERRED;
INSERT INTO identity_account_limits(identity_hash,count,max_allowed)
 SELECT identity_document_hash,COUNT(*)::int,7 FROM users
 WHERE role::text='reseller' GROUP BY identity_document_hash
 ON CONFLICT(identity_hash) DO UPDATE SET count=EXCLUDED.count,max_allowed=7,updated_at=clock_timestamp();
ALTER TABLE identity_account_limits ADD CONSTRAINT identity_account_maximum_seven CHECK(max_allowed=7);
CREATE FUNCTION protect_person_account_registry() RETURNS TRIGGER
LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
 IF pg_trigger_depth()>1 AND TG_OP='INSERT' THEN RETURN NEW; END IF;
 IF pg_trigger_depth()>1 AND TG_TABLE_NAME='person_account_totals' AND TG_OP='UPDATE' THEN
   IF NEW.person_key=OLD.person_key AND NEW.account_count=OLD.account_count+1 THEN RETURN NEW; END IF;
 END IF;
 RAISE EXCEPTION 'Lifetime identity records cannot be edited, deleted or reset.' USING ERRCODE='23514';
END $$;
CREATE TRIGGER person_totals_protected BEFORE INSERT OR UPDATE OR DELETE ON person_account_totals FOR EACH ROW EXECUTE FUNCTION protect_person_account_registry();
CREATE TRIGGER person_memberships_protected BEFORE INSERT OR UPDATE OR DELETE ON person_account_memberships FOR EACH ROW EXECUTE FUNCTION protect_person_account_registry();
CREATE TRIGGER person_documents_protected BEFORE INSERT OR UPDATE OR DELETE ON person_account_documents FOR EACH ROW EXECUTE FUNCTION protect_person_account_registry();
CREATE TRIGGER person_totals_no_truncate BEFORE TRUNCATE ON person_account_totals FOR EACH STATEMENT EXECUTE FUNCTION protect_person_account_registry();
CREATE TRIGGER person_memberships_no_truncate BEFORE TRUNCATE ON person_account_memberships FOR EACH STATEMENT EXECUTE FUNCTION protect_person_account_registry();
CREATE TRIGGER person_documents_no_truncate BEFORE TRUNCATE ON person_account_documents FOR EACH STATEMENT EXECUTE FUNCTION protect_person_account_registry();
COMMIT;
