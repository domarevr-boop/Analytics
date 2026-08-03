alter table public.cx_analysis_runs
  add column if not exists source_dictionary_version_id uuid references public.cx_dictionary_versions(id) on delete restrict,
  add column if not exists changed_topic_ids uuid[] not null default '{}'::uuid[];

create or replace function public.cx_context_sentiment_versioned(
  p_lemmatized_text text,
  p_anchor_terms text[] default null,
  p_window integer default 6,
  p_model_version_id uuid default null
)
returns table (sentiment text, sentiment_score integer, positive_hits integer, negative_hits integer)
language sql
stable
set search_path = public
as $$
  with model as (
    select coalesce(p_model_version_id, (select id from public.cx_sentiment_model_versions where is_active limit 1)) as id
  ), token_rows as materialized (
    select token, position::integer
    from unnest(regexp_split_to_array(lower(btrim(coalesce(p_lemmatized_text, ''))), '\s+'))
      with ordinality as source(token, position)
    where token <> ''
  ), anchor_rows as materialized (
    select tokens.position from token_rows as tokens
    where coalesce(array_length(p_anchor_terms, 1), 0) > 0 and tokens.token = any(p_anchor_terms)
  ), scored as (
    select case when exists (
      select 1 from token_rows as previous
      where previous.position between tokens.position - 3 and tokens.position - 1
        and previous.token in ('не', 'ни', 'нет', 'без')
    ) then -lexicon.score else lexicon.score end as contribution
    from token_rows as tokens cross join model
    join public.cx_sentiment_model_lexicon as lexicon
      on lexicon.sentiment_model_version_id = model.id and lexicon.lemma = tokens.token and lexicon.is_active
    where not exists (select 1 from anchor_rows)
      or exists (select 1 from anchor_rows as anchors where abs(tokens.position - anchors.position) <= greatest(coalesce(p_window, 6), 1))
  ), totals as (
    select coalesce(sum(contribution), 0)::integer as score,
      count(*) filter (where contribution > 0)::integer as positives,
      count(*) filter (where contribution < 0)::integer as negatives
    from scored
  )
  select case when totals.score > 0 then 'positive' when totals.score < 0 then 'negative' else 'neutral' end,
    totals.score, totals.positives, totals.negatives
  from totals;
$$;

create or replace function public.start_cx_dictionary_publication()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  draft_id uuid;
  source_id uuid;
  snapshot_at timestamptz := now();
  existing_run public.cx_analysis_runs%rowtype;
  run_row public.cx_analysis_runs%rowtype;
  total_count integer;
  changed_ids uuid[] := '{}'::uuid[];
  sentiment_version uuid;
  aggregation_version uuid;
begin
  if not public.is_admin() then raise exception 'Admin access required'; end if;
  select id, sentiment_model_version_id, aggregation_model_version_id
  into draft_id, sentiment_version, aggregation_version
  from public.cx_dictionary_versions where status = 'draft' limit 1;
  if draft_id is null then raise exception 'Draft dictionary not found'; end if;

  select * into existing_run from public.cx_analysis_runs
  where dictionary_version_id = draft_id and status = 'processing' limit 1;
  if existing_run.id is not null then return to_jsonb(existing_run); end if;

  if not exists (select 1 from public.cx_topic_rules where dictionary_version_id = draft_id and is_active and rule_type <> 'exclusion')
    then raise exception 'Add at least one active classification rule'; end if;
  if exists (select 1 from public.reviews where nullif(lemmatized_text, '') is null)
    then raise exception 'Prepare lemmas before publishing the dictionary'; end if;

  select id into source_id from public.cx_dictionary_versions where status = 'published' and analysis_status = 'completed' limit 1;
  select count(*)::integer into total_count from public.reviews
  where nullif(normalized_text, '') is not null and created_at <= snapshot_at;

  with draft_fingerprints as (
    select revisions.topic_id, md5(coalesce(string_agg(concat_ws('|', rules.rule_type, rules.normalized_pattern,
      rules.rule_config::text, coalesce(rules.sentiment, ''), rules.priority::text, rules.is_active::text), E'\n' order by rules.id), '')) as fingerprint
    from public.cx_topic_revisions as revisions
    left join public.cx_topic_rules as rules on rules.dictionary_version_id = revisions.dictionary_version_id and rules.topic_id = revisions.topic_id
    where revisions.dictionary_version_id = draft_id and revisions.is_active group by revisions.topic_id
  ), source_fingerprints as (
    select revisions.topic_id, md5(coalesce(string_agg(concat_ws('|', rules.rule_type, rules.normalized_pattern,
      rules.rule_config::text, coalesce(rules.sentiment, ''), rules.priority::text, rules.is_active::text), E'\n' order by rules.id), '')) as fingerprint
    from public.cx_topic_revisions as revisions
    left join public.cx_topic_rules as rules on rules.dictionary_version_id = revisions.dictionary_version_id and rules.topic_id = revisions.topic_id
    where revisions.dictionary_version_id = source_id and revisions.is_active group by revisions.topic_id
  )
  select coalesce(array_agg(draft.topic_id order by draft.topic_id) filter (
    where source_id is null or source.topic_id is null or draft.fingerprint is distinct from source.fingerprint
  ), '{}'::uuid[]) into changed_ids
  from draft_fingerprints as draft left join source_fingerprints as source using (topic_id);

  delete from public.cx_review_topic_matches where dictionary_version_id = draft_id;
  delete from public.cx_review_analysis where dictionary_version_id = draft_id;

  insert into public.cx_analysis_runs (
    dictionary_version_id, source_dictionary_version_id, changed_topic_ids, total_reviews, started_at,
    sentiment_model_version_id, aggregation_model_version_id
  ) values (draft_id, source_id, changed_ids, total_count, snapshot_at, sentiment_version, aggregation_version)
  returning * into run_row;

  if source_id is not null then
    insert into public.cx_review_topic_matches (
      review_id, dictionary_version_id, analysis_run_id, topic_id, matched_rules, match_count, confidence,
      sentiment, positive_matches, neutral_matches, negative_matches, sentiment_model_version_id, created_at
    )
    select matches.review_id, draft_id, run_row.id, matches.topic_id, matches.matched_rules, matches.match_count, matches.confidence,
      matches.sentiment, matches.positive_matches, matches.neutral_matches, matches.negative_matches,
      matches.sentiment_model_version_id, matches.created_at
    from public.cx_review_topic_matches as matches
    where matches.dictionary_version_id = source_id and not (matches.topic_id = any(changed_ids));
  end if;

  update public.cx_dictionary_versions set analysis_status = 'processing', analysis_error = null,
    sentiment_model_version_id = sentiment_version, aggregation_model_version_id = aggregation_version
  where id = draft_id;
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

  select array_agg(source.id order by source.created_at, source.id), count(*)::integer into candidate_ids, batch_count
  from (select reviews.id, reviews.created_at from public.reviews as reviews
    where nullif(reviews.normalized_text, '') is not null and reviews.created_at <= run_row.started_at
      and (run_row.cursor_created_at is null or (reviews.created_at, reviews.id) > (run_row.cursor_created_at, run_row.cursor_review_id))
    order by reviews.created_at, reviews.id limit least(greatest(coalesce(p_limit, 250), 1), 500)) as source;
  if batch_count = 0 then return to_jsonb(run_row); end if;

  select reviews.created_at, reviews.id into last_created_at, last_review_id
  from public.reviews as reviews where reviews.id = any(candidate_ids)
  order by reviews.created_at desc, reviews.id desc limit 1;

  with evaluated as (
    select reviews.id as review_id, reviews.lemmatized_text, rules.topic_id, rules.id as rule_id,
      rules.rule_type, rules.pattern, rules.normalized_pattern, rules.rule_config, rules.sentiment as sentiment_override,
      public.cx_rule_matches(rules.rule_type, rules.normalized_pattern, rules.rule_config, reviews.normalized_text, reviews.lemmatized_text) as is_match
    from public.reviews as reviews cross join public.cx_topic_rules as rules
    where reviews.id = any(candidate_ids) and rules.dictionary_version_id = run_row.dictionary_version_id and rules.is_active
      and (rules.topic_id = any(run_row.changed_topic_ids) or run_row.source_dictionary_version_id is null
        or not exists (select 1 from public.cx_review_analysis as source_analysis
          where source_analysis.dictionary_version_id = run_row.source_dictionary_version_id and source_analysis.review_id = reviews.id))
  ), grouped as (
    select evaluated.review_id, evaluated.lemmatized_text, evaluated.topic_id,
      jsonb_agg(jsonb_build_object('id', evaluated.rule_id, 'type', evaluated.rule_type, 'pattern', evaluated.pattern)
        order by evaluated.rule_id) filter (where evaluated.is_match and evaluated.rule_type <> 'exclusion') as matches,
      count(*) filter (where evaluated.is_match and evaluated.rule_type <> 'exclusion')::integer as match_count,
      array_agg(distinct anchors.term) filter (where evaluated.is_match and evaluated.rule_type <> 'exclusion' and anchors.term <> '') as anchor_terms,
      max(evaluated.sentiment_override) filter (where evaluated.is_match and evaluated.rule_type <> 'exclusion' and evaluated.sentiment_override is not null) as sentiment_override,
      bool_or(evaluated.is_match and evaluated.rule_type = 'exclusion') as excluded
    from evaluated left join lateral (
      select value as term from jsonb_array_elements_text(case when evaluated.rule_type = 'context'
        then coalesce(evaluated.rule_config->'required', '[]'::jsonb)
        else to_jsonb(regexp_split_to_array(evaluated.normalized_pattern, '\s+')) end)
    ) as anchors on true
    group by evaluated.review_id, evaluated.lemmatized_text, evaluated.topic_id
  ), classified as (
    select grouped.*, coalesce(grouped.sentiment_override, automatic.sentiment) as calculated_sentiment
    from grouped cross join lateral public.cx_context_sentiment_versioned(
      grouped.lemmatized_text, grouped.anchor_terms, 6, run_row.sentiment_model_version_id
    ) as automatic where grouped.match_count > 0 and not grouped.excluded
  )
  insert into public.cx_review_topic_matches (
    review_id, dictionary_version_id, analysis_run_id, topic_id, matched_rules, match_count, confidence,
    sentiment, positive_matches, neutral_matches, negative_matches, sentiment_model_version_id
  )
  select classified.review_id, run_row.dictionary_version_id, run_row.id, classified.topic_id,
    classified.matches, classified.match_count, 1, classified.calculated_sentiment,
    case when classified.calculated_sentiment = 'positive' then 1 else 0 end,
    case when classified.calculated_sentiment = 'neutral' then 1 else 0 end,
    case when classified.calculated_sentiment = 'negative' then 1 else 0 end,
    run_row.sentiment_model_version_id
  from classified on conflict (review_id, dictionary_version_id, topic_id) do update set
    analysis_run_id = excluded.analysis_run_id, matched_rules = excluded.matched_rules, match_count = excluded.match_count,
    confidence = excluded.confidence, sentiment = excluded.sentiment, positive_matches = excluded.positive_matches,
    neutral_matches = excluded.neutral_matches, negative_matches = excluded.negative_matches,
    sentiment_model_version_id = excluded.sentiment_model_version_id, created_at = now();

  insert into public.cx_review_analysis (review_id, dictionary_version_id, analysis_run_id, matched_topic_count)
  select reviews.id, run_row.dictionary_version_id, run_row.id,
    (select count(*)::integer from public.cx_review_topic_matches as matches
      where matches.review_id = reviews.id and matches.dictionary_version_id = run_row.dictionary_version_id)
  from public.reviews as reviews where reviews.id = any(candidate_ids)
  on conflict (review_id, dictionary_version_id) do update set analysis_run_id = excluded.analysis_run_id,
    matched_topic_count = excluded.matched_topic_count, analyzed_at = now();

  select count(*)::integer into batch_matched from public.cx_review_analysis
  where dictionary_version_id = run_row.dictionary_version_id and review_id = any(candidate_ids) and matched_topic_count > 0;
  update public.cx_analysis_runs set processed_reviews = processed_reviews + batch_count,
    matched_reviews = matched_reviews + batch_matched, cursor_created_at = last_created_at, cursor_review_id = last_review_id
  where id = run_row.id returning * into run_row;
  return to_jsonb(run_row);
end;
$$;

revoke all on function public.cx_context_sentiment_versioned(text, text[], integer, uuid) from public;
grant execute on function public.cx_context_sentiment_versioned(text, text[], integer, uuid) to authenticated;
