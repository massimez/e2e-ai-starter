CREATE OR REPLACE FUNCTION public.prune_expired_audit_logs(retention_days integer)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
	deleted_count integer;
BEGIN
	IF retention_days IS NULL OR retention_days < 30 THEN
		RAISE EXCEPTION 'audit_log retention floor is 30 days (requested: %)', retention_days
			USING ERRCODE = '22023';
	END IF;

	PERFORM set_config('app.audit_retention_prune', 'on', true);

	DELETE FROM public.audit_log
	WHERE created_at < (now() - make_interval(days => retention_days));

	GET DIAGNOSTICS deleted_count = ROW_COUNT;
	RETURN deleted_count;
END;
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.prune_expired_audit_logs(integer) FROM PUBLIC;
