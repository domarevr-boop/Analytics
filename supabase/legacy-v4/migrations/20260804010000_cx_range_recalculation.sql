alter table public.cx_analysis_runs
  add column if not exists source_dictionary_version_id uuid references public.cx_dictionary_versions(id) on delete restrict,
  add column if not exists changed_topic_ids uuid[] not null default '{}'::uuid[],
  add column if not exists analysis_scope text not null default 'full'
    check (analysis_scope in ('full', 'range')),
  add column if not exists review_date_from date,
  add column if not exists review_date_to date;

create index if not exists cx_analysis_runs_scope_dates_idx
  on public.cx_analysis_runs (analysis_scope, review_date_from, review_date_to, started_at desc);

create or replace function public.start_cx_range_analysis(p_date_from date, p_date_to date)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  version_row public.cx_dictionary_versions%rowtype;
  existing_run public.cx_analysis_runs%rowtype;
  run_row public.cx_analysis_runs%rowtype;
  snapshot_at timestamptz := now();
  total_count integer;
begin
  if not public.is_admin() then raise exception 'Admin access required'; end if;
  if p_date_from is null or p_date_to is null or p_date_from > p_date_to then
    raise exception 'Select a valid recalculation period';
  end if;

  select * into version_row
  from public.cx_dictionary_versions
  where status = 'published' and analysis_status = 'completed'
  order by published_at desc nulls last limit 1;
  if version_row.id is null then raise exception 'Published dictionary not found'; end if;

  select * into existing_run from public.cx_analysis_runs
  where dictionary_version_id = version_row.id and status = 'processing'
  order by started_at desc limit 1;
  if existing_run.id is not null then
    if existing_run.analysis_scope = 'range'
      and existing_run.review_date_from = p_date_from
      and existing_run.review_date_to = p_date_to then
      return to_jsonb(existing_run);
    end if;
    raise exception 'Another analysis run is already in progress';
  end if;

  if exists (
    select 1 from public.reviews
    where review_date between p_date_from and p_date_to
      and nullif(normalized_text, '') is not null
      and nullif(lemmatized_text, '') is null
  ) then raise exception 'Prepare lemmas for the selected period before recalculation'; end if;

  select count(*)::integer into total_count
  from public.reviews
  where review_date between p_date_from and p_date_to
    and nullif(normalized_text, '') is not null
    and created_at <= snapshot_at;

  insert into public.cx_analysis_runs (
    dictionary_version_id, source_dictionary_version_id, changed_topic_ids,
    total_reviews, started_at, sentiment_model_version_id, aggregation_model_version_id,
    analysis_scope, review_date_from, review_date_to
  ) values (
    version_row.id, null, '{}'::uuid[], total_count, snapshot_at,
    version_row.sentiment_model_version_id, version_row.aggregation_model_version_id,
    'range', p_date_from, p_date_to
  ) returning * into run_row;

  return to_jsonb(run_row);
end;
$$;

create or replace function public.process_cx_analysis_batch(p_run_id uuid, p_limit integer default 250)
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
      and (run_row.review_date_from is null or reviews.review_date >= run_row.review_date_from)
      and (run_row.review_date_to is null or reviews.review_date <= run_row.review_date_to)
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

  if run_row.analysis_scope = 'range' then
    delete from public.cx_review_topic_matches
    where dictionary_version_id = run_row.dictionary_version_id and review_id = any(candidate_ids);
    delete from public.cx_review_analysis
    where dictionary_version_id = run_row.dictionary_version_id and review_id = any(candidate_ids);
  end if;

  with evaluated as (
    select reviews.id as review_id, reviews.lemmatized_text, rules.topic_id, rules.id as rule_id,
      rules.rule_type, rules.pattern, rules.normalized_pattern, rules.rule_config,
      rules.sentiment as sentiment_override,
      public.cx_rule_matches(
        rules.rule_type, rules.normalized_pattern, rules.rule_config,
        reviews.normalized_text, reviews.lemmatized_text
      ) as is_match
    from public.reviews as reviews cross join public.cx_topic_rules as rules
    where reviews.id = any(candidate_ids)
      and rules.dictionary_version_id = run_row.dictionary_version_id and rules.is_active
      and (
        run_row.analysis_scope = 'range'
        or rules.topic_id = any(run_row.changed_topic_ids)
        or run_row.source_dictionary_version_id is null
        or not exists (
          select 1 from public.cx_review_analysis as source_analysis
          where source_analysis.dictionary_version_id = run_row.source_dictionary_version_id
            and source_analysis.review_id = reviews.id
        )
      )
  ), grouped as (
    select evaluated.review_id, evaluated.lemmatized_text, evaluated.topic_id,
      jsonb_agg(jsonb_build_object(
        'id', evaluated.rule_id, 'type', evaluated.rule_type, 'pattern', evaluated.pattern
      ) order by evaluated.rule_id) filter (
        where evaluated.is_match and evaluated.rule_type <> 'exclusion'
      ) as matches,
      count(*) filter (
        where evaluated.is_match and evaluated.rule_type <> 'exclusion'
      )::integer as match_count,
      array_agg(distinct anchors.term) filter (
        where evaluated.is_match and evaluated.rule_type <> 'exclusion' and anchors.term <> ''
      ) as anchor_terms,
      max(evaluated.sentiment_override) filter (
        where evaluated.is_match and evaluated.rule_type <> 'exclusion'
          and evaluated.sentiment_override is not null
      ) as sentiment_override,
      bool_or(evaluated.is_match and evaluated.rule_type = 'exclusion') as excluded
    from evaluated left join lateral (
      select value as term from jsonb_array_elements_text(
        case when evaluated.rule_type = 'context'
          then coalesce(evaluated.rule_config->'required', '[]'::jsonb)
          else to_jsonb(regexp_split_to_array(evaluated.normalized_pattern, '\s+')) end
      )
    ) as anchors on true
    group by evaluated.review_id, evaluated.lemmatized_text, evaluated.topic_id
  ), classified as (
    select grouped.*, coalesce(grouped.sentiment_override, automatic.sentiment) as calculated_sentiment
    from grouped cross join lateral public.cx_context_sentiment_versioned(
      grouped.lemmatized_text, grouped.anchor_terms, 6, run_row.sentiment_model_version_id
    ) as automatic
    where grouped.match_count > 0 and not grouped.excluded
  )
  insert into public.cx_review_topic_matches (
    review_id, dictionary_version_id, analysis_run_id, topic_id, matched_rules, match_count,
    confidence, sentiment, positive_matches, neutral_matches, negative_matches,
    sentiment_model_version_id
  )
  select classified.review_id, run_row.dictionary_version_id, run_row.id, classified.topic_id,
    classified.matches, classified.match_count, 1, classified.calculated_sentiment,
    case when classified.calculated_sentiment = 'positive' then 1 else 0 end,
    case when classified.calculated_sentiment = 'neutral' then 1 else 0 end,
    case when classified.calculated_sentiment = 'negative' then 1 else 0 end,
    run_row.sentiment_model_version_id
  from classified
  on conflict (review_id, dictionary_version_id, topic_id) do update set
    analysis_run_id = excluded.analysis_run_id,
    matched_rules = excluded.matched_rules,
    match_count = excluded.match_count,
    confidence = excluded.confidence,
    sentiment = excluded.sentiment,
    positive_matches = excluded.positive_matches,
    neutral_matches = excluded.neutral_matches,
    negative_matches = excluded.negative_matches,
    sentiment_model_version_id = excluded.sentiment_model_version_id,
    created_at = now();

  insert into public.cx_review_analysis (
    review_id, dictionary_version_id, analysis_run_id, matched_topic_count
  )
  select reviews.id, run_row.dictionary_version_id, run_row.id,
    (select count(*)::integer from public.cx_review_topic_matches as matches
      where matches.review_id = reviews.id
        and matches.dictionary_version_id = run_row.dictionary_version_id)
  from public.reviews as reviews where reviews.id = any(candidate_ids)
  on conflict (review_id, dictionary_version_id) do update set
    analysis_run_id = excluded.analysis_run_id,
    matched_topic_count = excluded.matched_topic_count,
    analyzed_at = now();

  select count(*)::integer into batch_matched
  from public.cx_review_analysis
  where dictionary_version_id = run_row.dictionary_version_id
    and review_id = any(candidate_ids) and matched_topic_count > 0;

  update public.cx_analysis_runs set
    processed_reviews = processed_reviews + batch_count,
    matched_reviews = matched_reviews + batch_matched,
    cursor_created_at = last_created_at,
    cursor_review_id = last_review_id
  where id = run_row.id returning * into run_row;
  return to_jsonb(run_row);
end;
$$;

create or replace function public.finalize_cx_range_analysis(p_run_id uuid)
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
  if run_row.analysis_scope <> 'range' then raise exception 'Analysis run is not range-scoped'; end if;
  if run_row.status = 'completed' then return to_jsonb(run_row); end if;
  if run_row.status <> 'processing' then raise exception 'Analysis run is not active'; end if;

  select count(*)::integer into analyzed_count
  from public.cx_review_analysis where analysis_run_id = run_row.id;
  if analyzed_count <> run_row.total_reviews or run_row.processed_reviews <> run_row.total_reviews then
    raise exception 'Range verification failed: expected %, analyzed %, processed %',
      run_row.total_reviews, analyzed_count, run_row.processed_reviews;
  end if;

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
declare
  run_row public.cx_analysis_runs%rowtype;
begin
  if not public.is_admin() then raise exception 'Admin access required'; end if;
  update public.cx_analysis_runs
  set status = 'failed', completed_at = now(), error_message = left(coalesce(p_error, 'Cancelled'), 2000)
  where id = p_run_id and status = 'processing'
  returning * into run_row;
  if run_row.id is null then return false; end if;

  if run_row.analysis_scope = 'full' then
    update public.cx_dictionary_versions
    set analysis_status = 'failed', analysis_error = left(coalesce(p_error, 'Cancelled'), 2000)
    where id = run_row.dictionary_version_id;
  end if;
  return true;
end;
$$;

revoke all on function public.start_cx_range_analysis(date, date) from public;
revoke all on function public.finalize_cx_range_analysis(uuid) from public;
grant execute on function public.start_cx_range_analysis(date, date) to authenticated;
grant execute on function public.finalize_cx_range_analysis(uuid) to authenticated;
