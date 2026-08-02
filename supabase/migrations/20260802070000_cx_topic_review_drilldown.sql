create or replace function public.get_cx_topic_reviews_page(
  p_topic_id uuid,
  p_sentiment text default null,
  p_date_from date default null,
  p_date_to date default null,
  p_cabinets text[] default null,
  p_product_ids text[] default null,
  p_rating smallint default null,
  p_limit integer default 20,
  p_offset integer default 0
)
returns table (
  id uuid,
  review_date date,
  local_product_id text,
  cabinet_name text,
  seller_sku text,
  wb_sku text,
  product_name text,
  product_category text,
  product_group_names jsonb,
  reported_brand text,
  rating smallint,
  review_text text,
  advantages text,
  disadvantages text,
  seller_response text,
  helpful_up integer,
  helpful_down integer,
  product_match_status text,
  sentiment text,
  matched_rules jsonb,
  total_count bigint
)
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
  )
  select reviews.id, reviews.review_date, reviews.local_product_id, reviews.cabinet_name,
    reviews.seller_sku, reviews.wb_sku, reviews.product_name, reviews.product_category,
    reviews.product_group_names, reviews.reported_brand, reviews.rating, reviews.review_text,
    reviews.advantages, reviews.disadvantages, reviews.seller_response,
    reviews.helpful_up, reviews.helpful_down, reviews.product_match_status,
    matches.sentiment, matches.matched_rules, count(*) over()::bigint
  from public.cx_review_topic_matches as matches
  join published on published.id = matches.dictionary_version_id
  join public.reviews as reviews on reviews.id = matches.review_id
  where public.is_admin()
    and matches.topic_id = p_topic_id
    and (p_sentiment is null or matches.sentiment = p_sentiment)
    and (p_date_from is null or reviews.review_date >= p_date_from)
    and (p_date_to is null or reviews.review_date <= p_date_to)
    and (p_cabinets is null or reviews.cabinet_name = any(p_cabinets))
    and (p_product_ids is null or reviews.local_product_id = any(p_product_ids))
    and (p_rating is null or reviews.rating = p_rating)
  order by reviews.review_date desc, reviews.id desc
  limit greatest(1, least(coalesce(p_limit, 20), 50))
  offset greatest(0, coalesce(p_offset, 0));
$$;

revoke all on function public.get_cx_topic_reviews_page(uuid, text, date, date, text[], text[], smallint, integer, integer) from public;
grant execute on function public.get_cx_topic_reviews_page(uuid, text, date, date, text[], text[], smallint, integer, integer) to authenticated;
