begin;

-- Keep the legacy enum value for compatibility with existing RPC signatures.
-- Every activated application user now has one identical set of permissions.
update app.user_access
set access_role = 'admin',
    all_cabinets = true
where access_role <> 'admin' or not all_cabinets;

delete from app.user_cabinet_access;

alter table app.user_access
  alter column access_role set default 'admin',
  alter column all_cabinets set default true;

alter table app.user_access
  add constraint user_access_full_access_only
  check (access_role = 'admin' and all_cabinets);

create or replace function app.can_read()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select app.is_admin()
$$;

create or replace function app.can_import()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select app.is_admin()
$$;

create or replace function app.can_access_cabinet(p_cabinet_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select app.is_admin()
$$;

create or replace function app.can_read_batch(p_batch_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select app.is_admin()
    and exists (
      select 1 from ingest.import_batches batch where batch.id = p_batch_id
    )
$$;

create or replace function public.v5_admin_set_user_access(
  p_user_id uuid,
  p_access_role text,
  p_all_cabinets boolean default false,
  p_is_active boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_before jsonb;
begin
  if not app.is_admin() then
    raise exception 'V5 full access is required';
  end if;

  if p_access_role is distinct from 'admin' or p_all_cabinets is distinct from true then
    raise exception 'V5 supports only full-access users';
  end if;

  if not exists (select 1 from auth.users users where users.id = p_user_id) then
    raise exception 'Auth user % does not exist', p_user_id;
  end if;

  if p_user_id = v_actor and not p_is_active then
    raise exception 'A user cannot disable their own account';
  end if;

  select jsonb_build_object(
    'access_role', access.access_role,
    'all_cabinets', access.all_cabinets,
    'is_active', access.is_active
  )
  into v_before
  from app.user_access access
  where access.user_id = p_user_id;

  insert into app.user_access (
    user_id, access_role, all_cabinets, is_active, created_by
  )
  values (p_user_id, 'admin', true, p_is_active, v_actor)
  on conflict (user_id) do update
  set access_role = 'admin',
      all_cabinets = true,
      is_active = excluded.is_active,
      created_by = v_actor;

  delete from app.user_cabinet_access where user_id = p_user_id;

  insert into app.access_audit (
    event_type, actor_user_id, target_user_id, details
  )
  values (
    'user_access_changed', v_actor, p_user_id,
    jsonb_build_object(
      'before', v_before,
      'after', jsonb_build_object(
        'access_role', 'admin',
        'all_cabinets', true,
        'is_active', p_is_active
      )
    )
  );

  return jsonb_build_object(
    'user_id', p_user_id,
    'access_role', 'admin',
    'all_cabinets', true,
    'is_active', p_is_active
  );
end
$$;

do $$
begin
  if to_regprocedure('public.v5_admin_set_cabinet_access(uuid,uuid,boolean)') is not null then
    revoke execute on function public.v5_admin_set_cabinet_access(uuid, uuid, boolean)
    from authenticated;
  end if;
end
$$;

comment on table app.user_access is
  'Only active, explicitly enabled V5 users have full access to every cabinet and feature.';
comment on function public.v5_admin_set_user_access(uuid, text, boolean, boolean) is
  'Enable or disable the single full-access V5 user capability; legacy role parameters are validated.';

commit;
