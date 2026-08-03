create or replace function public.get_cx_topic_timeseries(
  p_date_from date default null,
  p_date_to date default null,
  p_cabinets text[] default null,
  p_product_ids text[] default null,
  p_rating smallint default null,
  p_topic_id uuid default null,
  p_granularity text default 'auto'
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
      case when p_date_from is not null then p_date_from - 1 else null end as previous_to,
      case
        when p_granularity in ('day', 'week', 'month') then p_granularity
        when p_date_from is null or p_date_to is null or p_date_to - p_date_from + 1 <= 45 then 'day'
        when p_date_to - p_date_from + 1 <= 180 then 'week'
        else 'month'
      end as granularity
  ), active_topics as materialized (
    select topics.id
    from published
    join public.cx_topic_revisions as revisions on revisions.dictionary_version_id = published.id and revisions.is_active
    join public.cx_topics as topics on topics.id = revisions.topic_id
  ), current_reviews as materialized (
    select reviews.*
    from public.reviews as reviews cross join period
    where public.is_admin()
      and (period.current_from is null or reviews.review_date >= period.current_from)
      and (period.current_to is null or reviews.review_date <= period.current_to)
      and (p_cabinets is null or reviews.cabinet_name = any(p_cabinets))
      and (p_product_ids is null or reviews.local_product_id = any(p_product_ids))
      and (p_rating is null or reviews.rating = p_rating)
  ), previous_reviews as materialized (
    select reviews.*
    from public.reviews as reviews cross join period
    where public.is_admin()
      and period.previous_from is not null and period.previous_to is not null
      and reviews.review_date between period.previous_from and period.previous_to
      and (p_cabinets is null or reviews.cabinet_name = any(p_cabinets))
      and (p_product_ids is null or reviews.local_product_id = any(p_product_ids))
      and (p_rating is null or reviews.rating = p_rating)
  ), current_matches as materialized (
    select matches.review_id, matches.topic_id, matches.sentiment, reviews.review_date, reviews.rating
    from public.cx_review_topic_matches as matches
    join published on published.id = matches.dictionary_version_id
    join current_reviews as reviews on reviews.id = matches.review_id
  ), previous_matches as materialized (
    select matches.review_id, matches.topic_id, matches.sentiment, reviews.rating
    from public.cx_review_topic_matches as matches
    join published on published.id = matches.dictionary_version_id
    join previous_reviews as reviews on reviews.id = matches.review_id
  ), selection as (
    select coalesce(p_topic_id,
      (select topic_id from current_matches group by topic_id order by count(*) desc limit 1),
      (select id from active_topics limit 1)
    ) as topic_id
  ), current_selected as materialized (
    select current_matches.* from current_matches cross join selection
    where current_matches.topic_id = selection.topic_id
  ), previous_selected as materialized (
    select previous_matches.* from previous_matches cross join selection
    where previous_matches.topic_id = selection.topic_id
  ), review_buckets as (
    select case period.granularity
        when 'month' then date_trunc('month', reviews.review_date)::date
        when 'week' then date_trunc('week', reviews.review_date)::date
        else reviews.review_date
      end as bucket_date,
      count(*)::bigint as text_reviews
    from current_reviews as reviews cross join period
    group by 1
  ), classified_buckets as (
    select case period.granularity
        when 'month' then date_trunc('month', matches.review_date)::date
        when 'week' then date_trunc('week', matches.review_date)::date
        else matches.review_date
      end as bucket_date,
      count(distinct matches.review_id)::bigint as classified_reviews
    from current_matches as matches cross join period
    group by 1
  ), selected_buckets as (
    select case period.granularity
        when 'month' then date_trunc('month', matches.review_date)::date
        when 'week' then date_trunc('week', matches.review_date)::date
        else matches.review_date
      end as bucket_date,
      count(*)::bigint as mentions,
      coalesce(avg(matches.rating), 0)::numeric as average_rating,
      coalesce(100.0 * count(*) filter (where matches.sentiment = 'negative') / nullif(count(*), 0), 0)::numeric as negative_share,
      coalesce(100.0 * count(*) filter (where matches.sentiment = 'neutral') / nullif(count(*), 0), 0)::numeric as neutral_share,
      coalesce(100.0 * count(*) filter (where matches.sentiment = 'positive') / nullif(count(*), 0), 0)::numeric as positive_share
    from current_selected as matches cross join period
    group by 1
  ), trend_rows as (
    select review_buckets.bucket_date, review_buckets.text_reviews,
      coalesce(classified_buckets.classified_reviews, 0)::bigint as classified_reviews,
      coalesce(selected_buckets.mentions, 0)::bigint as mentions,
      coalesce(100.0 * selected_buckets.mentions / nullif(review_buckets.text_reviews, 0), 0)::numeric as topic_share,
      coalesce(selected_buckets.average_rating, 0)::numeric as average_rating,
      coalesce(selected_buckets.negative_share, 0)::numeric as negative_share,
      coalesce(selected_buckets.positive_share, 0)::numeric as positive_share,
      coalesce(selected_buckets.positive_share + selected_buckets.neutral_share * 0.5, 0)::numeric as topic_score
    from review_buckets
    left join classified_buckets using (bucket_date)
    left join selected_buckets using (bucket_date)
  ), current_summary as (
    select (select count(*) from current_reviews)::numeric as text_reviews,
      (select count(distinct review_id) from current_matches)::numeric as classified_reviews,
      count(*)::numeric as mentions,
      coalesce(avg(rating), 0)::numeric as average_rating,
      coalesce(100.0 * count(*) filter (where sentiment = 'negative') / nullif(count(*), 0), 0)::numeric as negative_share,
      coalesce(100.0 * count(*) filter (where sentiment = 'neutral') / nullif(count(*), 0), 0)::numeric as neutral_share,
      coalesce(100.0 * count(*) filter (where sentiment = 'positive') / nullif(count(*), 0), 0)::numeric as positive_share
    from current_selected
  ), previous_summary as (
    select (select count(*) from previous_reviews)::numeric as text_reviews,
      (select count(distinct review_id) from previous_matches)::numeric as classified_reviews,
      count(*)::numeric as mentions,
      coalesce(avg(rating), 0)::numeric as average_rating,
      coalesce(100.0 * count(*) filter (where sentiment = 'negative') / nullif(count(*), 0), 0)::numeric as negative_share,
      coalesce(100.0 * count(*) filter (where sentiment = 'neutral') / nullif(count(*), 0), 0)::numeric as neutral_share,
      coalesce(100.0 * count(*) filter (where sentiment = 'positive') / nullif(count(*), 0), 0)::numeric as positive_share
    from previous_selected
  ), topic_rows as (
    select active_topics.id, count(current_matches.review_id)::bigint as mentions,
      coalesce(100.0 * count(current_matches.review_id) / nullif((select count(*) from current_reviews), 0), 0)::numeric as share,
      coalesce(100.0 * count(current_matches.review_id) filter (where current_matches.sentiment = 'positive') / nullif(count(current_matches.review_id), 0), 0)::numeric
        + coalesce(50.0 * count(current_matches.review_id) filter (where current_matches.sentiment = 'neutral') / nullif(count(current_matches.review_id), 0), 0)::numeric as topic_score
    from active_topics left join current_matches on current_matches.topic_id = active_topics.id
    group by active_topics.id
  ), medians as (
    select coalesce(percentile_cont(0.5) within group (order by share) filter (where mentions > 0), 0)::numeric as share,
      coalesce(percentile_cont(0.5) within group (order by topic_score) filter (where mentions > 0), 50)::numeric as topic_score
    from topic_rows
  )
  select case when not public.is_admin() then null else jsonb_build_object(
    'granularity', (select granularity from period),
    'selected_topic_id', (select topic_id from selection),
    'trend', coalesce((select jsonb_agg(jsonb_build_object(
      'date', bucket_date, 'text_reviews', text_reviews, 'classified_reviews', classified_reviews,
      'mentions', mentions, 'topic_share', topic_share, 'average_rating', average_rating,
      'negative_share', negative_share, 'positive_share', positive_share, 'topic_score', topic_score
    ) order by bucket_date) from trend_rows), '[]'::jsonb),
    'medians', jsonb_build_object('share', medians.share, 'topic_score', medians.topic_score),
    'comparisons', jsonb_build_object(
      'text_reviews', jsonb_build_object('current', current_summary.text_reviews, 'previous', previous_summary.text_reviews,
        'delta', current_summary.text_reviews - previous_summary.text_reviews,
        'delta_percent', coalesce(100.0 * (current_summary.text_reviews - previous_summary.text_reviews) / nullif(previous_summary.text_reviews, 0), 0)),
      'classified_reviews', jsonb_build_object('current', current_summary.classified_reviews, 'previous', previous_summary.classified_reviews,
        'delta', current_summary.classified_reviews - previous_summary.classified_reviews,
        'delta_percent', coalesce(100.0 * (current_summary.classified_reviews - previous_summary.classified_reviews) / nullif(previous_summary.classified_reviews, 0), 0)),
      'mentions', jsonb_build_object('current', current_summary.mentions, 'previous', previous_summary.mentions,
        'delta', current_summary.mentions - previous_summary.mentions,
        'delta_percent', coalesce(100.0 * (current_summary.mentions - previous_summary.mentions) / nullif(previous_summary.mentions, 0), 0)),
      'topic_score', jsonb_build_object('current', current_summary.positive_share + current_summary.neutral_share * 0.5,
        'previous', previous_summary.positive_share + previous_summary.neutral_share * 0.5,
        'delta', (current_summary.positive_share + current_summary.neutral_share * 0.5) - (previous_summary.positive_share + previous_summary.neutral_share * 0.5)),
      'negative_share', jsonb_build_object('current', current_summary.negative_share, 'previous', previous_summary.negative_share,
        'delta', current_summary.negative_share - previous_summary.negative_share),
      'average_rating', jsonb_build_object('current', current_summary.average_rating, 'previous', previous_summary.average_rating,
        'delta', current_summary.average_rating - previous_summary.average_rating)
    )
  ) end
  from current_summary cross join previous_summary cross join medians;
$$;

revoke all on function public.get_cx_topic_timeseries(date, date, text[], text[], smallint, uuid, text) from public;
grant execute on function public.get_cx_topic_timeseries(date, date, text[], text[], smallint, uuid, text) to authenticated;
