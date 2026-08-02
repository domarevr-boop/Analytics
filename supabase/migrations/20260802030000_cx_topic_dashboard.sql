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
    select id, version_number
    from public.cx_dictionary_versions
    where status = 'published' and analysis_status = 'completed'
    limit 1
  ), filtered_reviews as materialized (
    select reviews.*
    from public.reviews as reviews
    where public.is_admin()
      and (p_date_from is null or reviews.review_date >= p_date_from)
      and (p_date_to is null or reviews.review_date <= p_date_to)
      and (p_cabinets is null or reviews.cabinet_name = any(p_cabinets))
      and (p_product_ids is null or reviews.local_product_id = any(p_product_ids))
      and (p_rating is null or reviews.rating = p_rating)
  ), filtered_matches as materialized (
    select matches.review_id, matches.topic_id, matches.match_count, reviews.review_date,
      reviews.local_product_id, reviews.seller_sku, reviews.wb_sku, reviews.product_name,
      reviews.cabinet_name, reviews.rating
    from public.cx_review_topic_matches as matches
    join published on published.id = matches.dictionary_version_id
    join filtered_reviews as reviews on reviews.id = matches.review_id
  ), topic_rows as (
    select topics.id, revisions.name, groups.name as group_name, groups.sort_order as group_sort,
      topics.sort_order,
      count(matches.review_id)::bigint as review_count,
      coalesce(sum(matches.match_count), 0)::bigint as rule_matches,
      coalesce(avg(matches.rating), 0)::numeric as average_rating,
      coalesce(100.0 * count(matches.review_id) filter (where matches.rating <= 3) / nullif(count(matches.review_id), 0), 0)::numeric as negative_share,
      coalesce(100.0 * count(matches.review_id) filter (where matches.rating >= 4) / nullif(count(matches.review_id), 0), 0)::numeric as positive_share
    from published
    join public.cx_topic_revisions as revisions on revisions.dictionary_version_id = published.id and revisions.is_active
    join public.cx_topics as topics on topics.id = revisions.topic_id
    join public.cx_topic_groups as groups on groups.id = revisions.group_id
    left join filtered_matches as matches on matches.topic_id = topics.id
    group by topics.id, revisions.name, groups.name, groups.sort_order, topics.sort_order
  ), selected_matches as (
    select matches.*
    from filtered_matches as matches
    where p_topic_id is null or matches.topic_id = p_topic_id
  ), daily_rows as (
    select selected_matches.review_date,
      count(*)::bigint as mentions,
      count(distinct selected_matches.review_id)::bigint as reviews,
      avg(selected_matches.rating)::numeric as average_rating,
      coalesce(100.0 * count(*) filter (where selected_matches.rating <= 3) / nullif(count(*), 0), 0)::numeric as negative_share
    from selected_matches
    group by selected_matches.review_date
  ), product_rows as (
    select coalesce(selected_matches.local_product_id,
      selected_matches.cabinet_name || '|' || coalesce(selected_matches.seller_sku, '') || '|' || coalesce(selected_matches.wb_sku, '')) as entity_key,
      max(selected_matches.local_product_id) as local_product_id,
      max(selected_matches.seller_sku) as seller_sku,
      max(selected_matches.wb_sku) as wb_sku,
      max(selected_matches.product_name) as product_name,
      max(selected_matches.cabinet_name) as cabinet_name,
      count(*)::bigint as mentions,
      avg(selected_matches.rating)::numeric as average_rating,
      coalesce(100.0 * count(*) filter (where selected_matches.rating <= 3) / nullif(count(*), 0), 0)::numeric as negative_share
    from selected_matches
    group by coalesce(selected_matches.local_product_id,
      selected_matches.cabinet_name || '|' || coalesce(selected_matches.seller_sku, '') || '|' || coalesce(selected_matches.wb_sku, ''))
    order by count(*) desc, negative_share desc
    limit 15
  ), totals as (
    select
      (select count(*) from filtered_reviews)::bigint as text_reviews,
      (select count(distinct review_id) from filtered_matches)::bigint as classified_reviews,
      (select count(*) from filtered_matches)::bigint as topic_mentions,
      (select coalesce(avg(rating), 0) from selected_matches)::numeric as average_rating,
      (select coalesce(100.0 * count(*) filter (where rating <= 3) / nullif(count(*), 0), 0) from selected_matches)::numeric as negative_share
  )
  select case when not public.is_admin() then null else jsonb_build_object(
    'version', coalesce((select version_number from published), 0),
    'selected_topic_id', p_topic_id,
    'summary', jsonb_build_object(
      'text_reviews', totals.text_reviews,
      'classified_reviews', totals.classified_reviews,
      'topic_mentions', totals.topic_mentions,
      'coverage', coalesce(100.0 * totals.classified_reviews / nullif(totals.text_reviews, 0), 0),
      'average_rating', totals.average_rating,
      'negative_share', totals.negative_share
    ),
    'topics', coalesce((select jsonb_agg(jsonb_build_object(
      'id', topic_rows.id, 'name', topic_rows.name, 'group_name', topic_rows.group_name,
      'review_count', topic_rows.review_count, 'rule_matches', topic_rows.rule_matches,
      'share', coalesce(100.0 * topic_rows.review_count / nullif(totals.text_reviews, 0), 0),
      'average_rating', topic_rows.average_rating, 'negative_share', topic_rows.negative_share,
      'positive_share', topic_rows.positive_share
    ) order by topic_rows.review_count desc, topic_rows.group_sort, topic_rows.sort_order) from topic_rows), '[]'::jsonb),
    'trend', coalesce((select jsonb_agg(jsonb_build_object(
      'date', daily_rows.review_date, 'mentions', daily_rows.mentions, 'reviews', daily_rows.reviews,
      'average_rating', daily_rows.average_rating, 'negative_share', daily_rows.negative_share
    ) order by daily_rows.review_date) from daily_rows), '[]'::jsonb),
    'products', coalesce((select jsonb_agg(to_jsonb(product_rows) order by product_rows.mentions desc) from product_rows), '[]'::jsonb)
  ) from totals end;
$$;

revoke all on function public.get_cx_topic_dashboard(date, date, text[], text[], smallint, uuid) from public;
grant execute on function public.get_cx_topic_dashboard(date, date, text[], text[], smallint, uuid) to authenticated;
