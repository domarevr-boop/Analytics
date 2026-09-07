begin;

do $$
declare
  v_user_id uuid;
begin
  select ua.user_id
  into strict v_user_id
  from app.user_access ua
  where ua.access_role = 'admin'
    and ua.is_active;

  perform set_config('request.jwt.claim.sub', v_user_id::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
end
$$;

set local role authenticated;

with current_access as (
  select * from public.v5_my_access()
), admin_rpc as (
  select public.v5_admin_set_user_access(
    auth.uid(),
    'admin',
    true,
    true
  ) as result
), directory as (
  select count(*) as user_count
  from public.v5_admin_user_directory()
)
select jsonb_build_object(
  'access_role', (select access_role from current_access),
  'all_cabinets', (select all_cabinets from current_access),
  'can_read', app.can_read(),
  'can_import', app.can_import(),
  'is_admin', app.is_admin(),
  'admin_rpc_role', (select result ->> 'access_role' from admin_rpc),
  'directory_has_current_user', (select user_count > 0 from directory),
  'audit_visible', (select count(*) > 0 from app.access_audit)
) as admin_access_smoke;

rollback;
