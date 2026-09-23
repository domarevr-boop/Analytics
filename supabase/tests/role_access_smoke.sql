begin;

do $$
declare
  v_user_id uuid;
begin
  select access.user_id into strict v_user_id
  from app.user_access access
  where access.access_role = 'admin' and access.is_active
  order by access.user_id
  limit 1;

  insert into core.cabinets (external_key, name)
  values
    ('__v5_full_access_a__', 'V5 full access A'),
    ('__v5_full_access_b__', 'V5 full access B')
  on conflict (external_key) do update set name = excluded.name;

  perform set_config('request.jwt.claim.sub', v_user_id::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
end
$$;

set local role authenticated;

do $$
begin
  if app.current_access_role() is distinct from 'admin'::app.user_role
    or not app.can_read()
    or not app.can_import()
    or not app.is_admin()
    or (select count(*) from core.cabinets where external_key like '__v5_full_access_%__') <> 2
    or exists (
      select 1 from core.cabinets cabinet
      where cabinet.external_key like '__v5_full_access_%__'
        and not app.can_access_cabinet(cabinet.id)
    )
  then
    raise exception 'Full-access V5 user smoke assertion failed';
  end if;
end
$$;

insert into ingest.import_batches (
  source_code, cabinet_id, created_by, idempotency_key,
  file_sha256, source_schema_version
)
select 'market_dynamics', cabinet.id, auth.uid(),
  '__v5_full_access_smoke__', repeat('a', 64), 1
from core.cabinets cabinet
where cabinet.external_key = '__v5_full_access_a__';

do $$
begin
  if not exists (
    select 1 from ingest.import_batches batch
    where batch.idempotency_key = '__v5_full_access_smoke__'
      and app.can_read_batch(batch.id)
  ) then
    raise exception 'Full-access V5 user could not import and read a batch';
  end if;
end
$$;

rollback;

begin;

do $$
declare
  v_user_id uuid;
begin
  select access.user_id into strict v_user_id
  from app.user_access access
  where access.access_role = 'admin' and access.is_active
  order by access.user_id
  limit 1;

  update app.user_access set is_active = false where user_id = v_user_id;
  perform set_config('request.jwt.claim.sub', v_user_id::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
end
$$;

set local role authenticated;

do $$
begin
  if app.current_access_role() is not null
    or app.can_read()
    or app.can_import()
    or app.is_admin()
    or exists (select 1 from core.cabinets)
    or exists (select 1 from ingest.import_batches)
  then
    raise exception 'Inactive V5 account unexpectedly retained access';
  end if;
end
$$;

rollback;
