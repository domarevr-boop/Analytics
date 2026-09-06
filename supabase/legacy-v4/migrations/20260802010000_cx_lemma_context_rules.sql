alter table public.reviews
  add column if not exists lemmatized_text text,
  add column if not exists lemmatization_version text;

alter table public.review_fragments
  add column if not exists lemmatized_text text;

alter table public.cx_topic_rules
  add column if not exists rule_config jsonb not null default '{}'::jsonb;

alter table public.cx_topic_rules drop constraint if exists cx_topic_rules_rule_type_check;
update public.cx_topic_rules set rule_type = 'exact_keyword' where rule_type = 'keyword';
update public.cx_topic_rules set rule_type = 'exact_phrase' where rule_type = 'phrase';
alter table public.cx_topic_rules add constraint cx_topic_rules_rule_type_check check (
  rule_type in ('exact_keyword', 'exact_phrase', 'lemma', 'lemma_phrase', 'context', 'regex', 'exclusion')
);

create index if not exists reviews_lemmatization_pending_idx
  on public.reviews (review_date, id) where lemmatized_text is null;

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
      is_case_sensitive, priority, is_active, comment
    )
    select topic_id, draft_id, rule_type, pattern, normalized_pattern, rule_config,
      is_case_sensitive, priority, is_active, comment
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

create or replace function public.cx_context_rule_matches(p_lemmas text[], p_config jsonb)
returns boolean
language plpgsql
immutable
set search_path = public
as $$
declare
  required_value text;
  any_value text;
  required_position integer;
  any_position integer;
  token_index integer;
  max_distance integer := greatest(0, coalesce((p_config->>'maxDistance')::integer, 4));
  has_any boolean := false;
  near_any boolean := false;
begin
  if jsonb_array_length(coalesce(p_config->'required', '[]'::jsonb)) = 0
    or jsonb_array_length(coalesce(p_config->'anyOf', '[]'::jsonb)) = 0 then
    return false;
  end if;
  for required_value in select jsonb_array_elements_text(p_config->'required') loop
    if array_position(p_lemmas, lower(required_value)) is null then return false; end if;
  end loop;
  for any_value in select jsonb_array_elements_text(p_config->'anyOf') loop
    for token_index in select generate_subscripts(p_lemmas, 1) loop
      if p_lemmas[token_index] <> lower(any_value) then continue; end if;
      any_position := token_index;
      has_any := true;
      for required_value in select jsonb_array_elements_text(p_config->'required') loop
        for required_position in select generate_subscripts(p_lemmas, 1) loop
          if p_lemmas[required_position] = lower(required_value)
            and abs(required_position - any_position) <= max_distance then near_any := true; end if;
        end loop;
      end loop;
    end loop;
  end loop;
  return has_any and near_any;
end;
$$;

create or replace function public.backfill_cx_text_lemmas(
  p_reviews jsonb,
  p_fragments jsonb,
  p_version text
)
returns table (updated_reviews integer, updated_fragments integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  review_count integer := 0;
  fragment_count integer := 0;
begin
  if not public.is_admin() then raise exception 'Admin access required'; end if;
  update public.reviews as reviews
  set lemmatized_text = source.lemmatized_text,
      lemmatization_version = p_version
  from jsonb_to_recordset(coalesce(p_reviews, '[]'::jsonb)) as source(id uuid, lemmatized_text text)
  where reviews.id = source.id and source.lemmatized_text is not null;
  get diagnostics review_count = row_count;

  update public.review_fragments as fragments
  set lemmatized_text = source.lemmatized_text
  from jsonb_to_recordset(coalesce(p_fragments, '[]'::jsonb)) as source(id bigint, lemmatized_text text)
  where fragments.id = source.id and source.lemmatized_text is not null;
  get diagnostics fragment_count = row_count;

  return query select review_count, fragment_count;
end;
$$;

drop function if exists public.save_cx_topic_rule(uuid, uuid, text, text, integer, boolean, text);
create or replace function public.save_cx_topic_rule(
  p_id uuid,
  p_topic_id uuid,
  p_rule_type text,
  p_pattern text,
  p_rule_config jsonb default '{}'::jsonb,
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
      priority, is_active, comment
    ) values (
      p_topic_id, draft_id, p_rule_type, coalesce(nullif(btrim(p_pattern), ''), 'context'), normalized,
      coalesce(p_rule_config, '{}'::jsonb), coalesce(p_priority, 100), coalesce(p_is_active, true), coalesce(p_comment, '')
    ) returning id into result_id;
  else
    update public.cx_topic_rules set topic_id = p_topic_id, rule_type = p_rule_type,
      pattern = coalesce(nullif(btrim(p_pattern), ''), 'context'), normalized_pattern = normalized,
      rule_config = coalesce(p_rule_config, '{}'::jsonb), priority = coalesce(p_priority, 100),
      is_active = coalesce(p_is_active, true), comment = coalesce(p_comment, ''), updated_at = now()
    where id = p_id and dictionary_version_id = draft_id returning id into result_id;
  end if;
  return result_id;
end;
$$;

drop function if exists public.test_cx_dictionary_rules(text);
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
  with prepared as (
    select
      regexp_split_to_array(lower(coalesce(p_cleaned_text, '')), '\s+') as cleaned_tokens,
      regexp_split_to_array(lower(coalesce(p_lemmatized_text, '')), '\s+') as lemma_tokens
  ), evaluated as (
    select rules.topic_id, rules.id, rules.rule_type, rules.pattern,
      case rules.rule_type
        when 'exact_keyword' then array_position(prepared.cleaned_tokens, rules.normalized_pattern) is not null
        when 'exact_phrase' then position(rules.normalized_pattern in lower(coalesce(p_cleaned_text, ''))) > 0
        when 'lemma' then array_position(prepared.lemma_tokens, rules.normalized_pattern) is not null
        when 'lemma_phrase' then position(rules.normalized_pattern in lower(coalesce(p_lemmatized_text, ''))) > 0
        when 'context' then public.cx_context_rule_matches(prepared.lemma_tokens, rules.rule_config)
        when 'regex' then lower(coalesce(p_cleaned_text, '')) ~ rules.pattern
        when 'exclusion' then position(rules.normalized_pattern in lower(coalesce(p_cleaned_text, ''))) > 0
        else false
      end as is_match
    from public.cx_topic_rules as rules cross join prepared
    where rules.dictionary_version_id = draft_id and rules.is_active
  ), grouped as (
    select evaluated.topic_id,
      jsonb_agg(jsonb_build_object('id', evaluated.id, 'type', evaluated.rule_type, 'pattern', evaluated.pattern))
        filter (where evaluated.is_match and evaluated.rule_type <> 'exclusion') as matches,
      bool_or(evaluated.is_match and evaluated.rule_type = 'exclusion') as has_exclusion
    from evaluated group by evaluated.topic_id
  )
  select topics.id, revisions.name, groups.name, coalesce(grouped.matches, '[]'::jsonb), coalesce(grouped.has_exclusion, false)
  from grouped
  join public.cx_topics as topics on topics.id = grouped.topic_id
  join public.cx_topic_revisions as revisions on revisions.topic_id = topics.id and revisions.dictionary_version_id = draft_id
  join public.cx_topic_groups as groups on groups.id = revisions.group_id
  where grouped.matches is not null or grouped.has_exclusion
  order by groups.sort_order, topics.sort_order;
exception when invalid_regular_expression then
  raise exception 'Invalid regular expression in draft dictionary';
end;
$$;

revoke all on function public.cx_context_rule_matches(text[], jsonb) from public;
revoke all on function public.backfill_cx_text_lemmas(jsonb, jsonb, text) from public;
revoke all on function public.save_cx_topic_rule(uuid, uuid, text, text, jsonb, integer, boolean, text) from public;
revoke all on function public.test_cx_dictionary_rules(text, text, text) from public;
grant execute on function public.save_cx_topic_rule(uuid, uuid, text, text, jsonb, integer, boolean, text) to authenticated;
grant execute on function public.test_cx_dictionary_rules(text, text, text) to authenticated;
grant execute on function public.backfill_cx_text_lemmas(jsonb, jsonb, text) to authenticated;
