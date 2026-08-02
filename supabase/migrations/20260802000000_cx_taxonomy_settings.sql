create table if not exists public.cx_topic_groups (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.cx_topics (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.cx_topic_groups(id) on delete restrict,
  parent_topic_id uuid references public.cx_topics(id) on delete restrict,
  code text not null unique,
  name text not null,
  description text not null default '',
  sort_order integer not null default 0,
  is_active boolean not null default true,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.cx_dictionary_versions (
  id uuid primary key default gen_random_uuid(),
  version_number integer not null unique,
  status text not null check (status in ('draft', 'published', 'archived')),
  description text not null default '',
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  published_at timestamptz,
  analysis_status text not null default 'not_started' check (analysis_status in ('not_started', 'queued', 'processing', 'completed', 'failed')),
  analysis_error text
);

create unique index if not exists cx_dictionary_one_draft_idx
  on public.cx_dictionary_versions (status) where status = 'draft';
create unique index if not exists cx_dictionary_one_published_idx
  on public.cx_dictionary_versions (status) where status = 'published';

create table if not exists public.cx_topic_rules (
  id uuid primary key default gen_random_uuid(),
  topic_id uuid not null references public.cx_topics(id) on delete restrict,
  dictionary_version_id uuid not null references public.cx_dictionary_versions(id) on delete restrict,
  rule_type text not null check (rule_type in ('keyword', 'phrase', 'regex', 'exclusion')),
  pattern text not null,
  normalized_pattern text not null,
  is_case_sensitive boolean not null default false,
  priority integer not null default 100,
  is_active boolean not null default true,
  comment text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (dictionary_version_id, topic_id, rule_type, normalized_pattern)
);

create table if not exists public.cx_topic_revisions (
  id uuid primary key default gen_random_uuid(),
  topic_id uuid not null references public.cx_topics(id) on delete restrict,
  dictionary_version_id uuid not null references public.cx_dictionary_versions(id) on delete restrict,
  group_id uuid not null references public.cx_topic_groups(id) on delete restrict,
  name text not null,
  description text not null default '',
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (topic_id, dictionary_version_id)
);

create table if not exists public.cx_methodology_versions (
  id uuid primary key default gen_random_uuid(),
  dictionary_version_id uuid not null unique references public.cx_dictionary_versions(id) on delete restrict,
  config jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists cx_topics_group_idx on public.cx_topics (group_id, sort_order);
create index if not exists cx_topic_rules_version_topic_idx on public.cx_topic_rules (dictionary_version_id, topic_id, priority);
create index if not exists cx_topic_revisions_version_idx on public.cx_topic_revisions (dictionary_version_id, group_id);

alter table public.cx_topic_groups enable row level security;
alter table public.cx_topics enable row level security;
alter table public.cx_dictionary_versions enable row level security;
alter table public.cx_topic_rules enable row level security;
alter table public.cx_topic_revisions enable row level security;
alter table public.cx_methodology_versions enable row level security;

drop policy if exists cx_topic_groups_admin_select on public.cx_topic_groups;
create policy cx_topic_groups_admin_select on public.cx_topic_groups for select to authenticated using (public.is_admin());
drop policy if exists cx_topics_admin_select on public.cx_topics;
create policy cx_topics_admin_select on public.cx_topics for select to authenticated using (public.is_admin());
drop policy if exists cx_dictionary_versions_admin_select on public.cx_dictionary_versions;
create policy cx_dictionary_versions_admin_select on public.cx_dictionary_versions for select to authenticated using (public.is_admin());
drop policy if exists cx_topic_rules_admin_select on public.cx_topic_rules;
create policy cx_topic_rules_admin_select on public.cx_topic_rules for select to authenticated using (public.is_admin());
drop policy if exists cx_topic_revisions_admin_select on public.cx_topic_revisions;
create policy cx_topic_revisions_admin_select on public.cx_topic_revisions for select to authenticated using (public.is_admin());
drop policy if exists cx_methodology_versions_admin_select on public.cx_methodology_versions;
create policy cx_methodology_versions_admin_select on public.cx_methodology_versions for select to authenticated using (public.is_admin());

revoke insert, update, delete on public.cx_topic_groups from authenticated;
revoke insert, update, delete on public.cx_topics from authenticated;
revoke insert, update, delete on public.cx_dictionary_versions from authenticated;
revoke insert, update, delete on public.cx_topic_rules from authenticated;
revoke insert, update, delete on public.cx_topic_revisions from authenticated;
revoke insert, update, delete on public.cx_methodology_versions from authenticated;
grant select on public.cx_topic_groups, public.cx_topics, public.cx_dictionary_versions, public.cx_topic_rules, public.cx_topic_revisions, public.cx_methodology_versions to authenticated;

insert into public.cx_topic_groups (code, name, sort_order) values
  ('product', 'Продукт', 10),
  ('service', 'Сервис', 20),
  ('outcomes', 'Результат опыта', 30)
on conflict (code) do update set name = excluded.name, sort_order = excluded.sort_order;

insert into public.cx_topics (group_id, code, name, sort_order)
select groups.id, seed.code, seed.name, seed.sort_order
from (values
  ('product', 'brightness', 'Яркость', 10),
  ('product', 'design', 'Дизайн', 20),
  ('product', 'functionality', 'Функциональность', 30),
  ('product', 'assembly', 'Сборка и установка', 40),
  ('product', 'size_fit', 'Размер и соответствие помещению', 50),
  ('product', 'quality', 'Качество и надёжность', 60),
  ('service', 'delivery', 'Доставка', 10),
  ('service', 'packaging', 'Упаковка', 20),
  ('service', 'support', 'Поддержка', 30),
  ('service', 'completeness', 'Комплектация', 40),
  ('service', 'return_replace', 'Возврат и замена', 50),
  ('outcomes', 'expectations', 'Соответствие ожиданиям', 10),
  ('outcomes', 'trust', 'Доверие', 20),
  ('outcomes', 'satisfaction', 'Общая удовлетворённость', 30),
  ('outcomes', 'recommendation', 'Рекомендательное поведение', 40),
  ('outcomes', 'repurchase', 'Намерение повторной покупки', 50)
) as seed(group_code, code, name, sort_order)
join public.cx_topic_groups as groups on groups.code = seed.group_code
on conflict (code) do update set name = excluded.name, sort_order = excluded.sort_order;

insert into public.cx_dictionary_versions (version_number, status, description, published_at, analysis_status)
values (1, 'published', 'Базовая таксономия без правил', now(), 'not_started')
on conflict (version_number) do nothing;

insert into public.cx_methodology_versions (dictionary_version_id, config)
select versions.id, jsonb_build_object(
  'confident_mentions_threshold', 30,
  'minimum_mentions', 5,
  'minimum_confidence', 0.65,
  'problem_index', jsonb_build_object(
    'exposure_threshold', 0.15,
    'exposure_weight', 0.40,
    'negativity_weight', 0.35,
    'acceleration_weight', 0.15,
    'confidence_weight', 0.10
  ),
  'risk_thresholds', jsonb_build_object('medium', 45, 'high', 70)
)
from public.cx_dictionary_versions as versions
where versions.version_number = 1
on conflict (dictionary_version_id) do nothing;

insert into public.cx_topic_revisions (topic_id, dictionary_version_id, group_id, name, description, is_active)
select topics.id, versions.id, topics.group_id, topics.name, topics.description, topics.is_active
from public.cx_topics as topics
cross join public.cx_dictionary_versions as versions
where versions.version_number = 1
on conflict (topic_id, dictionary_version_id) do nothing;

create or replace function public.get_cx_analysis_settings()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select case when not public.is_admin() then null else jsonb_build_object(
    'groups', coalesce((select jsonb_agg(to_jsonb(groups) order by groups.sort_order) from public.cx_topic_groups as groups), '[]'::jsonb),
    'topics', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', topics.id, 'group_id', coalesce(revisions.group_id, topics.group_id), 'parent_topic_id', topics.parent_topic_id,
        'code', topics.code, 'name', coalesce(revisions.name, topics.name),
        'description', coalesce(revisions.description, topics.description), 'sort_order', topics.sort_order,
        'is_active', coalesce(revisions.is_active, topics.is_active)
      ) order by topics.sort_order)
      from public.cx_topics as topics
      left join public.cx_topic_revisions as revisions on revisions.topic_id = topics.id
        and revisions.dictionary_version_id = coalesce(
          (select id from public.cx_dictionary_versions where status = 'draft' limit 1),
          (select id from public.cx_dictionary_versions where status = 'published' limit 1)
        )
    ), '[]'::jsonb),
    'versions', coalesce((select jsonb_agg(to_jsonb(versions) order by versions.version_number desc) from public.cx_dictionary_versions as versions), '[]'::jsonb),
    'rules', coalesce((select jsonb_agg(to_jsonb(rules) order by rules.priority, rules.created_at) from public.cx_topic_rules as rules), '[]'::jsonb),
    'methodologies', coalesce((select jsonb_agg(to_jsonb(methodologies)) from public.cx_methodology_versions as methodologies), '[]'::jsonb)
  ) end;
$$;

create or replace function public.create_cx_dictionary_draft(p_description text default '')
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  existing_draft uuid;
  published_version public.cx_dictionary_versions%rowtype;
  draft_id uuid;
begin
  if not public.is_admin() then raise exception 'Admin access required'; end if;
  select id into existing_draft from public.cx_dictionary_versions where status = 'draft' limit 1;
  if existing_draft is not null then return existing_draft; end if;
  select * into published_version from public.cx_dictionary_versions where status = 'published' limit 1;
  insert into public.cx_dictionary_versions (version_number, status, description)
  values ((select coalesce(max(version_number), 0) + 1 from public.cx_dictionary_versions), 'draft', coalesce(p_description, ''))
  returning id into draft_id;
  if published_version.id is not null then
    insert into public.cx_topic_rules (topic_id, dictionary_version_id, rule_type, pattern, normalized_pattern, is_case_sensitive, priority, is_active, comment)
    select topic_id, draft_id, rule_type, pattern, normalized_pattern, is_case_sensitive, priority, is_active, comment
    from public.cx_topic_rules where dictionary_version_id = published_version.id;
    insert into public.cx_topic_revisions (topic_id, dictionary_version_id, group_id, name, description, is_active)
    select topic_id, draft_id, group_id, name, description, is_active
    from public.cx_topic_revisions where dictionary_version_id = published_version.id;
    insert into public.cx_methodology_versions (dictionary_version_id, config)
    select draft_id, config from public.cx_methodology_versions where dictionary_version_id = published_version.id;
  else
    insert into public.cx_methodology_versions (dictionary_version_id, config) values (draft_id, '{}'::jsonb);
  end if;
  return draft_id;
end;
$$;

create or replace function public.save_cx_topic(
  p_id uuid,
  p_group_id uuid,
  p_name text,
  p_description text default '',
  p_is_active boolean default true
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  result_id uuid;
  generated_code text;
  draft_id uuid;
begin
  if not public.is_admin() then raise exception 'Admin access required'; end if;
  select id into draft_id from public.cx_dictionary_versions where status = 'draft' limit 1;
  if draft_id is null then
    raise exception 'Create a draft before editing taxonomy';
  end if;
  if btrim(coalesce(p_name, '')) = '' then raise exception 'Topic name is required'; end if;
  if p_id is null then
    generated_code := 'custom_' || replace(gen_random_uuid()::text, '-', '');
    insert into public.cx_topics (group_id, code, name, description, sort_order, is_active)
    values (p_group_id, generated_code, btrim(p_name), coalesce(p_description, ''), 1000, coalesce(p_is_active, true))
    returning id into result_id;
  else
    update public.cx_topics set updated_at = now()
    where id = p_id returning id into result_id;
  end if;
  insert into public.cx_topic_revisions (topic_id, dictionary_version_id, group_id, name, description, is_active)
  values (result_id, draft_id, p_group_id, btrim(p_name), coalesce(p_description, ''), coalesce(p_is_active, true))
  on conflict (topic_id, dictionary_version_id) do update set group_id = excluded.group_id, name = excluded.name,
    description = excluded.description, is_active = excluded.is_active, updated_at = now();
  return result_id;
end;
$$;

create or replace function public.save_cx_topic_rule(
  p_id uuid,
  p_topic_id uuid,
  p_rule_type text,
  p_pattern text,
  p_priority integer default 100,
  p_is_active boolean default true,
  p_comment text default ''
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  draft_id uuid;
  result_id uuid;
begin
  if not public.is_admin() then raise exception 'Admin access required'; end if;
  select id into draft_id from public.cx_dictionary_versions where status = 'draft' limit 1;
  if draft_id is null then raise exception 'Create a draft before editing rules'; end if;
  if p_rule_type not in ('keyword', 'phrase', 'regex', 'exclusion') then raise exception 'Unsupported rule type'; end if;
  if btrim(coalesce(p_pattern, '')) = '' then raise exception 'Pattern is required'; end if;
  if p_id is null then
    insert into public.cx_topic_rules (topic_id, dictionary_version_id, rule_type, pattern, normalized_pattern, priority, is_active, comment)
    values (p_topic_id, draft_id, p_rule_type, btrim(p_pattern), lower(btrim(p_pattern)), coalesce(p_priority, 100), coalesce(p_is_active, true), coalesce(p_comment, ''))
    returning id into result_id;
  else
    update public.cx_topic_rules set topic_id = p_topic_id, rule_type = p_rule_type, pattern = btrim(p_pattern),
      normalized_pattern = lower(btrim(p_pattern)), priority = coalesce(p_priority, 100), is_active = coalesce(p_is_active, true),
      comment = coalesce(p_comment, ''), updated_at = now()
    where id = p_id and dictionary_version_id = draft_id returning id into result_id;
  end if;
  return result_id;
end;
$$;

create or replace function public.delete_cx_topic_rule(p_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare deleted_count integer;
begin
  if not public.is_admin() then raise exception 'Admin access required'; end if;
  delete from public.cx_topic_rules
  where id = p_id and dictionary_version_id in (select id from public.cx_dictionary_versions where status = 'draft');
  get diagnostics deleted_count = row_count;
  return deleted_count > 0;
end;
$$;

create or replace function public.save_cx_methodology(p_config jsonb)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare draft_id uuid;
begin
  if not public.is_admin() then raise exception 'Admin access required'; end if;
  select id into draft_id from public.cx_dictionary_versions where status = 'draft' limit 1;
  if draft_id is null then raise exception 'Create a draft before editing methodology'; end if;
  insert into public.cx_methodology_versions (dictionary_version_id, config) values (draft_id, coalesce(p_config, '{}'::jsonb))
  on conflict (dictionary_version_id) do update set config = excluded.config, updated_at = now();
  return true;
end;
$$;

create or replace function public.test_cx_dictionary_rules(p_text text)
returns table (
  topic_id uuid,
  topic_name text,
  group_name text,
  matched_rules jsonb,
  excluded boolean
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare draft_id uuid;
begin
  if not public.is_admin() then raise exception 'Admin access required'; end if;
  select id into draft_id from public.cx_dictionary_versions where status = 'draft' limit 1;
  if draft_id is null then select id into draft_id from public.cx_dictionary_versions where status = 'published' limit 1; end if;
  return query
  with evaluated as (
    select rules.topic_id, rules.id, rules.rule_type, rules.pattern,
      case
        when rules.rule_type = 'regex' then lower(coalesce(p_text, '')) ~ rules.pattern
        else lower(coalesce(p_text, '')) like '%' || rules.normalized_pattern || '%'
      end as is_match
    from public.cx_topic_rules as rules
    where rules.dictionary_version_id = draft_id and rules.is_active
  ), grouped as (
    select evaluated.topic_id,
      jsonb_agg(jsonb_build_object('id', evaluated.id, 'type', evaluated.rule_type, 'pattern', evaluated.pattern))
        filter (where evaluated.is_match and evaluated.rule_type <> 'exclusion') as matches,
      bool_or(evaluated.is_match and evaluated.rule_type = 'exclusion') as has_exclusion
    from evaluated group by evaluated.topic_id
  )
  select topics.id, topics.name, groups.name, coalesce(grouped.matches, '[]'::jsonb), coalesce(grouped.has_exclusion, false)
  from grouped
  join public.cx_topics as topics on topics.id = grouped.topic_id
  join public.cx_topic_groups as groups on groups.id = topics.group_id
  where grouped.matches is not null or grouped.has_exclusion
  order by groups.sort_order, topics.sort_order;
exception when invalid_regular_expression then
  raise exception 'Invalid regular expression in draft dictionary';
end;
$$;

revoke all on function public.get_cx_analysis_settings() from public;
revoke all on function public.create_cx_dictionary_draft(text) from public;
revoke all on function public.save_cx_topic(uuid, uuid, text, text, boolean) from public;
revoke all on function public.save_cx_topic_rule(uuid, uuid, text, text, integer, boolean, text) from public;
revoke all on function public.delete_cx_topic_rule(uuid) from public;
revoke all on function public.save_cx_methodology(jsonb) from public;
revoke all on function public.test_cx_dictionary_rules(text) from public;
grant execute on function public.get_cx_analysis_settings() to authenticated;
grant execute on function public.create_cx_dictionary_draft(text) to authenticated;
grant execute on function public.save_cx_topic(uuid, uuid, text, text, boolean) to authenticated;
grant execute on function public.save_cx_topic_rule(uuid, uuid, text, text, integer, boolean, text) to authenticated;
grant execute on function public.delete_cx_topic_rule(uuid) to authenticated;
grant execute on function public.save_cx_methodology(jsonb) to authenticated;
grant execute on function public.test_cx_dictionary_rules(text) to authenticated;
