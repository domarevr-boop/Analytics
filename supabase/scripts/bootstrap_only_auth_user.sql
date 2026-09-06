do $$
declare
  v_user_count bigint;
  v_user_id uuid;
begin
  select count(*)
  into v_user_count
  from auth.users;

  if v_user_count <> 1 then
    raise exception 'Expected exactly one Auth user for bootstrap, found %', v_user_count;
  end if;

  select id
  into strict v_user_id
  from auth.users;

  perform app.bootstrap_first_admin(v_user_id);
end
$$;

select jsonb_build_object(
  'active_admin_count', count(*),
  'bootstrap_complete', count(*) = 1
) as first_admin_bootstrap
from app.user_access
where access_role = 'admin'
  and is_active;
