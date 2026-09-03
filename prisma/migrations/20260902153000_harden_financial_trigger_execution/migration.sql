-- Close the trigger-depth trust boundary. Financial triggers may perform
-- owner-only internal mutations, but the runtime role must never be able to
-- execute or attach those trigger functions itself.
BEGIN;

DO $$
BEGIN
  IF current_setting('server_version_num')::INTEGER < 150000 THEN
    RAISE EXCEPTION 'Hiroma financial migrations require PostgreSQL 15 or newer.';
  END IF;
END $$;

LOCK TABLE
  "commissions",
  "orders",
  "payouts",
  "wallet_ledger_entries",
  "wallets"
IN SHARE ROW EXCLUSIVE MODE;

-- These wrappers require owner authority after the deployment role revokes
-- direct wallet/internal-ledger DML from the application role. A fixed search
-- path prevents object-shadowing in SECURITY DEFINER execution.
DO $$
DECLARE
  function_signature TEXT;
  resolved_function REGPROCEDURE;
BEGIN
  FOREACH function_signature IN ARRAY ARRAY[
    'public.apply_wallet_ledger_entry()',
    'public.allocate_approved_direct_referral_payout()',
    'public.allocate_approved_binary_payout()',
    'public.allocate_approved_product_binary_payout()',
    'public.fund_product_binary_commission()',
    'public.qualify_product_binary_order_trigger()',
    'public.maintain_binary_tree_ancestor_counts()',
    'public.allocate_direct_referral_payout(text,text,numeric,timestamp without time zone)',
    'public.allocate_binary_payout(text,text,numeric,timestamp with time zone)',
    'public.allocate_product_binary_payout(text,text,numeric,timestamp with time zone)',
    'public.consume_product_binary_funding(text,numeric,timestamp with time zone)',
    'public.qualify_product_binary_order(text)'
  ] LOOP
    resolved_function := to_regprocedure(function_signature);
    IF resolved_function IS NULL THEN
      RAISE EXCEPTION 'Required financial function is missing: %', function_signature
        USING ERRCODE = '42883';
    END IF;

    EXECUTE format('ALTER FUNCTION %s SECURITY DEFINER', resolved_function);
    EXECUTE format(
      'ALTER FUNCTION %s SET search_path TO pg_catalog, public, pg_temp',
      resolved_function
    );
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', resolved_function);
  END LOOP;
END $$;

-- PostgreSQL grants EXECUTE on new functions to PUBLIC by default. Revoke it
-- from every non-internal trigger function attached to a public application
-- table. Installed triggers continue to fire; callers cannot reuse the
-- function on a temp/unprotected table to spoof pg_trigger_depth().
DO $$
DECLARE
  protected_function REGPROCEDURE;
BEGIN
  FOR protected_function IN
    SELECT DISTINCT procedure.oid::regprocedure
    FROM pg_trigger trigger
    JOIN pg_class class ON class.oid = trigger.tgrelid
    JOIN pg_namespace table_namespace ON table_namespace.oid = class.relnamespace
    JOIN pg_proc procedure ON procedure.oid = trigger.tgfoid
    JOIN pg_namespace function_namespace ON function_namespace.oid = procedure.pronamespace
    WHERE NOT trigger.tgisinternal
      AND table_namespace.nspname = 'public'
      AND function_namespace.nspname = 'public'
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', protected_function);
  END LOOP;
END $$;

COMMIT;
