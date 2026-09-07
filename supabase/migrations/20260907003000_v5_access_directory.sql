begin;

create or replace function public.v5_admin_user_directory()
returns table (
  user_id uuid,
  email text,
  created_at timestamptz,
  last_sign_in_at timestamptz,
  access_role text,
  all_cabinets boolean,
  is_active boolean,
  cabinet_ids uuid[]
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not app.is_admin() then
    raise exception 'V5 administrator access is required';
  end if;

  return query
  select
    users.id,
    users.email::text,
    users.created_at,
    users.last_sign_in_at,
    access.access_role::text,
    coalesce(access.all_cabinets, false),
    coalesce(access.is_active, false),
    coalesce(
      array_agg(cabinet_access.cabinet_id order by cabinet_access.cabinet_id)
        filter (where cabinet_access.cabinet_id is not null),
      '{}'::uuid[]
    )
  from auth.users users
  left join app.user_access access on access.user_id = users.id
  left join app.user_cabinet_access cabinet_access on cabinet_access.user_id = users.id
  group by users.id, users.email, users.created_at, users.last_sign_in_at,
    access.access_role, access.all_cabinets, access.is_active
  order by users.created_at, users.id;
end
$$;

revoke all on function public.v5_admin_user_directory() from public, anon;
grant execute on function public.v5_admin_user_directory() to authenticated;

create or replace function public.v5_health()
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select jsonb_build_object(
    'environment', 'analytics-v5',
    'schema_version', '20260907003000',
    'status', 'ok'
  )
$$;

revoke all on function public.v5_health() from public;
grant execute on function public.v5_health() to anon, authenticated;

comment on function public.v5_admin_user_directory() is 'Admin-only V5 Auth directory with application roles and cabinet grants.';

commit;
