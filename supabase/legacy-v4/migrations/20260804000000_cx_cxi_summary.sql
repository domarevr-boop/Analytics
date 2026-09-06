create or replace function public.cx_tonality(p_positive numeric, p_negative numeric)
returns numeric
language sql
immutable
set search_path = public
as $$
  select case when coalesce(p_positive, 0) + coalesce(p_negative, 0) = 0 then null
    else 100.0 * coalesce(p_positive, 0)
      / (coalesce(p_positive, 0) + coalesce(p_negative, 0)) end;
$$;

create or replace function public.cx_evaluative_share(
  p_positive numeric,
  p_neutral numeric,
  p_negative numeric
)
returns numeric
language sql
immutable
set search_path = public
as $$
  select coalesce(
    100.0 * (coalesce(p_positive, 0) + coalesce(p_negative, 0))
      / nullif(
        coalesce(p_positive, 0) + coalesce(p_neutral, 0) + coalesce(p_negative, 0),
        0
      ),
    0
  );
$$;

create or replace function public.get_cx_cxi_summary(
  p_date_from date default null,
  p_date_to date default null,
  p_cabinets text[] default null,
  p_product_ids text[] default null,
  p_rating smallint default null
)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with published as (
    select versions.id
    from public.cx_dictionary_versions as versions
    where versions.status = 'published' and versions.analysis_status = 'completed'
    limit 1
  ), period as (
    select p_date_from as current_from, p_date_to as current_to,
      case when p_date_from is not null and p_date_to is not null
        then p_date_from - (p_date_to - p_date_from + 1) else null end as previous_from,
      case when p_date_from is not null then p_date_from - 1 else null end as previous_to
  ), active_topics as materialized (
    select topics.id, revisions.name, groups.code as group_code, groups.name as group_name,
      groups.sort_order as group_sort, topics.sort_order
    from published
    join public.cx_topic_revisions as revisions on revisions.dictionary_version_id = published.id and revisions.is_active
    join public.cx_topics as topics on topics.id = revisions.topic_id
    join public.cx_topic_groups as groups on groups.id = revisions.group_id and groups.is_active
  ), current_reviews as materialized (
    select reviews.id
    from public.reviews as reviews cross join period
    where public.is_admin()
      and (period.current_from is null or reviews.review_date >= period.current_from)
      and (period.current_to is null or reviews.review_date <= period.current_to)
      and (p_cabinets is null or reviews.cabinet_name = any(p_cabinets))
      and (p_product_ids is null or reviews.local_product_id = any(p_product_ids))
      and (p_rating is null or reviews.rating = p_rating)
  ), previous_reviews as materialized (
    select reviews.id
    from public.reviews as reviews cross join period
    where public.is_admin() and period.previous_from is not null and period.previous_to is not null
      and reviews.review_date between period.previous_from and period.previous_to
      and (p_cabinets is null or reviews.cabinet_name = any(p_cabinets))
      and (p_product_ids is null or reviews.local_product_id = any(p_product_ids))
      and (p_rating is null or reviews.rating = p_rating)
  ), current_counts as (
    select active_topics.id,
      count(matches.review_id)::numeric as mentions,
      count(matches.review_id) filter (where matches.sentiment = 'positive')::numeric as positive,
      count(matches.review_id) filter (where matches.sentiment = 'neutral')::numeric as neutral,
      count(matches.review_id) filter (where matches.sentiment = 'negative')::numeric as negative
    from active_topics
    left join public.cx_review_topic_matches as matches
      on matches.topic_id = active_topics.id and matches.dictionary_version_id = (select id from published)
      and exists (select 1 from current_reviews where current_reviews.id = matches.review_id)
    group by active_topics.id
  ), previous_counts as (
    select active_topics.id,
      count(matches.review_id)::numeric as mentions,
      count(matches.review_id) filter (where matches.sentiment = 'positive')::numeric as positive,
      count(matches.review_id) filter (where matches.sentiment = 'neutral')::numeric as neutral,
      count(matches.review_id) filter (where matches.sentiment = 'negative')::numeric as negative
    from active_topics
    left join public.cx_review_topic_matches as matches
      on matches.topic_id = active_topics.id and matches.dictionary_version_id = (select id from published)
      and exists (select 1 from previous_reviews where previous_reviews.id = matches.review_id)
    group by active_topics.id
  ), topic_base as (
    select active_topics.*,
      current_counts.mentions, current_counts.positive, current_counts.neutral, current_counts.negative,
      current_counts.positive + current_counts.negative as evaluative_mentions,
      public.cx_tonality(current_counts.positive, current_counts.negative) as tonality,
      public.cx_evaluative_share(current_counts.positive, current_counts.neutral, current_counts.negative) as evaluative_share,
      coalesce(100.0 * current_counts.negative / nullif(current_counts.mentions, 0), 0) as negative_share,
      previous_counts.mentions as previous_mentions,
      previous_counts.positive + previous_counts.negative as previous_evaluative_mentions,
      public.cx_tonality(previous_counts.positive, previous_counts.negative) as previous_tonality
    from active_topics
    join current_counts using (id)
    join previous_counts using (id)
  ), totals as (
    select sum(evaluative_mentions) as evaluative_mentions,
      sum(previous_evaluative_mentions) as previous_evaluative_mentions
    from topic_base
  ), group_totals as (
    select group_code,
      sum(evaluative_mentions) as evaluative_mentions,
      sum(previous_evaluative_mentions) as previous_evaluative_mentions
    from topic_base group by group_code
  ), topic_metrics as materialized (
    select topic_base.*,
      coalesce(100.0 * topic_base.evaluative_mentions / nullif(group_totals.evaluative_mentions, 0), 0) as group_weight,
      coalesce(100.0 * topic_base.evaluative_mentions / nullif(totals.evaluative_mentions, 0), 0) as overall_weight,
      case when topic_base.tonality is null then null
        else topic_base.evaluative_mentions / nullif(totals.evaluative_mentions, 0) * topic_base.tonality end as contribution,
      case when topic_base.previous_tonality is null then null
        else topic_base.previous_evaluative_mentions / nullif(totals.previous_evaluative_mentions, 0) * topic_base.previous_tonality end as previous_contribution
    from topic_base cross join totals join group_totals using (group_code)
  ), overall as (
    select public.cx_tonality(sum(positive), sum(negative)) as cxi,
      public.cx_tonality(sum(previous_evaluative_mentions * previous_tonality / 100.0),
        sum(previous_evaluative_mentions * (100.0 - previous_tonality) / 100.0)) as previous_cxi,
      sum(evaluative_mentions)::bigint as evaluative_mentions
    from topic_metrics
  ), group_rows as (
    select group_code, max(group_name) as group_name, min(group_sort) as group_sort,
      public.cx_tonality(sum(positive), sum(negative)) as cxi,
      public.cx_tonality(sum(previous_evaluative_mentions * previous_tonality / 100.0),
        sum(previous_evaluative_mentions * (100.0 - previous_tonality) / 100.0)) as previous_cxi,
      sum(evaluative_mentions)::bigint as evaluative_mentions
    from topic_metrics group by group_code
  )
  select case when not public.is_admin() then null else jsonb_build_object(
    'overall', jsonb_build_object(
      'cxi', overall.cxi, 'previous_cxi', overall.previous_cxi,
      'delta', case when overall.cxi is null or overall.previous_cxi is null then null else overall.cxi - overall.previous_cxi end,
      'evaluative_mentions', overall.evaluative_mentions
    ),
    'groups', coalesce((select jsonb_agg(jsonb_build_object(
      'code', group_code, 'name', group_name, 'cxi', cxi, 'previous_cxi', previous_cxi,
      'delta', case when cxi is null or previous_cxi is null then null else cxi - previous_cxi end,
      'evaluative_mentions', evaluative_mentions
    ) order by group_sort) from group_rows), '[]'::jsonb),
    'topics', coalesce((select jsonb_agg(jsonb_build_object(
      'id', id, 'evaluative_mentions', evaluative_mentions, 'previous_evaluative_mentions', previous_evaluative_mentions,
      'group_weight', group_weight, 'overall_weight', overall_weight, 'tonality', tonality,
      'previous_tonality', previous_tonality, 'evaluative_share', evaluative_share,
      'negative_share', negative_share, 'contribution', contribution, 'previous_contribution', previous_contribution,
      'contribution_delta', case when contribution is null or previous_contribution is null then null else contribution - previous_contribution end
    ) order by contribution desc nulls last, group_sort, sort_order) from topic_metrics), '[]'::jsonb)
  ) end
  from overall;
$$;

revoke all on function public.get_cx_cxi_summary(date, date, text[], text[], smallint) from public;
grant execute on function public.get_cx_cxi_summary(date, date, text[], text[], smallint) to authenticated;
