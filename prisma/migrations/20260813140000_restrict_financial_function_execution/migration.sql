-- Financial mutation helpers are internal implementation details. PostgreSQL
-- grants EXECUTE on new functions to PUBLIC by default, so explicitly keep
-- these functions owner-only and out of Supabase RPC reach for public roles.
REVOKE ALL ON FUNCTION public.allocate_direct_referral_payout(TEXT, TEXT, NUMERIC, TIMESTAMP(3)) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.allocate_binary_payout(TEXT, TEXT, NUMERIC, TIMESTAMPTZ) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.allocate_product_binary_payout(TEXT, TEXT, NUMERIC, TIMESTAMPTZ) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.consume_product_binary_funding(TEXT, NUMERIC, TIMESTAMPTZ) FROM PUBLIC;
