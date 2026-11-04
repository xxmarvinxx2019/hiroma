CREATE FUNCTION package_binary_shared_policy_package()
RETURNS TEXT LANGUAGE sql STABLE SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT id FROM packages WHERE lower(btrim(name))='starter' ORDER BY created_at,id LIMIT 1
$$;
CREATE OR REPLACE FUNCTION package_binary_cap_state(package_key TEXT, member_key TEXT, at_time TIMESTAMPTZ)
RETURNS TABLE(enabled BOOLEAN,cap INTEGER,mode TEXT,policy_id TEXT,cutoff TEXT,session INTEGER,session_cap INTEGER,used_today BIGINT,used_session BIGINT)
LANGUAGE plpgsql STABLE SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE chosen RECORD; pairing_date DATE; minute_now INTEGER; first_cap INTEGER; cutoff_at INTEGER; total_recorded BIGINT; session_recorded BIGINT;
BEGIN
 package_key:=COALESCE(package_binary_shared_policy_package(),package_key);
 pairing_date:=(at_time AT TIME ZONE 'Asia/Manila')::date;
 SELECT p.* INTO chosen FROM package_binary_cap_policies p WHERE p.package_id=package_key AND p.effective_day<=pairing_date ORDER BY p.effective_day DESC,p.revision DESC LIMIT 1;
 IF FOUND THEN
  enabled:=chosen.enabled;cap:=chosen.daily_limit;mode:=chosen.mode;policy_id:=chosen.id::text;first_cap:=chosen.first_limit;cutoff_at:=chosen.cutoff_minute;
 ELSE
  SELECT COALESCE(p.binary_pair_cap_enabled,true),GREATEST(1,COALESCE(p.daily_binary_pair_cap,10)) INTO enabled,cap FROM packages p WHERE p.id=package_key;
  mode:='two_sessions';first_cap:=GREATEST(1,cap/2);cutoff_at:=780;policy_id:=NULL;
 END IF;
 IF cap IS NULL THEN RAISE EXCEPTION 'Package Binary cap package is missing.'; END IF;
 SELECT COALESCE((SELECT d.used_pairs FROM binary_daily_cap_usage d WHERE d.user_id=member_key AND d.pairing_day=pairing_date),0) INTO used_today;
 IF mode='daily_anytime' THEN session:=0;session_cap:=cap;used_session:=used_today;cutoff:=NULL;
 ELSE
  minute_now:=extract(hour FROM at_time AT TIME ZONE 'Asia/Manila')::int*60+extract(minute FROM at_time AT TIME ZONE 'Asia/Manila')::int;
  session:=CASE WHEN minute_now<cutoff_at THEN 1 ELSE 2 END;
  session_cap:=CASE WHEN session=1 THEN first_cap ELSE GREATEST(1,cap-first_cap) END;
  cutoff:=lpad((cutoff_at/60)::text,2,'0')||':'||lpad((cutoff_at%60)::text,2,'0');
  SELECT COALESCE(SUM(e.payable_pairs+e.inactive_flashout_pairs),0),
   COALESCE(SUM(e.payable_pairs+e.inactive_flashout_pairs) FILTER(WHERE COALESCE(e.cap_session,
    CASE WHEN extract(hour FROM e.created_at AT TIME ZONE 'Asia/Manila')*60+extract(minute FROM e.created_at AT TIME ZONE 'Asia/Manila')<cutoff_at THEN 1 ELSE 2 END)=session),0)
  INTO total_recorded,session_recorded FROM binary_pair_events e WHERE e.recipient_user_id=member_key AND e.pairing_day=pairing_date;
  used_session:=session_recorded+GREATEST(0,used_today-total_recorded);
 END IF;
 RETURN NEXT;
END $$;

CREATE OR REPLACE FUNCTION package_binary_cap_state_v2(package_key TEXT,member_key TEXT,at_time TIMESTAMPTZ)
RETURNS TABLE(enabled BOOLEAN,cap INTEGER,mode TEXT,policy_id TEXT,cutoff TEXT,session INTEGER,session_cap INTEGER,used_today BIGINT,used_session BIGINT,carryover_enabled BOOLEAN,carryover_limit INTEGER,carryover_policy_id TEXT)
LANGUAGE sql STABLE SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT s.*,true,COALESCE(c.max_points,180000),c.id::text
 FROM package_binary_cap_state(package_key,member_key,at_time) s
 LEFT JOIN LATERAL (
   SELECT p.id,p.max_points FROM package_binary_carryover_policies p
   WHERE p.package_id=package_binary_shared_policy_package()
     AND p.cap_policy_id::text=s.policy_id
   LIMIT 1
 ) c ON true
$$;
