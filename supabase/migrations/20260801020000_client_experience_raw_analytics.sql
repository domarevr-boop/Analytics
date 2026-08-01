create or replace function public.get_cx_review_summary(
  p_date_from date default null,
  p_date_to date default null,
  p_cabinets text[] default null,
  p_product_ids text[] default null,
  p_rating smallint default null
)
returns table (
  total_reviews bigint,
  text_reviews bigint,
  empty_reviews bigint,
  average_rating numeric,
  negative_reviews bigint,
  answered_reviews bigint,
  matched_reviews bigint
)
language sql
stable
security definer
set search_path = public
as $$
  with review_rows as (
    select rating::numeric as rating, 1::bigint as row_count, true as has_text,
      (seller_response is not null and btrim(seller_response) <> '') as is_answered,
      (local_product_id is not null) as is_matched
    from public.reviews
    where public.is_admin()
      and (p_date_from is null or review_date >= p_date_from)
      and (p_date_to is null or review_date <= p_date_to)
      and (p_cabinets is null or cabinet_name = any(p_cabinets))
      and (p_product_ids is null or local_product_id = any(p_product_ids))
      and (p_rating is null or rating = p_rating)
  ), empty_rows as (
    select rating::numeric as rating, review_count::bigint as row_count, false as has_text,
      false as is_answered, (local_product_id is not null) as is_matched
    from public.empty_review_stats
    where public.is_admin()
      and (p_date_from is null or review_date >= p_date_from)
      and (p_date_to is null or review_date <= p_date_to)
      and (p_cabinets is null or cabinet_name = any(p_cabinets))
      and (p_product_ids is null or local_product_id = any(p_product_ids))
      and (p_rating is null or rating = p_rating)
  ), rows as (
    select * from review_rows union all select * from empty_rows
  )
  select
    coalesce(sum(row_count), 0)::bigint,
    coalesce(sum(row_count) filter (where has_text), 0)::bigint,
    coalesce(sum(row_count) filter (where not has_text), 0)::bigint,
    coalesce(sum(rating * row_count) / nullif(sum(row_count), 0), 0)::numeric,
    coalesce(sum(row_count) filter (where rating <= 3), 0)::bigint,
    coalesce(sum(row_count) filter (where is_answered), 0)::bigint,
    coalesce(sum(row_count) filter (where is_matched), 0)::bigint
  from rows;
$$;

create or replace function public.get_cx_review_trend(
  p_date_from date default null,
  p_date_to date default null,
  p_cabinets text[] default null,
  p_product_ids text[] default null,
  p_rating smallint default null
)
returns table (
  review_date date,
  total_reviews bigint,
  text_reviews bigint,
  empty_reviews bigint,
  average_rating numeric,
  negative_share numeric
)
language sql
stable
security definer
set search_path = public
as $$
  with rows as (
    select reviews.review_date, reviews.rating::numeric as rating, 1::bigint as row_count, true as has_text
    from public.reviews
    where public.is_admin()
      and (p_date_from is null or reviews.review_date >= p_date_from)
      and (p_date_to is null or reviews.review_date <= p_date_to)
      and (p_cabinets is null or reviews.cabinet_name = any(p_cabinets))
      and (p_product_ids is null or reviews.local_product_id = any(p_product_ids))
      and (p_rating is null or reviews.rating = p_rating)
    union all
    select stats.review_date, stats.rating::numeric, stats.review_count::bigint, false
    from public.empty_review_stats as stats
    where public.is_admin()
      and (p_date_from is null or stats.review_date >= p_date_from)
      and (p_date_to is null or stats.review_date <= p_date_to)
      and (p_cabinets is null or stats.cabinet_name = any(p_cabinets))
      and (p_product_ids is null or stats.local_product_id = any(p_product_ids))
      and (p_rating is null or stats.rating = p_rating)
  )
  select rows.review_date,
    sum(row_count)::bigint,
    coalesce(sum(row_count) filter (where has_text), 0)::bigint,
    coalesce(sum(row_count) filter (where not has_text), 0)::bigint,
    (sum(rating * row_count) / nullif(sum(row_count), 0))::numeric,
    (100 * sum(row_count) filter (where rating <= 3) / nullif(sum(row_count), 0))::numeric
  from rows
  group by rows.review_date
  order by rows.review_date;
$$;

create or replace function public.get_cx_rating_distribution(
  p_date_from date default null,
  p_date_to date default null,
  p_cabinets text[] default null,
  p_product_ids text[] default null,
  p_rating smallint default null
)
returns table (rating smallint, review_count bigint)
language sql
stable
security definer
set search_path = public
as $$
  with rows as (
    select reviews.rating, 1::bigint as row_count
    from public.reviews
    where public.is_admin()
      and (p_date_from is null or reviews.review_date >= p_date_from)
      and (p_date_to is null or reviews.review_date <= p_date_to)
      and (p_cabinets is null or reviews.cabinet_name = any(p_cabinets))
      and (p_product_ids is null or reviews.local_product_id = any(p_product_ids))
      and (p_rating is null or reviews.rating = p_rating)
    union all
    select stats.rating, stats.review_count::bigint
    from public.empty_review_stats as stats
    where public.is_admin()
      and (p_date_from is null or stats.review_date >= p_date_from)
      and (p_date_to is null or stats.review_date <= p_date_to)
      and (p_cabinets is null or stats.cabinet_name = any(p_cabinets))
      and (p_product_ids is null or stats.local_product_id = any(p_product_ids))
      and (p_rating is null or stats.rating = p_rating)
  )
  select rows.rating, sum(row_count)::bigint
  from rows group by rows.rating order by rows.rating desc;
$$;

create or replace function public.get_cx_problem_products(
  p_date_from date default null,
  p_date_to date default null,
  p_cabinets text[] default null,
  p_product_ids text[] default null,
  p_rating smallint default null,
  p_limit integer default 12
)
returns table (
  entity_key text,
  local_product_id text,
  seller_sku text,
  wb_sku text,
  product_name text,
  cabinet_name text,
  review_count bigint,
  average_rating numeric,
  negative_reviews bigint,
  negative_share numeric
)
language sql
stable
security definer
set search_path = public
as $$
  with rows as (
    select coalesce(reviews.local_product_id, reviews.cabinet_name || '|' || coalesce(reviews.seller_sku, '') || '|' || coalesce(reviews.wb_sku, '')) as entity_key,
      reviews.local_product_id, reviews.seller_sku, reviews.wb_sku, reviews.product_name, reviews.cabinet_name,
      reviews.rating::numeric as rating, 1::bigint as row_count
    from public.reviews
    where public.is_admin()
      and (p_date_from is null or reviews.review_date >= p_date_from)
      and (p_date_to is null or reviews.review_date <= p_date_to)
      and (p_cabinets is null or reviews.cabinet_name = any(p_cabinets))
      and (p_product_ids is null or reviews.local_product_id = any(p_product_ids))
      and (p_rating is null or reviews.rating = p_rating)
    union all
    select coalesce(stats.local_product_id, stats.cabinet_name || '|' || coalesce(stats.seller_sku, '') || '|' || coalesce(stats.wb_sku, '')),
      stats.local_product_id, stats.seller_sku, stats.wb_sku, null::text, stats.cabinet_name,
      stats.rating::numeric, stats.review_count::bigint
    from public.empty_review_stats as stats
    where public.is_admin()
      and (p_date_from is null or stats.review_date >= p_date_from)
      and (p_date_to is null or stats.review_date <= p_date_to)
      and (p_cabinets is null or stats.cabinet_name = any(p_cabinets))
      and (p_product_ids is null or stats.local_product_id = any(p_product_ids))
      and (p_rating is null or stats.rating = p_rating)
  )
  select rows.entity_key,
    max(rows.local_product_id), max(rows.seller_sku), max(rows.wb_sku), max(rows.product_name), max(rows.cabinet_name),
    sum(row_count)::bigint,
    (sum(rating * row_count) / nullif(sum(row_count), 0))::numeric,
    coalesce(sum(row_count) filter (where rating <= 3), 0)::bigint,
    (100 * sum(row_count) filter (where rating <= 3) / nullif(sum(row_count), 0))::numeric
  from rows
  group by rows.entity_key
  having sum(row_count) >= 3
  order by (100 * sum(row_count) filter (where rating <= 3) / nullif(sum(row_count), 0)) desc,
    sum(row_count) desc
  limit greatest(1, least(coalesce(p_limit, 12), 50));
$$;

create or replace function public.get_cx_reviews_page(
  p_date_from date default null,
  p_date_to date default null,
  p_cabinets text[] default null,
  p_product_ids text[] default null,
  p_rating smallint default null,
  p_search text default null,
  p_limit integer default 50,
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
  total_count bigint
)
language sql
stable
security definer
set search_path = public
as $$
  select reviews.id, reviews.review_date, reviews.local_product_id, reviews.cabinet_name,
    reviews.seller_sku, reviews.wb_sku, reviews.product_name, reviews.product_category,
    reviews.product_group_names, reviews.reported_brand, reviews.rating, reviews.review_text,
    reviews.advantages, reviews.disadvantages, reviews.seller_response,
    reviews.helpful_up, reviews.helpful_down, reviews.product_match_status,
    count(*) over()::bigint
  from public.reviews
  where public.is_admin()
    and (p_date_from is null or reviews.review_date >= p_date_from)
    and (p_date_to is null or reviews.review_date <= p_date_to)
    and (p_cabinets is null or reviews.cabinet_name = any(p_cabinets))
    and (p_product_ids is null or reviews.local_product_id = any(p_product_ids))
    and (p_rating is null or reviews.rating = p_rating)
    and (p_search is null or btrim(p_search) = ''
      or reviews.normalized_text ilike '%' || btrim(p_search) || '%'
      or reviews.seller_sku ilike '%' || btrim(p_search) || '%'
      or reviews.wb_sku ilike '%' || btrim(p_search) || '%'
      or reviews.product_name ilike '%' || btrim(p_search) || '%')
  order by reviews.review_date desc, reviews.id desc
  limit greatest(1, least(coalesce(p_limit, 50), 100))
  offset greatest(0, coalesce(p_offset, 0));
$$;

revoke all on function public.get_cx_review_summary(date, date, text[], text[], smallint) from public;
revoke all on function public.get_cx_review_trend(date, date, text[], text[], smallint) from public;
revoke all on function public.get_cx_rating_distribution(date, date, text[], text[], smallint) from public;
revoke all on function public.get_cx_problem_products(date, date, text[], text[], smallint, integer) from public;
revoke all on function public.get_cx_reviews_page(date, date, text[], text[], smallint, text, integer, integer) from public;
grant execute on function public.get_cx_review_summary(date, date, text[], text[], smallint) to authenticated;
grant execute on function public.get_cx_review_trend(date, date, text[], text[], smallint) to authenticated;
grant execute on function public.get_cx_rating_distribution(date, date, text[], text[], smallint) to authenticated;
grant execute on function public.get_cx_problem_products(date, date, text[], text[], smallint, integer) to authenticated;
grant execute on function public.get_cx_reviews_page(date, date, text[], text[], smallint, text, integer, integer) to authenticated;
