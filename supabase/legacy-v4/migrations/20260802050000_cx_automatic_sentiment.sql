create table if not exists public.cx_sentiment_lexicon (
  lemma text primary key,
  score smallint not null check (score between -2 and 2 and score <> 0),
  source text not null default 'domain',
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.cx_sentiment_lexicon enable row level security;
drop policy if exists cx_sentiment_lexicon_admin_select on public.cx_sentiment_lexicon;
create policy cx_sentiment_lexicon_admin_select on public.cx_sentiment_lexicon
  for select to authenticated using (public.is_admin());
grant select on public.cx_sentiment_lexicon to authenticated;

insert into public.cx_sentiment_lexicon (lemma, score) values
  ('отличный', 2), ('прекрасный', 2), ('идеальный', 2), ('великолепный', 2),
  ('хороший', 1), ('красивый', 1), ('качественный', 2), ('удобный', 1),
  ('яркий', 1), ('надежный', 2), ('прочный', 1), ('довольный', 2),
  ('понравиться', 2), ('рекомендовать', 2), ('радовать', 1), ('быстро', 1),
  ('легко', 1), ('аккуратный', 1), ('целый', 1), ('соответствовать', 1),
  ('работать', 1), ('достаточно', 1), ('эффектный', 1), ('стильный', 1),
  ('плохой', -2), ('ужасный', -2), ('отвратительный', -2), ('некачественный', -2),
  ('сломанный', -2), ('брак', -2), ('дефект', -2), ('поврежденный', -2),
  ('разочаровать', -2), ('неудобный', -1), ('слабый', -1), ('тусклый', -1),
  ('маленький', -1), ('шумный', -1), ('кривой', -1), ('хлипкий', -2),
  ('недостаточно', -1), ('долго', -1), ('задержка', -1), ('царапина', -1),
  ('трещина', -2), ('неполный', -2), ('грязный', -1), ('перестать', -1)
on conflict (lemma) do nothing;

alter table public.cx_topic_rules alter column sentiment drop default;
alter table public.cx_topic_rules alter column sentiment drop not null;
update public.cx_topic_rules set sentiment = null where sentiment = 'neutral';
alter table public.cx_topic_rules drop constraint if exists cx_topic_rules_sentiment_check;
alter table public.cx_topic_rules add constraint cx_topic_rules_sentiment_check
  check (sentiment is null or sentiment in ('positive', 'neutral', 'negative'));

create or replace function public.cx_context_sentiment(
  p_lemmatized_text text,
  p_anchor_terms text[] default null,
  p_window integer default 6
)
returns table (sentiment text, sentiment_score integer, positive_hits integer, negative_hits integer)
language plpgsql
stable
set search_path = public
as $$
declare
  tokens text[] := regexp_split_to_array(lower(btrim(coalesce(p_lemmatized_text, ''))), '\s+');
  anchors integer[] := '{}'::integer[];
  token_index integer;
  anchor_index integer;
  lexicon_score integer;
  contribution integer;
  total_score integer := 0;
  positive_count integer := 0;
  negative_count integer := 0;
  near_topic boolean;
  negated boolean;
begin
  if coalesce(array_length(tokens, 1), 0) = 0 then
    return query select 'neutral'::text, 0, 0, 0;
    return;
  end if;

  if coalesce(array_length(p_anchor_terms, 1), 0) > 0 then
    for token_index in 1..array_length(tokens, 1) loop
      if tokens[token_index] = any(p_anchor_terms) then anchors := array_append(anchors, token_index); end if;
    end loop;
  end if;

  for token_index in 1..array_length(tokens, 1) loop
    select lexicon.score into lexicon_score
    from public.cx_sentiment_lexicon as lexicon
    where lexicon.lemma = tokens[token_index] and lexicon.is_active;
    if lexicon_score is null then continue; end if;

    near_topic := coalesce(array_length(anchors, 1), 0) = 0;
    if not near_topic then
      foreach anchor_index in array anchors loop
        if abs(token_index - anchor_index) <= greatest(coalesce(p_window, 6), 1) then
          near_topic := true;
          exit;
        end if;
      end loop;
    end if;
    if not near_topic then continue; end if;

    select exists (
      select 1 from generate_series(greatest(1, token_index - 3), token_index - 1) as previous(position)
      where tokens[previous.position] in ('не', 'ни', 'нет', 'без')
    ) into negated;
    contribution := case when negated then -lexicon_score else lexicon_score end;
    total_score := total_score + contribution;
    if contribution > 0 then positive_count := positive_count + 1; end if;
    if contribution < 0 then negative_count := negative_count + 1; end if;
  end loop;

  return query select
    case when total_score > 0 then 'positive' when total_score < 0 then 'negative' else 'neutral' end,
    total_score, positive_count, negative_count;
end;
$$;

drop function if exists public.save_cx_topic_rule(uuid, uuid, text, text, jsonb, text, integer, boolean, text);
create function public.save_cx_topic_rule(
  p_id uuid,
  p_topic_id uuid,
  p_rule_type text,
  p_pattern text,
  p_rule_config jsonb default '{}'::jsonb,
  p_sentiment text default null,
  p_priority integer default 100,
  p_is_active boolean default true,
  p_comment text default ''
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare draft_id uuid; result_id uuid;
begin
  if not public.is_admin() then raise exception 'Admin access required'; end if;
  select id into draft_id from public.cx_dictionary_versions where status = 'draft' limit 1;
  if draft_id is null then raise exception 'Create a draft before editing rules'; end if;
  if p_rule_type not in ('exact_keyword', 'exact_phrase', 'lemma', 'lemma_phrase', 'context', 'regex', 'exclusion') then raise exception 'Unsupported rule type'; end if;
  if btrim(coalesce(p_pattern, '')) = '' then raise exception 'Pattern is required'; end if;
  if p_sentiment is not null and p_sentiment not in ('positive', 'neutral', 'negative') then raise exception 'Unsupported sentiment override'; end if;
  if p_id is null then
    insert into public.cx_topic_rules (
      topic_id, dictionary_version_id, rule_type, pattern, normalized_pattern, rule_config,
      sentiment, priority, is_active, comment
    ) values (
      p_topic_id, draft_id, p_rule_type, btrim(p_pattern), lower(btrim(p_pattern)), coalesce(p_rule_config, '{}'::jsonb),
      case when p_rule_type = 'exclusion' then null else p_sentiment end,
      coalesce(p_priority, 100), coalesce(p_is_active, true), coalesce(p_comment, '')
    ) returning id into result_id;
  else
    update public.cx_topic_rules set topic_id = p_topic_id, rule_type = p_rule_type,
      pattern = btrim(p_pattern), normalized_pattern = lower(btrim(p_pattern)),
      rule_config = coalesce(p_rule_config, '{}'::jsonb),
      sentiment = case when p_rule_type = 'exclusion' then null else p_sentiment end,
      priority = coalesce(p_priority, 100), is_active = coalesce(p_is_active, true),
      comment = coalesce(p_comment, ''), updated_at = now()
    where id = p_id and dictionary_version_id = draft_id returning id into result_id;
  end if;
  return result_id;
end;
$$;

drop function if exists public.test_cx_dictionary_rules(text, text, text);
create function public.test_cx_dictionary_rules(
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
  with evaluated as (
    select rules.topic_id, rules.id, rules.rule_type, rules.pattern, rules.normalized_pattern,
      rules.rule_config, rules.sentiment as sentiment_override,
      public.cx_rule_matches(rules.rule_type, rules.normalized_pattern, rules.rule_config, p_cleaned_text, p_lemmatized_text) as is_match
    from public.cx_topic_rules as rules
    where rules.dictionary_version_id = draft_id and rules.is_active
  ), grouped as (
    select evaluated.topic_id,
      jsonb_agg(jsonb_build_object('id', evaluated.id, 'type', evaluated.rule_type, 'pattern', evaluated.pattern))
        filter (where evaluated.is_match and evaluated.rule_type <> 'exclusion') as matches,
      array_agg(distinct anchors.term) filter (where evaluated.is_match and evaluated.rule_type <> 'exclusion' and anchors.term <> '') as anchor_terms,
      max(evaluated.sentiment_override) filter (where evaluated.is_match and evaluated.rule_type <> 'exclusion' and evaluated.sentiment_override is not null) as sentiment_override,
      bool_or(evaluated.is_match and evaluated.rule_type = 'exclusion') as has_exclusion
    from evaluated
    left join lateral (
      select value as term from jsonb_array_elements_text(
        case when evaluated.rule_type = 'context'
          then coalesce(evaluated.rule_config->'required', '[]'::jsonb)
          else to_jsonb(regexp_split_to_array(evaluated.normalized_pattern, '\s+')) end
      )
    ) as anchors on true
    group by evaluated.topic_id
  )
  select topics.id, revisions.name, groups.name, coalesce(grouped.matches, '[]'::jsonb),
    coalesce(grouped.has_exclusion, false),
    coalesce(grouped.sentiment_override, automatic.sentiment)
  from grouped
  cross join lateral public.cx_context_sentiment(p_lemmatized_text, grouped.anchor_terms, 6) as automatic
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
    select reviews.id as review_id, reviews.lemmatized_text, rules.topic_id, rules.id as rule_id,
      rules.rule_type, rules.pattern, rules.normalized_pattern, rules.rule_config,
      rules.sentiment as sentiment_override,
      public.cx_rule_matches(rules.rule_type, rules.normalized_pattern, rules.rule_config, reviews.normalized_text, reviews.lemmatized_text) as is_match
    from public.reviews as reviews cross join public.cx_topic_rules as rules
    where reviews.id = any(candidate_ids) and rules.dictionary_version_id = run_row.dictionary_version_id and rules.is_active
  ), grouped as (
    select evaluated.review_id, evaluated.lemmatized_text, evaluated.topic_id,
      jsonb_agg(jsonb_build_object('id', evaluated.rule_id, 'type', evaluated.rule_type, 'pattern', evaluated.pattern)
        order by evaluated.rule_id) filter (where evaluated.is_match and evaluated.rule_type <> 'exclusion') as matches,
      count(*) filter (where evaluated.is_match and evaluated.rule_type <> 'exclusion')::integer as match_count,
      array_agg(distinct anchors.term) filter (where evaluated.is_match and evaluated.rule_type <> 'exclusion' and anchors.term <> '') as anchor_terms,
      max(evaluated.sentiment_override) filter (where evaluated.is_match and evaluated.rule_type <> 'exclusion' and evaluated.sentiment_override is not null) as sentiment_override,
      bool_or(evaluated.is_match and evaluated.rule_type = 'exclusion') as excluded
    from evaluated
    left join lateral (
      select value as term from jsonb_array_elements_text(
        case when evaluated.rule_type = 'context'
          then coalesce(evaluated.rule_config->'required', '[]'::jsonb)
          else to_jsonb(regexp_split_to_array(evaluated.normalized_pattern, '\s+')) end
      )
    ) as anchors on true
    group by evaluated.review_id, evaluated.lemmatized_text, evaluated.topic_id
  ), classified as (
    select grouped.*,
      coalesce(grouped.sentiment_override, automatic.sentiment) as calculated_sentiment
    from grouped
    cross join lateral public.cx_context_sentiment(grouped.lemmatized_text, grouped.anchor_terms, 6) as automatic
    where grouped.match_count > 0 and not grouped.excluded
  )
  insert into public.cx_review_topic_matches (
    review_id, dictionary_version_id, analysis_run_id, topic_id, matched_rules, match_count, confidence,
    sentiment, positive_matches, neutral_matches, negative_matches
  )
  select classified.review_id, run_row.dictionary_version_id, run_row.id, classified.topic_id,
    classified.matches, classified.match_count, 1, classified.calculated_sentiment,
    case when classified.calculated_sentiment = 'positive' then 1 else 0 end,
    case when classified.calculated_sentiment = 'neutral' then 1 else 0 end,
    case when classified.calculated_sentiment = 'negative' then 1 else 0 end
  from classified
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

revoke all on function public.cx_context_sentiment(text, text[], integer) from public;
revoke all on function public.save_cx_topic_rule(uuid, uuid, text, text, jsonb, text, integer, boolean, text) from public;
revoke all on function public.test_cx_dictionary_rules(text, text, text) from public;
grant execute on function public.cx_context_sentiment(text, text[], integer) to authenticated;
grant execute on function public.save_cx_topic_rule(uuid, uuid, text, text, jsonb, text, integer, boolean, text) to authenticated;
grant execute on function public.test_cx_dictionary_rules(text, text, text) to authenticated;
