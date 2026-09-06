create table if not exists public.cx_analysis_runs (
  id uuid primary key default gen_random_uuid(),
  dictionary_version_id uuid not null references public.cx_dictionary_versions(id) on delete restrict,
  status text not null default 'processing' check (status in ('processing', 'completed', 'failed')),
  total_reviews integer not null default 0,
  processed_reviews integer not null default 0,
  matched_reviews integer not null default 0,
  cursor_created_at timestamptz,
  cursor_review_id uuid,
  started_by uuid default auth.uid(),
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  error_message text
);

create unique index if not exists cx_analysis_one_processing_idx
  on public.cx_analysis_runs (dictionary_version_id) where status = 'processing';

create table if not exists public.cx_review_analysis (
  review_id uuid not null references public.reviews(id) on delete cascade,
  dictionary_version_id uuid not null references public.cx_dictionary_versions(id) on delete restrict,
  analysis_run_id uuid not null references public.cx_analysis_runs(id) on delete cascade,
  matched_topic_count integer not null default 0,
  analyzed_at timestamptz not null default now(),
  primary key (review_id, dictionary_version_id)
);

create table if not exists public.cx_review_topic_matches (
  review_id uuid not null references public.reviews(id) on delete cascade,
  dictionary_version_id uuid not null references public.cx_dictionary_versions(id) on delete restrict,
  analysis_run_id uuid not null references public.cx_analysis_runs(id) on delete cascade,
  topic_id uuid not null references public.cx_topics(id) on delete restrict,
  matched_rules jsonb not null default '[]'::jsonb,
  match_count integer not null default 0,
  confidence numeric(5,4) not null default 1,
  created_at timestamptz not null default now(),
  primary key (review_id, dictionary_version_id, topic_id)
);

create index if not exists cx_review_analysis_version_idx
  on public.cx_review_analysis (dictionary_version_id, analyzed_at);
create index if not exists cx_review_topic_matches_version_topic_idx
  on public.cx_review_topic_matches (dictionary_version_id, topic_id, review_id);
create index if not exists cx_review_topic_matches_review_idx
  on public.cx_review_topic_matches (review_id, dictionary_version_id);

alter table public.cx_analysis_runs enable row level security;
alter table public.cx_review_analysis enable row level security;
alter table public.cx_review_topic_matches enable row level security;

drop policy if exists cx_analysis_runs_admin_select on public.cx_analysis_runs;
create policy cx_analysis_runs_admin_select on public.cx_analysis_runs
  for select to authenticated using (public.is_admin());
drop policy if exists cx_review_analysis_admin_select on public.cx_review_analysis;
create policy cx_review_analysis_admin_select on public.cx_review_analysis
  for select to authenticated using (public.is_admin());
drop policy if exists cx_review_topic_matches_admin_select on public.cx_review_topic_matches;
create policy cx_review_topic_matches_admin_select on public.cx_review_topic_matches
  for select to authenticated using (public.is_admin());

revoke insert, update, delete on public.cx_analysis_runs from authenticated;
revoke insert, update, delete on public.cx_review_analysis from authenticated;
revoke insert, update, delete on public.cx_review_topic_matches from authenticated;
grant select on public.cx_analysis_runs, public.cx_review_analysis, public.cx_review_topic_matches to authenticated;

create or replace function public.cx_rule_matches(
  p_rule_type text,
  p_pattern text,
  p_rule_config jsonb,
  p_cleaned_text text,
  p_lemmatized_text text
)
returns boolean
language plpgsql
stable
set search_path = public
as $$
declare
  cleaned text := lower(coalesce(p_cleaned_text, ''));
  lemmatized text := lower(coalesce(p_lemmatized_text, ''));
  cleaned_tokens text[] := regexp_split_to_array(lower(coalesce(p_cleaned_text, '')), '\s+');
  lemma_tokens text[] := regexp_split_to_array(lower(coalesce(p_lemmatized_text, '')), '\s+');
begin
  return case p_rule_type
    when 'exact_keyword' then array_position(cleaned_tokens, p_pattern) is not null
    when 'exact_phrase' then position(p_pattern in cleaned) > 0
    when 'lemma' then array_position(lemma_tokens, p_pattern) is not null
    when 'lemma_phrase' then position(p_pattern in lemmatized) > 0
    when 'context' then public.cx_context_rule_matches(lemma_tokens, coalesce(p_rule_config, '{}'::jsonb))
    when 'regex' then cleaned ~ p_pattern
    when 'exclusion' then position(p_pattern in cleaned) > 0
    else false
  end;
exception when invalid_regular_expression then
  raise exception 'Invalid regular expression: %', p_pattern;
end;
$$;

create or replace function public.cx_prevent_analysis_mutation()
returns trigger
language plpgsql
set search_path = public
as $$
declare version_id uuid;
begin
  version_id := case when tg_op = 'DELETE' then old.dictionary_version_id else new.dictionary_version_id end;
  if exists (
    select 1 from public.cx_dictionary_versions
    where id = version_id and analysis_status in ('queued', 'processing')
  ) then
    raise exception 'Dictionary is locked while analysis is running';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

drop trigger if exists cx_topic_rules_analysis_lock on public.cx_topic_rules;
create trigger cx_topic_rules_analysis_lock before insert or update or delete on public.cx_topic_rules
  for each row execute function public.cx_prevent_analysis_mutation();
drop trigger if exists cx_topic_revisions_analysis_lock on public.cx_topic_revisions;
create trigger cx_topic_revisions_analysis_lock before insert or update or delete on public.cx_topic_revisions
  for each row execute function public.cx_prevent_analysis_mutation();
drop trigger if exists cx_methodology_analysis_lock on public.cx_methodology_versions;
create trigger cx_methodology_analysis_lock before insert or update or delete on public.cx_methodology_versions
  for each row execute function public.cx_prevent_analysis_mutation();

create or replace function public.start_cx_dictionary_publication()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  draft_id uuid;
  snapshot_at timestamptz := now();
  existing_run public.cx_analysis_runs%rowtype;
  run_row public.cx_analysis_runs%rowtype;
  total_count integer;
begin
  if not public.is_admin() then raise exception 'Admin access required'; end if;
  select id into draft_id from public.cx_dictionary_versions where status = 'draft' limit 1;
  if draft_id is null then raise exception 'Draft dictionary not found'; end if;

  select * into existing_run from public.cx_analysis_runs
  where dictionary_version_id = draft_id and status = 'processing' limit 1;
  if existing_run.id is not null then
    return to_jsonb(existing_run);
  end if;

  if not exists (
    select 1 from public.cx_topic_rules
    where dictionary_version_id = draft_id and is_active and rule_type <> 'exclusion'
  ) then raise exception 'Add at least one active classification rule'; end if;

  if exists (select 1 from public.reviews where nullif(lemmatized_text, '') is null) then
    raise exception 'Prepare lemmas before publishing the dictionary';
  end if;

  select count(*)::integer into total_count
  from public.reviews
  where nullif(normalized_text, '') is not null and created_at <= snapshot_at;

  delete from public.cx_review_topic_matches where dictionary_version_id = draft_id;
  delete from public.cx_review_analysis where dictionary_version_id = draft_id;

  insert into public.cx_analysis_runs (dictionary_version_id, total_reviews, started_at)
  values (draft_id, total_count, snapshot_at) returning * into run_row;

  update public.cx_dictionary_versions
  set analysis_status = 'processing', analysis_error = null
  where id = draft_id;

  return to_jsonb(run_row);
end;
$$;

create or replace function public.process_cx_analysis_batch(
  p_run_id uuid,
  p_limit integer default 250
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  run_row public.cx_analysis_runs%rowtype;
  candidate_ids uuid[];
  batch_count integer := 0;
  batch_matched integer := 0;
  last_created_at timestamptz;
  last_review_id uuid;
begin
  if not public.is_admin() then raise exception 'Admin access required'; end if;
  select * into run_row from public.cx_analysis_runs where id = p_run_id for update;
  if run_row.id is null then raise exception 'Analysis run not found'; end if;
  if run_row.status <> 'processing' then return to_jsonb(run_row); end if;

  select array_agg(source.id order by source.created_at, source.id), count(*)::integer
  into candidate_ids, batch_count
  from (
    select reviews.id, reviews.created_at
    from public.reviews as reviews
    where nullif(reviews.normalized_text, '') is not null
      and reviews.created_at <= run_row.started_at
      and (
        run_row.cursor_created_at is null
        or (reviews.created_at, reviews.id) > (run_row.cursor_created_at, run_row.cursor_review_id)
      )
    order by reviews.created_at, reviews.id
    limit least(greatest(coalesce(p_limit, 250), 1), 500)
  ) as source;

  if batch_count = 0 then return to_jsonb(run_row); end if;

  select reviews.created_at, reviews.id into last_created_at, last_review_id
  from public.reviews as reviews where reviews.id = any(candidate_ids)
  order by reviews.created_at desc, reviews.id desc limit 1;

  with evaluated as (
    select reviews.id as review_id, rules.topic_id, rules.id as rule_id, rules.rule_type, rules.pattern,
      public.cx_rule_matches(
        rules.rule_type, rules.normalized_pattern, rules.rule_config,
        reviews.normalized_text, reviews.lemmatized_text
      ) as is_match
    from public.reviews as reviews
    cross join public.cx_topic_rules as rules
    where reviews.id = any(candidate_ids)
      and rules.dictionary_version_id = run_row.dictionary_version_id
      and rules.is_active
  ), grouped as (
    select evaluated.review_id, evaluated.topic_id,
      jsonb_agg(jsonb_build_object(
        'id', evaluated.rule_id, 'type', evaluated.rule_type, 'pattern', evaluated.pattern
      ) order by evaluated.rule_id) filter (
        where evaluated.is_match and evaluated.rule_type <> 'exclusion'
      ) as matches,
      count(*) filter (where evaluated.is_match and evaluated.rule_type <> 'exclusion')::integer as match_count,
      bool_or(evaluated.is_match and evaluated.rule_type = 'exclusion') as excluded
    from evaluated group by evaluated.review_id, evaluated.topic_id
  )
  insert into public.cx_review_topic_matches (
    review_id, dictionary_version_id, analysis_run_id, topic_id, matched_rules, match_count, confidence
  )
  select grouped.review_id, run_row.dictionary_version_id, run_row.id, grouped.topic_id,
    grouped.matches, grouped.match_count, 1
  from grouped
  where grouped.match_count > 0 and not grouped.excluded
  on conflict (review_id, dictionary_version_id, topic_id) do update
    set analysis_run_id = excluded.analysis_run_id, matched_rules = excluded.matched_rules,
        match_count = excluded.match_count, confidence = excluded.confidence, created_at = now();

  insert into public.cx_review_analysis (
    review_id, dictionary_version_id, analysis_run_id, matched_topic_count
  )
  select reviews.id, run_row.dictionary_version_id, run_row.id,
    (select count(*)::integer from public.cx_review_topic_matches as matches
      where matches.review_id = reviews.id and matches.dictionary_version_id = run_row.dictionary_version_id)
  from public.reviews as reviews where reviews.id = any(candidate_ids)
  on conflict (review_id, dictionary_version_id) do update
    set analysis_run_id = excluded.analysis_run_id,
        matched_topic_count = excluded.matched_topic_count,
        analyzed_at = now();

  select count(*)::integer into batch_matched
  from public.cx_review_analysis
  where dictionary_version_id = run_row.dictionary_version_id
    and review_id = any(candidate_ids) and matched_topic_count > 0;

  update public.cx_analysis_runs
  set processed_reviews = processed_reviews + batch_count,
      matched_reviews = matched_reviews + batch_matched,
      cursor_created_at = last_created_at,
      cursor_review_id = last_review_id
  where id = run_row.id returning * into run_row;

  return to_jsonb(run_row);
end;
$$;

create or replace function public.finalize_cx_dictionary_publication(p_run_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  run_row public.cx_analysis_runs%rowtype;
  analyzed_count integer;
begin
  if not public.is_admin() then raise exception 'Admin access required'; end if;
  select * into run_row from public.cx_analysis_runs where id = p_run_id for update;
  if run_row.id is null then raise exception 'Analysis run not found'; end if;
  if run_row.status = 'completed' then return to_jsonb(run_row); end if;
  if run_row.status <> 'processing' then raise exception 'Analysis run is not active'; end if;

  select count(*)::integer into analyzed_count
  from public.cx_review_analysis where dictionary_version_id = run_row.dictionary_version_id;
  if analyzed_count <> run_row.total_reviews or run_row.processed_reviews <> run_row.total_reviews then
    raise exception 'Analysis verification failed: expected %, analyzed %, processed %',
      run_row.total_reviews, analyzed_count, run_row.processed_reviews;
  end if;

  update public.cx_dictionary_versions
  set status = 'archived'
  where status = 'published' and id <> run_row.dictionary_version_id;
  update public.cx_dictionary_versions
  set status = 'published', published_at = now(), analysis_status = 'completed', analysis_error = null
  where id = run_row.dictionary_version_id and status = 'draft';
  if not found then raise exception 'Draft dictionary changed before publication'; end if;

  update public.cx_analysis_runs
  set status = 'completed', completed_at = now(), error_message = null
  where id = run_row.id returning * into run_row;
  return to_jsonb(run_row);
end;
$$;

create or replace function public.fail_cx_analysis_run(p_run_id uuid, p_error text default null)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare version_id uuid;
begin
  if not public.is_admin() then raise exception 'Admin access required'; end if;
  update public.cx_analysis_runs
  set status = 'failed', completed_at = now(), error_message = left(coalesce(p_error, 'Cancelled'), 2000)
  where id = p_run_id and status = 'processing'
  returning dictionary_version_id into version_id;
  if version_id is null then return false; end if;
  update public.cx_dictionary_versions
  set analysis_status = 'failed', analysis_error = left(coalesce(p_error, 'Cancelled'), 2000)
  where id = version_id;
  return true;
end;
$$;

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
    'methodologies', coalesce((select jsonb_agg(to_jsonb(methodologies)) from public.cx_methodology_versions as methodologies), '[]'::jsonb),
    'analysis_runs', coalesce((select jsonb_agg(to_jsonb(runs) order by runs.started_at desc) from (
      select * from public.cx_analysis_runs order by started_at desc limit 10
    ) as runs), '[]'::jsonb)
  ) end;
$$;

revoke all on function public.cx_rule_matches(text, text, jsonb, text, text) from public;
revoke all on function public.start_cx_dictionary_publication() from public;
revoke all on function public.process_cx_analysis_batch(uuid, integer) from public;
revoke all on function public.finalize_cx_dictionary_publication(uuid) from public;
revoke all on function public.fail_cx_analysis_run(uuid, text) from public;
grant execute on function public.start_cx_dictionary_publication() to authenticated;
grant execute on function public.process_cx_analysis_batch(uuid, integer) to authenticated;
grant execute on function public.finalize_cx_dictionary_publication(uuid) to authenticated;
grant execute on function public.fail_cx_analysis_run(uuid, text) to authenticated;
