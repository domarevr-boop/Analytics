alter table public.cx_topic_rules
  add column if not exists sentiment text not null default 'neutral';

alter table public.cx_topic_rules drop constraint if exists cx_topic_rules_sentiment_check;
alter table public.cx_topic_rules add constraint cx_topic_rules_sentiment_check
  check (sentiment in ('positive', 'neutral', 'negative'));

alter table public.cx_review_topic_matches
  add column if not exists sentiment text not null default 'neutral',
  add column if not exists positive_matches integer not null default 0,
  add column if not exists neutral_matches integer not null default 0,
  add column if not exists negative_matches integer not null default 0;

alter table public.cx_review_topic_matches drop constraint if exists cx_review_topic_matches_sentiment_check;
alter table public.cx_review_topic_matches add constraint cx_review_topic_matches_sentiment_check
  check (sentiment in ('positive', 'neutral', 'negative'));

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
    insert into public.cx_topic_rules (
      topic_id, dictionary_version_id, rule_type, pattern, normalized_pattern, rule_config,
      sentiment, is_case_sensitive, priority, is_active, comment
    )
    select topic_id, draft_id, rule_type, pattern, normalized_pattern, rule_config,
      sentiment, is_case_sensitive, priority, is_active, comment
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

drop function if exists public.save_cx_topic_rule(uuid, uuid, text, text, jsonb, integer, boolean, text);
create or replace function public.save_cx_topic_rule(
  p_id uuid,
  p_topic_id uuid,
  p_rule_type text,
  p_pattern text,
  p_rule_config jsonb default '{}'::jsonb,
  p_sentiment text default 'neutral',
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
  normalized text;
begin
  if not public.is_admin() then raise exception 'Admin access required'; end if;
  select id into draft_id from public.cx_dictionary_versions where status = 'draft' limit 1;
  if draft_id is null then raise exception 'Create a draft before editing rules'; end if;
  if p_rule_type not in ('exact_keyword', 'exact_phrase', 'lemma', 'lemma_phrase', 'context', 'regex', 'exclusion') then
    raise exception 'Unsupported rule type';
  end if;
  if p_sentiment not in ('positive', 'neutral', 'negative') then raise exception 'Unsupported sentiment'; end if;
  if p_rule_type = 'context' then
    if jsonb_array_length(coalesce(p_rule_config->'required', '[]'::jsonb)) = 0
      or jsonb_array_length(coalesce(p_rule_config->'anyOf', '[]'::jsonb)) = 0 then
      raise exception 'Context rule requires required and anyOf arrays';
    end if;
    normalized := lower(coalesce(nullif(btrim(p_pattern), ''), 'context'));
  else
    if btrim(coalesce(p_pattern, '')) = '' then raise exception 'Pattern is required'; end if;
    normalized := lower(btrim(p_pattern));
  end if;
  if p_id is null then
    insert into public.cx_topic_rules (
      topic_id, dictionary_version_id, rule_type, pattern, normalized_pattern, rule_config,
      sentiment, priority, is_active, comment
    ) values (
      p_topic_id, draft_id, p_rule_type, coalesce(nullif(btrim(p_pattern), ''), 'context'), normalized,
      coalesce(p_rule_config, '{}'::jsonb), p_sentiment, coalesce(p_priority, 100),
      coalesce(p_is_active, true), coalesce(p_comment, '')
    ) returning id into result_id;
  else
    update public.cx_topic_rules set topic_id = p_topic_id, rule_type = p_rule_type,
      pattern = coalesce(nullif(btrim(p_pattern), ''), 'context'), normalized_pattern = normalized,
      rule_config = coalesce(p_rule_config, '{}'::jsonb), sentiment = p_sentiment,
      priority = coalesce(p_priority, 100), is_active = coalesce(p_is_active, true),
      comment = coalesce(p_comment, ''), updated_at = now()
    where id = p_id and dictionary_version_id = draft_id returning id into result_id;
  end if;
  return result_id;
end;
$$;

drop function if exists public.test_cx_dictionary_rules(text, text, text);
create or replace function public.test_cx_dictionary_rules(
  p_text text,
  p_cleaned_text text,
  p_lemmatized_text text
)
returns table (
  topic_id uuid,
  topic_name text,
  group_name text,
  matched_rules jsonb,
  excluded boolean,
  sentiment text
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
  with prepared as (
    select regexp_split_to_array(lower(coalesce(p_cleaned_text, '')), '\s+') as cleaned_tokens,
      regexp_split_to_array(lower(coalesce(p_lemmatized_text, '')), '\s+') as lemma_tokens
  ), evaluated as (
    select rules.topic_id, rules.id, rules.rule_type, rules.pattern, rules.sentiment,
      public.cx_rule_matches(rules.rule_type, rules.normalized_pattern, rules.rule_config, p_cleaned_text, p_lemmatized_text) as is_match
    from public.cx_topic_rules as rules cross join prepared
    where rules.dictionary_version_id = draft_id and rules.is_active
  ), grouped as (
    select evaluated.topic_id,
      jsonb_agg(jsonb_build_object(
        'id', evaluated.id, 'type', evaluated.rule_type, 'pattern', evaluated.pattern, 'sentiment', evaluated.sentiment
      )) filter (where evaluated.is_match and evaluated.rule_type <> 'exclusion') as matches,
      count(*) filter (where evaluated.is_match and evaluated.rule_type <> 'exclusion' and evaluated.sentiment = 'positive') as positive_count,
      count(*) filter (where evaluated.is_match and evaluated.rule_type <> 'exclusion' and evaluated.sentiment = 'negative') as negative_count,
      bool_or(evaluated.is_match and evaluated.rule_type = 'exclusion') as has_exclusion
    from evaluated group by evaluated.topic_id
  )
  select topics.id, revisions.name, groups.name, coalesce(grouped.matches, '[]'::jsonb),
    coalesce(grouped.has_exclusion, false),
    case when grouped.negative_count > grouped.positive_count then 'negative'
      when grouped.positive_count > grouped.negative_count then 'positive' else 'neutral' end
  from grouped
  join public.cx_topics as topics on topics.id = grouped.topic_id
  join public.cx_topic_revisions as revisions on revisions.topic_id = topics.id and revisions.dictionary_version_id = draft_id
  join public.cx_topic_groups as groups on groups.id = revisions.group_id
  where grouped.matches is not null or grouped.has_exclusion
  order by groups.sort_order, topics.sort_order;
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
    select reviews.id, reviews.created_at from public.reviews as reviews
    where nullif(reviews.normalized_text, '') is not null and reviews.created_at <= run_row.started_at
      and (run_row.cursor_created_at is null or (reviews.created_at, reviews.id) > (run_row.cursor_created_at, run_row.cursor_review_id))
    order by reviews.created_at, reviews.id
    limit least(greatest(coalesce(p_limit, 250), 1), 500)
  ) as source;
  if batch_count = 0 then return to_jsonb(run_row); end if;

  select reviews.created_at, reviews.id into last_created_at, last_review_id
  from public.reviews as reviews where reviews.id = any(candidate_ids)
  order by reviews.created_at desc, reviews.id desc limit 1;

  with evaluated as (
    select reviews.id as review_id, rules.topic_id, rules.id as rule_id, rules.rule_type, rules.pattern, rules.sentiment,
      public.cx_rule_matches(rules.rule_type, rules.normalized_pattern, rules.rule_config, reviews.normalized_text, reviews.lemmatized_text) as is_match
    from public.reviews as reviews cross join public.cx_topic_rules as rules
    where reviews.id = any(candidate_ids) and rules.dictionary_version_id = run_row.dictionary_version_id and rules.is_active
  ), grouped as (
    select evaluated.review_id, evaluated.topic_id,
      jsonb_agg(jsonb_build_object(
        'id', evaluated.rule_id, 'type', evaluated.rule_type, 'pattern', evaluated.pattern, 'sentiment', evaluated.sentiment
      ) order by evaluated.rule_id) filter (where evaluated.is_match and evaluated.rule_type <> 'exclusion') as matches,
      count(*) filter (where evaluated.is_match and evaluated.rule_type <> 'exclusion')::integer as match_count,
      count(*) filter (where evaluated.is_match and evaluated.rule_type <> 'exclusion' and evaluated.sentiment = 'positive')::integer as positive_count,
      count(*) filter (where evaluated.is_match and evaluated.rule_type <> 'exclusion' and evaluated.sentiment = 'neutral')::integer as neutral_count,
      count(*) filter (where evaluated.is_match and evaluated.rule_type <> 'exclusion' and evaluated.sentiment = 'negative')::integer as negative_count,
      bool_or(evaluated.is_match and evaluated.rule_type = 'exclusion') as excluded
    from evaluated group by evaluated.review_id, evaluated.topic_id
  )
  insert into public.cx_review_topic_matches (
    review_id, dictionary_version_id, analysis_run_id, topic_id, matched_rules, match_count, confidence,
    sentiment, positive_matches, neutral_matches, negative_matches
  )
  select grouped.review_id, run_row.dictionary_version_id, run_row.id, grouped.topic_id,
    grouped.matches, grouped.match_count, 1,
    case when grouped.negative_count > grouped.positive_count then 'negative'
      when grouped.positive_count > grouped.negative_count then 'positive' else 'neutral' end,
    grouped.positive_count, grouped.neutral_count, grouped.negative_count
  from grouped where grouped.match_count > 0 and not grouped.excluded
  on conflict (review_id, dictionary_version_id, topic_id) do update set
    analysis_run_id = excluded.analysis_run_id, matched_rules = excluded.matched_rules,
    match_count = excluded.match_count, confidence = excluded.confidence, sentiment = excluded.sentiment,
    positive_matches = excluded.positive_matches, neutral_matches = excluded.neutral_matches,
    negative_matches = excluded.negative_matches, created_at = now();

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

create or replace function public.get_cx_topic_dashboard(
  p_date_from date default null,
  p_date_to date default null,
  p_cabinets text[] default null,
  p_product_ids text[] default null,
  p_rating smallint default null,
  p_topic_id uuid default null
)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with published as (
    select id, version_number from public.cx_dictionary_versions
    where status = 'published' and analysis_status = 'completed' limit 1
  ), filtered_reviews as materialized (
    select reviews.* from public.reviews as reviews
    where public.is_admin()
      and (p_date_from is null or reviews.review_date >= p_date_from)
      and (p_date_to is null or reviews.review_date <= p_date_to)
      and (p_cabinets is null or reviews.cabinet_name = any(p_cabinets))
      and (p_product_ids is null or reviews.local_product_id = any(p_product_ids))
      and (p_rating is null or reviews.rating = p_rating)
  ), filtered_matches as materialized (
    select matches.review_id, matches.topic_id, matches.match_count, matches.sentiment, reviews.review_date,
      reviews.local_product_id, reviews.seller_sku, reviews.wb_sku, reviews.product_name, reviews.cabinet_name, reviews.rating
    from public.cx_review_topic_matches as matches join published on published.id = matches.dictionary_version_id
    join filtered_reviews as reviews on reviews.id = matches.review_id
  ), topic_rows as (
    select topics.id, revisions.name, groups.name as group_name, groups.sort_order as group_sort, topics.sort_order,
      count(matches.review_id)::bigint as review_count, coalesce(sum(matches.match_count), 0)::bigint as rule_matches,
      coalesce(avg(matches.rating), 0)::numeric as average_rating,
      coalesce(100.0 * count(matches.review_id) filter (where matches.sentiment = 'negative') / nullif(count(matches.review_id), 0), 0)::numeric as negative_share,
      coalesce(100.0 * count(matches.review_id) filter (where matches.sentiment = 'neutral') / nullif(count(matches.review_id), 0), 0)::numeric as neutral_share,
      coalesce(100.0 * count(matches.review_id) filter (where matches.sentiment = 'positive') / nullif(count(matches.review_id), 0), 0)::numeric as positive_share
    from published join public.cx_topic_revisions as revisions on revisions.dictionary_version_id = published.id and revisions.is_active
    join public.cx_topics as topics on topics.id = revisions.topic_id join public.cx_topic_groups as groups on groups.id = revisions.group_id
    left join filtered_matches as matches on matches.topic_id = topics.id
    group by topics.id, revisions.name, groups.name, groups.sort_order, topics.sort_order
  ), selected_matches as (
    select matches.* from filtered_matches as matches where p_topic_id is null or matches.topic_id = p_topic_id
  ), daily_rows as (
    select review_date, count(*)::bigint as mentions, count(distinct review_id)::bigint as reviews,
      avg(rating)::numeric as average_rating,
      coalesce(100.0 * count(*) filter (where sentiment = 'negative') / nullif(count(*), 0), 0)::numeric as negative_share,
      coalesce(100.0 * count(*) filter (where sentiment = 'neutral') / nullif(count(*), 0), 0)::numeric as neutral_share,
      coalesce(100.0 * count(*) filter (where sentiment = 'positive') / nullif(count(*), 0), 0)::numeric as positive_share
    from selected_matches group by review_date
  ), product_rows as (
    select coalesce(local_product_id, cabinet_name || '|' || coalesce(seller_sku, '') || '|' || coalesce(wb_sku, '')) as entity_key,
      max(local_product_id) as local_product_id, max(seller_sku) as seller_sku, max(wb_sku) as wb_sku,
      max(product_name) as product_name, max(cabinet_name) as cabinet_name, count(*)::bigint as mentions,
      avg(rating)::numeric as average_rating,
      coalesce(100.0 * count(*) filter (where sentiment = 'negative') / nullif(count(*), 0), 0)::numeric as negative_share,
      coalesce(100.0 * count(*) filter (where sentiment = 'positive') / nullif(count(*), 0), 0)::numeric as positive_share
    from selected_matches group by coalesce(local_product_id, cabinet_name || '|' || coalesce(seller_sku, '') || '|' || coalesce(wb_sku, ''))
    order by count(*) desc, negative_share desc limit 15
  ), totals as (
    select (select count(*) from filtered_reviews)::bigint as text_reviews,
      (select count(distinct review_id) from filtered_matches)::bigint as classified_reviews,
      (select count(*) from filtered_matches)::bigint as topic_mentions,
      (select coalesce(avg(rating), 0) from selected_matches)::numeric as average_rating,
      (select coalesce(100.0 * count(*) filter (where sentiment = 'negative') / nullif(count(*), 0), 0) from selected_matches)::numeric as negative_share,
      (select coalesce(100.0 * count(*) filter (where sentiment = 'neutral') / nullif(count(*), 0), 0) from selected_matches)::numeric as neutral_share,
      (select coalesce(100.0 * count(*) filter (where sentiment = 'positive') / nullif(count(*), 0), 0) from selected_matches)::numeric as positive_share
  )
  select case when not public.is_admin() then null else jsonb_build_object(
    'version', coalesce((select version_number from published), 0), 'selected_topic_id', p_topic_id,
    'summary', jsonb_build_object(
      'text_reviews', totals.text_reviews, 'classified_reviews', totals.classified_reviews,
      'topic_mentions', totals.topic_mentions, 'coverage', coalesce(100.0 * totals.classified_reviews / nullif(totals.text_reviews, 0), 0),
      'average_rating', totals.average_rating, 'negative_share', totals.negative_share,
      'neutral_share', totals.neutral_share, 'positive_share', totals.positive_share,
      'topic_score', totals.positive_share + totals.neutral_share * 0.5
    ),
    'topics', coalesce((select jsonb_agg(jsonb_build_object(
      'id', id, 'name', name, 'group_name', group_name, 'review_count', review_count, 'rule_matches', rule_matches,
      'share', coalesce(100.0 * review_count / nullif(totals.text_reviews, 0), 0), 'average_rating', average_rating,
      'negative_share', negative_share, 'neutral_share', neutral_share, 'positive_share', positive_share,
      'topic_score', positive_share + neutral_share * 0.5
    ) order by review_count desc, group_sort, sort_order) from topic_rows), '[]'::jsonb),
    'trend', coalesce((select jsonb_agg(jsonb_build_object(
      'date', review_date, 'mentions', mentions, 'reviews', reviews, 'average_rating', average_rating,
      'negative_share', negative_share, 'neutral_share', neutral_share, 'positive_share', positive_share
    ) order by review_date) from daily_rows), '[]'::jsonb),
    'products', coalesce((select jsonb_agg(to_jsonb(product_rows) order by mentions desc) from product_rows), '[]'::jsonb)
  ) end from totals;
$$;

revoke all on function public.save_cx_topic_rule(uuid, uuid, text, text, jsonb, text, integer, boolean, text) from public;
revoke all on function public.test_cx_dictionary_rules(text, text, text) from public;
grant execute on function public.save_cx_topic_rule(uuid, uuid, text, text, jsonb, text, integer, boolean, text) to authenticated;
grant execute on function public.test_cx_dictionary_rules(text, text, text) to authenticated;
