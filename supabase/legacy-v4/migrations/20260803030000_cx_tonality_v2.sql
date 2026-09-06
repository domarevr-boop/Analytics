create table if not exists public.cx_sentiment_model_versions (
  id uuid primary key default gen_random_uuid(),
  version_number integer not null unique,
  code text not null unique,
  description text not null default '',
  config jsonb not null default '{}'::jsonb,
  is_active boolean not null default false,
  created_at timestamptz not null default now()
);

create unique index if not exists cx_sentiment_model_one_active_idx
  on public.cx_sentiment_model_versions (is_active) where is_active;

create table if not exists public.cx_sentiment_model_lexicon (
  sentiment_model_version_id uuid not null references public.cx_sentiment_model_versions(id) on delete restrict,
  lemma text not null,
  score smallint not null check (score between -5 and 5 and score <> 0),
  is_active boolean not null default true,
  primary key (sentiment_model_version_id, lemma)
);

create table if not exists public.cx_aggregation_model_versions (
  id uuid primary key default gen_random_uuid(),
  version_number integer not null unique,
  code text not null unique,
  description text not null default '',
  config jsonb not null default '{}'::jsonb,
  is_active boolean not null default false,
  created_at timestamptz not null default now()
);

create unique index if not exists cx_aggregation_model_one_active_idx
  on public.cx_aggregation_model_versions (is_active) where is_active;

insert into public.cx_sentiment_model_versions (version_number, code, description, config, is_active)
values (1, 'aspect-lexicon-v1', 'Контекстная модель тональности совпадений на версионируемом лексиконе.',
  jsonb_build_object('window', 6, 'negation_window', 3), true)
on conflict (code) do update set description = excluded.description, config = excluded.config, is_active = true;

insert into public.cx_sentiment_model_lexicon (sentiment_model_version_id, lemma, score, is_active)
select model.id, lexicon.lemma, lexicon.score, lexicon.is_active
from public.cx_sentiment_model_versions as model
cross join public.cx_sentiment_lexicon as lexicon
where model.code = 'aspect-lexicon-v1'
on conflict (sentiment_model_version_id, lemma) do update
set score = excluded.score, is_active = excluded.is_active;

insert into public.cx_aggregation_model_versions (version_number, code, description, config, is_active)
values (2, 'tonality-evaluative-v2', 'Нейтральные совпадения исключены из тональности и сохранены в объёме упоминаний.',
  jsonb_build_object(
    'tonality', 'positive / (positive + negative) * 100',
    'evaluative_share', '(positive + negative) / (positive + neutral + negative) * 100',
    'empty_tonality', null,
    'cxi_weight', 'evaluative_mentions'
  ), true)
on conflict (code) do update set description = excluded.description, config = excluded.config, is_active = true;

alter table public.cx_dictionary_versions
  add column if not exists sentiment_model_version_id uuid references public.cx_sentiment_model_versions(id) on delete restrict,
  add column if not exists aggregation_model_version_id uuid references public.cx_aggregation_model_versions(id) on delete restrict;

alter table public.cx_analysis_runs
  add column if not exists sentiment_model_version_id uuid references public.cx_sentiment_model_versions(id) on delete restrict,
  add column if not exists aggregation_model_version_id uuid references public.cx_aggregation_model_versions(id) on delete restrict;

alter table public.cx_review_topic_matches
  add column if not exists sentiment_model_version_id uuid references public.cx_sentiment_model_versions(id) on delete restrict;

update public.cx_dictionary_versions
set sentiment_model_version_id = coalesce(sentiment_model_version_id,
      (select id from public.cx_sentiment_model_versions where is_active limit 1)),
    aggregation_model_version_id = coalesce(aggregation_model_version_id,
      (select id from public.cx_aggregation_model_versions where is_active limit 1));

update public.cx_analysis_runs as runs
set sentiment_model_version_id = coalesce(runs.sentiment_model_version_id, versions.sentiment_model_version_id),
    aggregation_model_version_id = coalesce(runs.aggregation_model_version_id, versions.aggregation_model_version_id)
from public.cx_dictionary_versions as versions
where versions.id = runs.dictionary_version_id;

update public.cx_review_topic_matches as matches
set sentiment_model_version_id = coalesce(matches.sentiment_model_version_id, versions.sentiment_model_version_id)
from public.cx_dictionary_versions as versions
where versions.id = matches.dictionary_version_id;

create or replace function public.cx_assign_model_versions()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.sentiment_model_version_id := coalesce(new.sentiment_model_version_id,
    (select id from public.cx_sentiment_model_versions where is_active limit 1));
  new.aggregation_model_version_id := coalesce(new.aggregation_model_version_id,
    (select id from public.cx_aggregation_model_versions where is_active limit 1));
  return new;
end;
$$;

drop trigger if exists cx_dictionary_assign_model_versions on public.cx_dictionary_versions;
create trigger cx_dictionary_assign_model_versions before insert on public.cx_dictionary_versions
for each row execute function public.cx_assign_model_versions();

create or replace function public.cx_tonality(p_positive numeric, p_negative numeric)
returns numeric
language sql
immutable
set search_path = public
as $$
  select case when coalesce(p_positive, 0) + coalesce(p_negative, 0) = 0 then null
    else 100.0 * coalesce(p_positive, 0) / (coalesce(p_positive, 0) + coalesce(p_negative, 0)) end;
$$;

create or replace function public.cx_evaluative_share(p_positive numeric, p_neutral numeric, p_negative numeric)
returns numeric
language sql
immutable
set search_path = public
as $$
  select coalesce(100.0 * (coalesce(p_positive, 0) + coalesce(p_negative, 0))
    / nullif(coalesce(p_positive, 0) + coalesce(p_neutral, 0) + coalesce(p_negative, 0), 0), 0);
$$;

create or replace function public.get_cx_topics_workspace_v2(
  p_date_from date default null,
  p_date_to date default null,
  p_cabinets text[] default null,
  p_product_ids text[] default null,
  p_rating smallint default null,
  p_topic_id uuid default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  result jsonb;
  item jsonb;
  rebuilt jsonb := '[]'::jsonb;
  rebuilt_groups jsonb := '[]'::jsonb;
  positive numeric;
  neutral numeric;
  negative numeric;
  evaluative numeric;
  total_evaluative numeric := 0;
  group_evaluative numeric;
  group_score numeric;
begin
  result := public.get_cx_topics_workspace(p_date_from, p_date_to, p_cabinets, p_product_ids, p_rating, p_topic_id);
  if result is null then return null; end if;

  positive := coalesce((result #>> '{summary,positive_share}')::numeric, 0);
  neutral := coalesce((result #>> '{summary,neutral_share}')::numeric, 0);
  negative := coalesce((result #>> '{summary,negative_share}')::numeric, 0);
  result := jsonb_set(result, '{summary,topic_score}', to_jsonb(public.cx_tonality(positive, negative)), true);
  result := jsonb_set(result, '{summary,evaluative_share}', to_jsonb(public.cx_evaluative_share(positive, neutral, negative)), true);

  for item in select value from jsonb_array_elements(coalesce(result->'topics', '[]'::jsonb)) loop
    positive := coalesce((item->>'positive_share')::numeric, 0);
    neutral := coalesce((item->>'neutral_share')::numeric, 0);
    negative := coalesce((item->>'negative_share')::numeric, 0);
    evaluative := coalesce((item->>'review_count')::numeric, 0) * (positive + negative) / 100.0;
    total_evaluative := total_evaluative + evaluative;
  end loop;

  for item in select value from jsonb_array_elements(coalesce(result->'topics', '[]'::jsonb)) loop
    positive := coalesce((item->>'positive_share')::numeric, 0);
    neutral := coalesce((item->>'neutral_share')::numeric, 0);
    negative := coalesce((item->>'negative_share')::numeric, 0);
    evaluative := coalesce((item->>'review_count')::numeric, 0) * (positive + negative) / 100.0;
    item := jsonb_set(item, '{topic_score}', to_jsonb(public.cx_tonality(positive, negative)), true);
    item := jsonb_set(item, '{evaluative_share}', to_jsonb(public.cx_evaluative_share(positive, neutral, negative)), true);
    item := jsonb_set(item, '{weight}', to_jsonb(coalesce(100.0 * evaluative / nullif(total_evaluative, 0), 0)), true);
    item := jsonb_set(item, '{cxi_contribution}', to_jsonb(case when public.cx_tonality(positive, negative) is null then null
      else coalesce(evaluative / nullif(total_evaluative, 0), 0) * public.cx_tonality(positive, negative) end), true);
    rebuilt := rebuilt || jsonb_build_array(item);
  end loop;
  result := jsonb_set(result, '{topics}', rebuilt, true);

  for item in select value from jsonb_array_elements(coalesce(result->'groups', '[]'::jsonb)) loop
    select sum((topic->>'review_count')::numeric * ((topic->>'evaluative_share')::numeric / 100.0)),
      sum((topic->>'review_count')::numeric * ((topic->>'evaluative_share')::numeric / 100.0) * (topic->>'topic_score')::numeric)
    into group_evaluative, group_score
    from jsonb_array_elements(rebuilt) as topic
    where topic->>'group_code' = item->>'code' and topic->>'topic_score' is not null;
    item := jsonb_set(item, '{cxi}', to_jsonb(case when coalesce(group_evaluative, 0) = 0 then null else group_score / group_evaluative end), true);
    item := jsonb_set(item, '{delta}', 'null'::jsonb, true);
    rebuilt_groups := rebuilt_groups || jsonb_build_array(item);
  end loop;
  result := jsonb_set(result, '{groups}', rebuilt_groups, true);

  rebuilt := '[]'::jsonb;
  for item in select value from jsonb_array_elements(coalesce(result->'products', '[]'::jsonb)) loop
    positive := coalesce((item->>'positive_share')::numeric, 0);
    negative := coalesce((item->>'negative_share')::numeric, 0);
    item := jsonb_set(item, '{neutral_share}', to_jsonb(greatest(0, 100 - positive - negative)), true);
    rebuilt := rebuilt || jsonb_build_array(item);
  end loop;
  result := jsonb_set(result, '{products}', rebuilt, true);
  result := jsonb_set(result, '{workspace_version}', '2'::jsonb, true);
  return result;
end;
$$;

create or replace function public.get_cx_topic_timeseries_v2(
  p_date_from date default null,
  p_date_to date default null,
  p_cabinets text[] default null,
  p_product_ids text[] default null,
  p_rating smallint default null,
  p_topic_id uuid default null,
  p_granularity text default 'auto'
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  result jsonb;
  workspace jsonb;
  item jsonb;
  rebuilt jsonb := '[]'::jsonb;
  current_score numeric;
  previous_score numeric;
  current_negative numeric;
  previous_negative numeric;
  current_positive numeric;
  previous_positive numeric;
  current_tonality numeric;
  previous_tonality numeric;
  current_mentions numeric;
  previous_mentions numeric;
  comparison jsonb;
begin
  result := public.get_cx_topic_timeseries(p_date_from, p_date_to, p_cabinets, p_product_ids, p_rating, p_topic_id, p_granularity);
  if result is null then return null; end if;

  for item in select value from jsonb_array_elements(coalesce(result->'trend', '[]'::jsonb)) loop
    current_mentions := coalesce((item->>'mentions')::numeric, 0);
    current_score := coalesce((item->>'topic_score')::numeric, 0);
    current_negative := coalesce((item->>'negative_share')::numeric, 0);
    current_positive := greatest(0, 2 * current_score - 100 + current_negative);
    item := jsonb_set(item, '{neutral_share}', to_jsonb(greatest(0, 100 - current_positive - current_negative)), true);
    item := jsonb_set(item, '{evaluative_share}', to_jsonb(case when current_mentions = 0 then 0 else current_positive + current_negative end), true);
    item := jsonb_set(item, '{topic_score}', to_jsonb(case when current_mentions = 0 then null else public.cx_tonality(current_positive, current_negative) end), true);
    rebuilt := rebuilt || jsonb_build_array(item);
  end loop;
  result := jsonb_set(result, '{trend}', rebuilt, true);

  comparison := coalesce(result #> '{comparisons,topic_score}', '{}'::jsonb);
  current_score := coalesce((comparison->>'current')::numeric, 0);
  previous_score := coalesce((comparison->>'previous')::numeric, 0);
  current_negative := coalesce((result #>> '{comparisons,negative_share,current}')::numeric, 0);
  previous_negative := coalesce((result #>> '{comparisons,negative_share,previous}')::numeric, 0);
  current_mentions := coalesce((result #>> '{comparisons,mentions,current}')::numeric, 0);
  previous_mentions := coalesce((result #>> '{comparisons,mentions,previous}')::numeric, 0);
  current_positive := greatest(0, 2 * current_score - 100 + current_negative);
  previous_positive := greatest(0, 2 * previous_score - 100 + previous_negative);
  current_tonality := case when current_mentions = 0 then null else public.cx_tonality(current_positive, current_negative) end;
  previous_tonality := case when previous_mentions = 0 then null else public.cx_tonality(previous_positive, previous_negative) end;
  result := jsonb_set(result, '{comparisons,topic_score}', jsonb_build_object(
    'current', current_tonality, 'previous', previous_tonality,
    'delta', case when current_tonality is null or previous_tonality is null then null else current_tonality - previous_tonality end,
    'delta_percent', 0), true);
  result := jsonb_set(result, '{comparisons,evaluative_share}', jsonb_build_object(
    'current', case when current_mentions = 0 then 0 else current_positive + current_negative end,
    'previous', case when previous_mentions = 0 then 0 else previous_positive + previous_negative end,
    'delta', (case when current_mentions = 0 then 0 else current_positive + current_negative end)
      - (case when previous_mentions = 0 then 0 else previous_positive + previous_negative end),
    'delta_percent', 0), true);

  workspace := public.get_cx_topics_workspace_v2(p_date_from, p_date_to, p_cabinets, p_product_ids, p_rating, p_topic_id);
  select jsonb_build_object(
    'share', percentile_cont(0.5) within group (order by (topic->>'share')::numeric),
    'topic_score', percentile_cont(0.5) within group (order by (topic->>'topic_score')::numeric)
  ) into comparison
  from jsonb_array_elements(coalesce(workspace->'topics', '[]'::jsonb)) as topic
  where (topic->>'review_count')::numeric > 0 and topic->>'topic_score' is not null;
  result := jsonb_set(result, '{medians}', coalesce(comparison, jsonb_build_object('share', 0, 'topic_score', null)), true);
  return result;
end;
$$;

alter table public.cx_sentiment_model_versions enable row level security;
alter table public.cx_sentiment_model_lexicon enable row level security;
alter table public.cx_aggregation_model_versions enable row level security;

drop policy if exists cx_sentiment_model_versions_admin_select on public.cx_sentiment_model_versions;
create policy cx_sentiment_model_versions_admin_select on public.cx_sentiment_model_versions for select to authenticated using (public.is_admin());
drop policy if exists cx_sentiment_model_lexicon_admin_select on public.cx_sentiment_model_lexicon;
create policy cx_sentiment_model_lexicon_admin_select on public.cx_sentiment_model_lexicon for select to authenticated using (public.is_admin());
drop policy if exists cx_aggregation_model_versions_admin_select on public.cx_aggregation_model_versions;
create policy cx_aggregation_model_versions_admin_select on public.cx_aggregation_model_versions for select to authenticated using (public.is_admin());

grant select on public.cx_sentiment_model_versions, public.cx_sentiment_model_lexicon, public.cx_aggregation_model_versions to authenticated;
revoke all on function public.get_cx_topics_workspace_v2(date, date, text[], text[], smallint, uuid) from public;
revoke all on function public.get_cx_topic_timeseries_v2(date, date, text[], text[], smallint, uuid, text) from public;
grant execute on function public.get_cx_topics_workspace_v2(date, date, text[], text[], smallint, uuid) to authenticated;
grant execute on function public.get_cx_topic_timeseries_v2(date, date, text[], text[], smallint, uuid, text) to authenticated;
