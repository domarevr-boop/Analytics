begin;

create table app.access_audit (
  id bigint generated always as identity primary key,
  event_type text not null,
  actor_user_id uuid references auth.users(id) on delete set null,
  target_user_id uuid references auth.users(id) on delete set null,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  constraint access_audit_event_type_not_blank check (btrim(event_type) <> '')
);

alter table app.access_audit enable row level security;

create policy access_audit_read_admin
on app.access_audit for select to authenticated
using (app.is_admin());

grant select on app.access_audit to authenticated;

create or replace function app.bootstrap_first_admin(p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (
    select 1
    from app.user_access ua
    where ua.access_role = 'admin'
      and ua.is_active
  ) then
    raise exception 'An active V5 administrator already exists';
  end if;

  if not exists (select 1 from auth.users u where u.id = p_user_id) then
    raise exception 'Auth user % does not exist', p_user_id;
  end if;

  insert into app.user_access (
    user_id,
    access_role,
    all_cabinets,
    is_active,
    created_by
  )
  values (p_user_id, 'admin', true, true, null)
  on conflict (user_id) do update
  set access_role = 'admin',
      all_cabinets = true,
      is_active = true,
      created_by = null;

  delete from app.user_cabinet_access where user_id = p_user_id;

  insert into app.access_audit (event_type, target_user_id, details)
  values (
    'first_admin_bootstrap',
    p_user_id,
    jsonb_build_object('role', 'admin', 'all_cabinets', true, 'active', true)
  );

  return jsonb_build_object(
    'user_id', p_user_id,
    'access_role', 'admin',
    'all_cabinets', true,
    'is_active', true
  );
end
$$;

revoke all on function app.bootstrap_first_admin(uuid) from public, anon, authenticated, service_role;

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
  v_role app.user_role;
  v_before jsonb;
begin
  if not app.is_admin() then
    raise exception 'V5 administrator access is required';
  end if;

  begin
    v_role := p_access_role::app.user_role;
  exception
    when invalid_text_representation then
      raise exception 'Unknown V5 access role: %', p_access_role;
  end;

  if not exists (select 1 from auth.users u where u.id = p_user_id) then
    raise exception 'Auth user % does not exist', p_user_id;
  end if;

  if p_user_id = v_actor and (v_role <> 'admin' or not p_is_active) then
    raise exception 'An administrator cannot demote or disable their own account';
  end if;

  select jsonb_build_object(
    'access_role', ua.access_role,
    'all_cabinets', ua.all_cabinets,
    'is_active', ua.is_active
  )
  into v_before
  from app.user_access ua
  where ua.user_id = p_user_id;

  insert into app.user_access (
    user_id,
    access_role,
    all_cabinets,
    is_active,
    created_by
  )
  values (p_user_id, v_role, p_all_cabinets, p_is_active, v_actor)
  on conflict (user_id) do update
  set access_role = excluded.access_role,
      all_cabinets = excluded.all_cabinets,
      is_active = excluded.is_active,
      created_by = v_actor;

  if p_all_cabinets then
    delete from app.user_cabinet_access where user_id = p_user_id;
  end if;

  insert into app.access_audit (
    event_type,
    actor_user_id,
    target_user_id,
    details
  )
  values (
    'user_access_changed',
    v_actor,
    p_user_id,
    jsonb_build_object(
      'before', v_before,
      'after', jsonb_build_object(
        'access_role', v_role,
        'all_cabinets', p_all_cabinets,
        'is_active', p_is_active
      )
    )
  );

  return jsonb_build_object(
    'user_id', p_user_id,
    'access_role', v_role,
    'all_cabinets', p_all_cabinets,
    'is_active', p_is_active
  );
end
$$;

revoke all on function public.v5_admin_set_user_access(uuid, text, boolean, boolean) from public, anon;
grant execute on function public.v5_admin_set_user_access(uuid, text, boolean, boolean) to authenticated;

create or replace function public.v5_admin_set_cabinet_access(
  p_user_id uuid,
  p_cabinet_id uuid,
  p_allowed boolean
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
begin
  if not app.is_admin() then
    raise exception 'V5 administrator access is required';
  end if;

  if not exists (
    select 1
    from app.user_access ua
    where ua.user_id = p_user_id
      and ua.is_active
  ) then
    raise exception 'Active V5 access for user % does not exist', p_user_id;
  end if;

  if not exists (select 1 from core.cabinets c where c.id = p_cabinet_id) then
    raise exception 'Cabinet % does not exist', p_cabinet_id;
  end if;

  if p_allowed then
    insert into app.user_cabinet_access (user_id, cabinet_id, created_by)
    values (p_user_id, p_cabinet_id, v_actor)
    on conflict (user_id, cabinet_id) do nothing;
  else
    delete from app.user_cabinet_access
    where user_id = p_user_id
      and cabinet_id = p_cabinet_id;
  end if;

  insert into app.access_audit (
    event_type,
    actor_user_id,
    target_user_id,
    details
  )
  values (
    'cabinet_access_changed',
    v_actor,
    p_user_id,
    jsonb_build_object('cabinet_id', p_cabinet_id, 'allowed', p_allowed)
  );

  return jsonb_build_object(
    'user_id', p_user_id,
    'cabinet_id', p_cabinet_id,
    'allowed', p_allowed
  );
end
$$;

revoke all on function public.v5_admin_set_cabinet_access(uuid, uuid, boolean) from public, anon;
grant execute on function public.v5_admin_set_cabinet_access(uuid, uuid, boolean) to authenticated;

create or replace function public.v5_health()
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select jsonb_build_object(
    'environment', 'analytics-v5',
    'schema_version', '20260906001000',
    'status', 'ok'
  )
$$;

revoke all on function public.v5_health() from public;
grant execute on function public.v5_health() to anon, authenticated;

comment on table app.access_audit is 'Immutable audit trail for V5 role and cabinet-access changes.';
comment on function app.bootstrap_first_admin(uuid) is 'Database-owner-only, one-time bootstrap of the first active V5 administrator.';

commit;
