-- Read-only check after running 20260930_subscriptions.sql
SELECT 'approved_with_end_date' AS check_name,
       (SELECT count(*) FROM businesses WHERE status='approved' AND access_ends_at IS NOT NULL)::text AS result, '4' AS expected
UNION ALL SELECT 'approved_without_end_date',
       (SELECT count(*) FROM businesses WHERE status='approved' AND access_ends_at IS NULL)::text, '0'
UNION ALL SELECT 'rules_with_access_check',
       (SELECT count(*) FROM pg_policies WHERE schemaname='public'
          AND (coalesce(qual,'')||coalesce(with_check,'')) LIKE '%business_has_access%')::text, '81'
UNION ALL SELECT 'platform_admin_and_select_rules_untouched',
       (SELECT count(*) FROM pg_policies WHERE schemaname='public'
          AND policyname IN ('businesses_select','businesses_platform_admin_select','businesses_platform_admin_update',
                             'Platform admins can read contact messages','Platform admins can update contact messages')
          AND (coalesce(qual,'')||coalesce(with_check,'')) NOT LIKE '%business_has_access%')::text, '5'
UNION ALL SELECT 'total_rules',
       (SELECT count(*) FROM pg_policies WHERE schemaname='public')::text, '86'
UNION ALL SELECT 'browser_can_read_pin_hash',
       has_column_privilege('authenticated','public.staff_users','pin_hash','SELECT')::text, 'false'
UNION ALL SELECT 'browser_can_read_display_name',
       has_column_privilege('authenticated','public.staff_users','display_name','SELECT')::text, 'true';
