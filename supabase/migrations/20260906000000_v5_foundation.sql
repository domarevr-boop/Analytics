-- Analytics V5 clean backend foundation.
-- This migration is intentionally independent from supabase/legacy-v4.

begin;

create extension if not exists pgcrypto with schema extensions;

create schema if not exists app;
create schema if not exists ingest;
create schema if not exists core;
create schema if not exists analytics;

revoke all on schema app, ingest, core, analytics from public, anon, authenticated;
grant usage on schema app, ingest, core, analytics to authenticated;

do $$
begin
  if not exists (
    select 1
    from pg_type t
    join pg_namespace n on n.oid = t.typnamespace
    where n.nspname = 'app' and t.typname = 'user_role'
  ) then
    create type app.user_role as enum ('viewer', 'importer', 'admin');
  end if;

  if not exists (
    select 1
    from pg_type t
    join pg_namespace n on n.oid = t.typnamespace
    where n.nspname = 'ingest' and t.typname = 'batch_status'
  ) then
    create type ingest.batch_status as enum (
      'created',
      'uploaded',
      'validating',
      'validated',
      'publishing',
      'published',
      'failed',
      'cancelled'
    );
  end if;
end
$$;

create or replace function app.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = timezone('utc', now());
  return new;
end;
$$;

revoke all on function app.set_updated_at() from public, anon, authenticated;

create table core.cabinets (
  id uuid primary key default gen_random_uuid(),
  external_key text not null unique,
  name text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint cabinets_external_key_not_blank check (btrim(external_key) <> ''),
  constraint cabinets_name_not_blank check (btrim(name) <> '')
);

create trigger core_cabinets_set_updated_at
before update on core.cabinets
for each row execute function app.set_updated_at();

create table app.user_access (
  user_id uuid primary key references auth.users(id) on delete cascade,
  access_role app.user_role not null default 'viewer',
  all_cabinets boolean not null default false,
  is_active boolean not null default true,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create trigger app_user_access_set_updated_at
before update on app.user_access
for each row execute function app.set_updated_at();

create table app.user_cabinet_access (
  user_id uuid not null references app.user_access(user_id) on delete cascade,
  cabinet_id uuid not null references core.cabinets(id) on delete cascade,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  primary key (user_id, cabinet_id)
);

create or replace function app.current_access_role()
returns app.user_role
language sql
stable
security definer
set search_path = ''
as $$
  select ua.access_role
  from app.user_access ua
  where ua.user_id = auth.uid()
    and ua.is_active
  limit 1
$$;

create or replace function app.can_read()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select app.current_access_role() is not null
$$;

create or replace function app.can_import()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(app.current_access_role() in ('importer', 'admin'), false)
$$;

create or replace function app.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(app.current_access_role() = 'admin', false)
$$;

create or replace function app.can_access_cabinet(p_cabinet_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    exists (
      select 1
      from app.user_access ua
      where ua.user_id = auth.uid()
        and ua.is_active
        and (
          ua.access_role = 'admin'
          or ua.all_cabinets
          or exists (
            select 1
            from app.user_cabinet_access uca
            where uca.user_id = ua.user_id
              and uca.cabinet_id = p_cabinet_id
          )
        )
    ),
    false
  )
$$;

revoke all on function app.current_access_role() from public, anon;
revoke all on function app.can_read() from public, anon;
revoke all on function app.can_import() from public, anon;
revoke all on function app.is_admin() from public, anon;
revoke all on function app.can_access_cabinet(uuid) from public, anon;
grant execute on function app.current_access_role() to authenticated;
grant execute on function app.can_read() to authenticated;
grant execute on function app.can_import() to authenticated;
grant execute on function app.is_admin() to authenticated;
grant execute on function app.can_access_cabinet(uuid) to authenticated;

create table ingest.sources (
  code text primary key,
  display_name text not null,
  schema_version integer not null default 1,
  description text,
  is_active boolean not null default true,
  retention_days integer,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint sources_code_format check (code ~ '^[a-z][a-z0-9_]*$'),
  constraint sources_schema_version_positive check (schema_version > 0),
  constraint sources_retention_positive check (retention_days is null or retention_days > 0)
);

create trigger ingest_sources_set_updated_at
before update on ingest.sources
for each row execute function app.set_updated_at();

insert into ingest.sources (code, display_name, description)
values
  ('wb_funnel', 'Воронка WB', 'Продажи и этапы воронки по товарам'),
  ('xway', 'XWay', 'Рекламные показатели'),
  ('profitability', 'Рентабельность', 'Финансовые показатели по товарам'),
  ('geography', 'География заказов', 'Заказы по территориям и типам логистики'),
  ('entry_points', 'Точки входа', 'Источники трафика и заказы'),
  ('search_queries', 'Поисковые запросы', 'Поисковый спрос и конверсии'),
  ('niche_dynamics', 'Динамика ниши (legacy)', 'Исторический источник, не использовать для новых связей'),
  ('market_dynamics', 'Рынок', 'Ежедневные показатели рынка и нашей доли'),
  ('competitors', 'Конкуренты', 'Многолистовой конкурентный срез'),
  ('reviews', 'Отзывы', 'Отзывы покупателей и CX-анализ'),
  ('plan_template', 'План', 'Месячные плановые значения'),
  ('group_history', 'История склеек', 'Датированный состав групп товаров')
on conflict (code) do update
set display_name = excluded.display_name,
    description = excluded.description,
    updated_at = timezone('utc', now());

create table ingest.import_batches (
  id uuid primary key default gen_random_uuid(),
  source_code text not null references ingest.sources(code),
  cabinet_id uuid references core.cabinets(id),
  created_by uuid not null references auth.users(id),
  status ingest.batch_status not null default 'created',
  idempotency_key text,
  file_sha256 text not null,
  source_schema_version integer not null,
  period_start date,
  period_end date,
  input_rows integer not null default 0,
  accepted_rows integer not null default 0,
  rejected_rows integer not null default 0,
  metadata jsonb not null default '{}'::jsonb,
  error_summary text,
  attempt_count integer not null default 1,
  created_at timestamptz not null default timezone('utc', now()),
  uploaded_at timestamptz,
  validated_at timestamptz,
  published_at timestamptz,
  finished_at timestamptz,
  updated_at timestamptz not null default timezone('utc', now()),
  constraint import_batches_hash_format check (file_sha256 ~ '^[0-9a-f]{64}$'),
  constraint import_batches_schema_version_positive check (source_schema_version > 0),
  constraint import_batches_period_order check (period_end is null or period_start is null or period_end >= period_start),
  constraint import_batches_counts_nonnegative check (input_rows >= 0 and accepted_rows >= 0 and rejected_rows >= 0),
  constraint import_batches_counts_fit_input check (accepted_rows + rejected_rows <= input_rows),
  constraint import_batches_attempt_positive check (attempt_count > 0),
  constraint import_batches_idempotency_not_blank check (idempotency_key is null or btrim(idempotency_key) <> '')
);

create unique index import_batches_source_file_uq
on ingest.import_batches (
  source_code,
  coalesce(cabinet_id, '00000000-0000-0000-0000-000000000000'::uuid),
  file_sha256
);

create unique index import_batches_idempotency_uq
on ingest.import_batches (created_by, source_code, idempotency_key)
where idempotency_key is not null;

create index import_batches_status_created_idx
on ingest.import_batches (status, created_at desc);

create index import_batches_source_period_idx
on ingest.import_batches (source_code, period_start, period_end);

create trigger ingest_import_batches_set_updated_at
before update on ingest.import_batches
for each row execute function app.set_updated_at();

create table ingest.import_files (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references ingest.import_batches(id) on delete restrict,
  bucket_id text not null default 'v5-import-sources',
  object_path text not null,
  original_filename text not null,
  content_type text,
  size_bytes bigint not null,
  file_sha256 text not null,
  created_at timestamptz not null default timezone('utc', now()),
  unique (batch_id, object_path),
  constraint import_files_object_path_not_blank check (btrim(object_path) <> ''),
  constraint import_files_filename_not_blank check (btrim(original_filename) <> ''),
  constraint import_files_size_nonnegative check (size_bytes >= 0),
  constraint import_files_hash_format check (file_sha256 ~ '^[0-9a-f]{64}$')
);

create index import_files_sha_idx on ingest.import_files (file_sha256);

create table ingest.import_rows (
  batch_id uuid not null references ingest.import_batches(id) on delete cascade,
  sheet_name text not null default '',
  row_number integer not null,
  row_hash text not null,
  payload jsonb not null,
  accepted boolean,
  created_at timestamptz not null default timezone('utc', now()),
  primary key (batch_id, sheet_name, row_number),
  constraint import_rows_number_positive check (row_number > 0),
  constraint import_rows_hash_format check (row_hash ~ '^[0-9a-f]{64}$'),
  constraint import_rows_payload_object check (jsonb_typeof(payload) = 'object')
);

create index import_rows_batch_accepted_idx
on ingest.import_rows (batch_id, accepted);

create table ingest.import_errors (
  id bigint generated always as identity primary key,
  batch_id uuid not null references ingest.import_batches(id) on delete cascade,
  sheet_name text not null default '',
  row_number integer,
  column_name text,
  error_code text not null,
  message text not null,
  raw_value text,
  created_at timestamptz not null default timezone('utc', now()),
  constraint import_errors_row_positive check (row_number is null or row_number > 0),
  constraint import_errors_code_not_blank check (btrim(error_code) <> ''),
  constraint import_errors_message_not_blank check (btrim(message) <> '')
);

create index import_errors_batch_row_idx
on ingest.import_errors (batch_id, sheet_name, row_number);

create table ingest.import_events (
  id bigint generated always as identity primary key,
  batch_id uuid not null references ingest.import_batches(id) on delete cascade,
  status ingest.batch_status not null,
  message text,
  details jsonb not null default '{}'::jsonb,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default timezone('utc', now())
);

create index import_events_batch_time_idx
on ingest.import_events (batch_id, created_at, id);

create or replace function app.can_read_batch(p_batch_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    exists (
      select 1
      from ingest.import_batches b
      where b.id = p_batch_id
        and app.can_read()
        and (
          b.created_by = auth.uid()
          or app.is_admin()
          or (b.cabinet_id is not null and app.can_access_cabinet(b.cabinet_id))
        )
    ),
    false
  )
$$;

revoke all on function app.can_read_batch(uuid) from public, anon;
grant execute on function app.can_read_batch(uuid) to authenticated;

create table analytics.metric_definitions (
  id uuid primary key default gen_random_uuid(),
  code text not null,
  name text not null,
  description text not null,
  unit text not null,
  grain text not null,
  formula_version integer not null,
  formula text not null,
  source_fields jsonb not null default '[]'::jsonb,
  supported_filters jsonb not null default '[]'::jsonb,
  limitations text,
  owner text,
  valid_from date not null,
  valid_to date,
  is_active boolean not null default true,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (code, formula_version),
  constraint metric_definitions_code_format check (code ~ '^[a-z][a-z0-9_]*$'),
  constraint metric_definitions_formula_version_positive check (formula_version > 0),
  constraint metric_definitions_validity check (valid_to is null or valid_to >= valid_from),
  constraint metric_definitions_sources_array check (jsonb_typeof(source_fields) = 'array'),
  constraint metric_definitions_filters_array check (jsonb_typeof(supported_filters) = 'array')
);

create unique index metric_definitions_one_active_version_uq
on analytics.metric_definitions (code)
where is_active;

create trigger analytics_metric_definitions_set_updated_at
before update on analytics.metric_definitions
for each row execute function app.set_updated_at();

alter table core.cabinets enable row level security;
alter table app.user_access enable row level security;
alter table app.user_cabinet_access enable row level security;
alter table ingest.sources enable row level security;
alter table ingest.import_batches enable row level security;
alter table ingest.import_files enable row level security;
alter table ingest.import_rows enable row level security;
alter table ingest.import_errors enable row level security;
alter table ingest.import_events enable row level security;
alter table analytics.metric_definitions enable row level security;

create policy cabinets_read_allowed
on core.cabinets for select to authenticated
using (app.can_access_cabinet(id));

create policy user_access_read_own_or_admin
on app.user_access for select to authenticated
using (user_id = auth.uid() or app.is_admin());

create policy user_cabinet_access_read_own_or_admin
on app.user_cabinet_access for select to authenticated
using (user_id = auth.uid() or app.is_admin());

create policy sources_read_allowed
on ingest.sources for select to authenticated
using (app.can_read());

create policy batches_read_allowed
on ingest.import_batches for select to authenticated
using (app.can_read_batch(id));

create policy batches_create_allowed
on ingest.import_batches for insert to authenticated
with check (
  created_by = auth.uid()
  and app.can_import()
  and (cabinet_id is null or app.can_access_cabinet(cabinet_id))
);

create policy files_read_allowed
on ingest.import_files for select to authenticated
using (app.can_read_batch(batch_id));

create policy rows_read_allowed
on ingest.import_rows for select to authenticated
using (app.can_read_batch(batch_id));

create policy errors_read_allowed
on ingest.import_errors for select to authenticated
using (app.can_read_batch(batch_id));

create policy events_read_allowed
on ingest.import_events for select to authenticated
using (app.can_read_batch(batch_id));

create policy metric_definitions_read_allowed
on analytics.metric_definitions for select to authenticated
using (app.can_read());

grant select on core.cabinets to authenticated;
grant select on app.user_access, app.user_cabinet_access to authenticated;
grant select on ingest.sources, ingest.import_batches, ingest.import_files, ingest.import_rows, ingest.import_errors, ingest.import_events to authenticated;
grant insert on ingest.import_batches to authenticated;
grant select on analytics.metric_definitions to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'v5-import-sources',
  'v5-import-sources',
  false,
  52428800,
  array[
    'text/csv',
    'text/plain',
    'application/csv',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  ]
)
on conflict (id) do update
set public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists v5_import_sources_insert_own on storage.objects;
create policy v5_import_sources_insert_own
on storage.objects for insert to authenticated
with check (
  bucket_id = 'v5-import-sources'
  and app.can_import()
  and (storage.foldername(name))[1] = auth.uid()::text
);

drop policy if exists v5_import_sources_read_own_or_admin on storage.objects;
create policy v5_import_sources_read_own_or_admin
on storage.objects for select to authenticated
using (
  bucket_id = 'v5-import-sources'
  and app.can_read()
  and (
    (storage.foldername(name))[1] = auth.uid()::text
    or app.is_admin()
  )
);

create or replace function public.v5_health()
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select jsonb_build_object(
    'environment', 'analytics-v5',
    'schema_version', '20260906000000',
    'status', 'ok'
  )
$$;

revoke all on function public.v5_health() from public;
grant execute on function public.v5_health() to anon, authenticated;

create or replace function public.v5_my_access()
returns table (
  access_role text,
  all_cabinets boolean,
  cabinet_ids uuid[]
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    ua.access_role::text,
    ua.all_cabinets,
    coalesce(
      array_agg(uca.cabinet_id order by uca.cabinet_id) filter (where uca.cabinet_id is not null),
      '{}'::uuid[]
    )
  from app.user_access ua
  left join app.user_cabinet_access uca on uca.user_id = ua.user_id
  where ua.user_id = auth.uid()
    and ua.is_active
  group by ua.user_id, ua.access_role, ua.all_cabinets
$$;

revoke all on function public.v5_my_access() from public, anon;
grant execute on function public.v5_my_access() to authenticated;

comment on schema ingest is 'Immutable source files, import batches, staging rows and validation errors for Analytics V5.';
comment on schema core is 'Canonical dimensions and time-aware master data for Analytics V5.';
comment on schema analytics is 'Versioned metric definitions and server-side analytical contracts for Analytics V5.';
comment on table ingest.import_batches is 'One auditable, idempotent processing attempt for one source file.';
comment on table ingest.import_rows is 'Raw source rows retained with sheet and row lineage before publication.';
comment on table analytics.metric_definitions is 'Versioned methodology catalog; formula migrations are separate from formula changes.';

commit;
