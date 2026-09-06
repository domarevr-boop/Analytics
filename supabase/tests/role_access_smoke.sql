begin;

do $$
declare
  v_user_id uuid;
  v_allowed_cabinet uuid;
begin
  select ua.user_id
  into strict v_user_id
  from app.user_access ua
  where ua.access_role = 'admin'
    and ua.is_active;

  insert into core.cabinets (external_key, name)
  values
    ('__v5_rls_test_allowed__', 'V5 RLS test — allowed'),
    ('__v5_rls_test_denied__', 'V5 RLS test — denied')
  on conflict (external_key) do update set name = excluded.name;

  select c.id
  into strict v_allowed_cabinet
  from core.cabinets c
  where c.external_key = '__v5_rls_test_allowed__';

  update app.user_access
  set access_role = 'viewer',
      all_cabinets = false
  where user_id = v_user_id;

  delete from app.user_cabinet_access where user_id = v_user_id;
  insert into app.user_cabinet_access (user_id, cabinet_id, created_by)
  values (v_user_id, v_allowed_cabinet, v_user_id);

  perform set_config('request.jwt.claim.sub', v_user_id::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
end
$$;

set local role authenticated;

do $$
declare
  v_cabinet_id uuid;
begin
  if app.current_access_role() is distinct from 'viewer'::app.user_role
    or not app.can_read()
    or app.can_import()
    or app.is_admin()
    or (select count(*) from core.cabinets) <> 1
    or not exists (
      select 1 from core.cabinets where external_key = '__v5_rls_test_allowed__'
    )
    or exists (
      select 1 from core.cabinets where external_key = '__v5_rls_test_denied__'
    )
  then
    raise exception 'Viewer RLS smoke assertion failed';
  end if;

  select c.id
  into strict v_cabinet_id
  from core.cabinets c
  where c.external_key = '__v5_rls_test_allowed__';

  begin
    insert into ingest.import_batches (
      source_code,
      cabinet_id,
      created_by,
      idempotency_key,
      file_sha256,
      source_schema_version
    )
    values (
      'market_dynamics',
      v_cabinet_id,
      auth.uid(),
      '__v5_viewer_must_not_import__',
      repeat('b', 64),
      1
    );

    raise exception 'Viewer unexpectedly created an import batch';
  exception
    when insufficient_privilege then null;
  end;
end
$$;

select jsonb_build_object(
  'access_role', app.current_access_role(),
  'can_read', app.can_read(),
  'can_import', app.can_import(),
  'is_admin', app.is_admin(),
  'visible_cabinet_count', (select count(*) from core.cabinets),
  'allowed_cabinet_visible', exists (
    select 1 from core.cabinets where external_key = '__v5_rls_test_allowed__'
  ),
  'denied_cabinet_hidden', not exists (
    select 1 from core.cabinets where external_key = '__v5_rls_test_denied__'
  )
) as viewer_access_smoke;

rollback;

begin;

do $$
declare
  v_user_id uuid;
  v_allowed_cabinet uuid;
begin
  select ua.user_id
  into strict v_user_id
  from app.user_access ua
  where ua.access_role = 'admin'
    and ua.is_active;

  insert into core.cabinets (external_key, name)
  values
    ('__v5_rls_test_allowed__', 'V5 RLS test — allowed'),
    ('__v5_rls_test_denied__', 'V5 RLS test — denied')
  on conflict (external_key) do update set name = excluded.name;

  select c.id
  into strict v_allowed_cabinet
  from core.cabinets c
  where c.external_key = '__v5_rls_test_allowed__';

  update app.user_access
  set access_role = 'importer',
      all_cabinets = false
  where user_id = v_user_id;

  delete from app.user_cabinet_access where user_id = v_user_id;
  insert into app.user_cabinet_access (user_id, cabinet_id, created_by)
  values (v_user_id, v_allowed_cabinet, v_user_id);

  perform set_config('request.jwt.claim.sub', v_user_id::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
end
$$;

set local role authenticated;

insert into ingest.import_batches (
  source_code,
  cabinet_id,
  created_by,
  idempotency_key,
  file_sha256,
  source_schema_version
)
select
  'market_dynamics',
  c.id,
  auth.uid(),
  '__v5_role_smoke__',
  repeat('a', 64),
  1
from core.cabinets c
where c.external_key = '__v5_rls_test_allowed__';

do $$
begin
  if app.current_access_role() is distinct from 'importer'::app.user_role
    or not app.can_read()
    or not app.can_import()
    or app.is_admin()
    or (select count(*) from core.cabinets) <> 1
    or exists (
      select 1 from core.cabinets where external_key = '__v5_rls_test_denied__'
    )
    or not exists (
      select 1
      from ingest.import_batches
      where idempotency_key = '__v5_role_smoke__'
    )
  then
    raise exception 'Importer RLS smoke assertion failed';
  end if;
end
$$;

select jsonb_build_object(
  'access_role', app.current_access_role(),
  'auth_uid_present', auth.uid() is not null,
  'can_read', app.can_read(),
  'can_import', app.can_import(),
  'is_admin', app.is_admin(),
  'visible_cabinet_count', (select count(*) from core.cabinets),
  'allowed_cabinet_access', (
    select app.can_access_cabinet(c.id)
    from core.cabinets c
    where c.external_key = '__v5_rls_test_allowed__'
  ),
  'denied_cabinet_hidden', not exists (
    select 1 from core.cabinets where external_key = '__v5_rls_test_denied__'
  ),
  'allowed_batch_visible', exists (
    select 1
    from ingest.import_batches
    where idempotency_key = '__v5_role_smoke__'
  )
) as importer_access_smoke;

rollback;
