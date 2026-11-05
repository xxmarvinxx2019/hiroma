-- All packages share one carryover limit on each member's existing left/right balances.
-- Keep historical package policies and event references for audit.
CREATE OR REPLACE FUNCTION package_binary_cap_state_v2(package_key TEXT,member_key TEXT,at_time TIMESTAMPTZ)
RETURNS TABLE(enabled BOOLEAN,cap INTEGER,mode TEXT,policy_id TEXT,cutoff TEXT,session INTEGER,session_cap INTEGER,used_today BIGINT,used_session BIGINT,carryover_enabled BOOLEAN,carryover_limit INTEGER,carryover_policy_id TEXT)
LANGUAGE sql STABLE SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT s.*, true, 180000, NULL::text
 FROM package_binary_cap_state(package_key,member_key,at_time) s
$$;
