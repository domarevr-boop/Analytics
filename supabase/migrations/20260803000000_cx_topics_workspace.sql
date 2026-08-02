create or replace function public.get_cx_topics_workspace(
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
    select versions.id, versions.version_number,
      coalesce(methodology.config, '{}'::jsonb) as methodology
    from public.cx_dictionary_versions as versions
    left join public.cx_methodology_versions as methodology on methodology.dictionary_version_id = versions.id
    where versions.status = 'published' and versions.analysis_status = 'completed'
    limit 1
  ), period as (
    select
      p_date_from as current_from,
      p_date_to as current_to,
      case when p_date_from is not null and p_date_to is not null
        then p_date_from - (p_date_to - p_date_from + 1) else null end as previous_from,
      case when p_date_from is not null then p_date_from - 1 else null end as previous_to
  ), config as (
    select
      coalesce((published.methodology #>> '{problem_index,exposure_threshold}')::numeric, 0.15) as exposure_threshold,
      coalesce((published.methodology #>> '{problem_index,exposure_weight}')::numeric, 0.40) as exposure_weight,
      coalesce((published.methodology #>> '{problem_index,negativity_weight}')::numeric, 0.35) as negativity_weight,
      coalesce((published.methodology #>> '{problem_index,acceleration_weight}')::numeric, 0.15) as acceleration_weight,
      coalesce((published.methodology #>> '{problem_index,confidence_weight}')::numeric, 0.10) as confidence_weight,
      coalesce((published.methodology ->> 'confident_mentions_threshold')::numeric, 30) as confident_mentions_threshold,
      coalesce((published.methodology #>> '{risk_thresholds,medium}')::numeric, 45) as medium_risk,
      coalesce((published.methodology #>> '{risk_thresholds,high}')::numeric, 70) as high_risk
    from published
  ), active_topics as materialized (
    select topics.id, revisions.name, groups.code as group_code, groups.name as group_name,
      groups.sort_order as group_sort, topics.sort_order
    from published
    join public.cx_topic_revisions as revisions on revisions.dictionary_version_id = published.id and revisions.is_active
    join public.cx_topics as topics on topics.id = revisions.topic_id
    join public.cx_topic_groups as groups on groups.id = revisions.group_id and groups.is_active
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
    select matches.review_id, matches.topic_id, matches.match_count, matches.sentiment, matches.matched_rules,
      reviews.review_date, reviews.local_product_id, reviews.seller_sku, reviews.wb_sku,
      reviews.product_name, reviews.cabinet_name, reviews.rating, reviews.review_text,
      reviews.advantages, reviews.disadvantages
    from public.cx_review_topic_matches as matches
    join published on published.id = matches.dictionary_version_id
    join current_reviews as reviews on reviews.id = matches.review_id
  ), previous_matches as materialized (
    select matches.review_id, matches.topic_id, matches.sentiment
    from public.cx_review_topic_matches as matches
    join published on published.id = matches.dictionary_version_id
    join previous_reviews as reviews on reviews.id = matches.review_id
  ), totals as (
    select
      (select count(*) from current_reviews)::bigint as text_reviews,
      (select count(distinct review_id) from current_matches)::bigint as classified_reviews,
      (select count(*) from current_matches)::bigint as topic_mentions
  ), current_topic_rows as (
    select active_topics.id, active_topics.name, active_topics.group_code, active_topics.group_name,
      active_topics.group_sort, active_topics.sort_order,
      count(current_matches.review_id)::bigint as review_count,
      coalesce(sum(current_matches.match_count), 0)::bigint as rule_matches,
      coalesce(avg(current_matches.rating), 0)::numeric as average_rating,
      coalesce(100.0 * count(current_matches.review_id) filter (where current_matches.sentiment = 'negative')
        / nullif(count(current_matches.review_id), 0), 0)::numeric as negative_share,
      coalesce(100.0 * count(current_matches.review_id) filter (where current_matches.sentiment = 'neutral')
        / nullif(count(current_matches.review_id), 0), 0)::numeric as neutral_share,
      coalesce(100.0 * count(current_matches.review_id) filter (where current_matches.sentiment = 'positive')
        / nullif(count(current_matches.review_id), 0), 0)::numeric as positive_share
    from active_topics
    left join current_matches on current_matches.topic_id = active_topics.id
    group by active_topics.id, active_topics.name, active_topics.group_code, active_topics.group_name,
      active_topics.group_sort, active_topics.sort_order
  ), previous_topic_rows as (
    select active_topics.id,
      count(previous_matches.review_id)::bigint as review_count,
      coalesce(100.0 * count(previous_matches.review_id) filter (where previous_matches.sentiment = 'negative')
        / nullif(count(previous_matches.review_id), 0), 0)::numeric as negative_share,
      coalesce(100.0 * count(previous_matches.review_id) filter (where previous_matches.sentiment = 'neutral')
        / nullif(count(previous_matches.review_id), 0), 0)::numeric as neutral_share,
      coalesce(100.0 * count(previous_matches.review_id) filter (where previous_matches.sentiment = 'positive')
        / nullif(count(previous_matches.review_id), 0), 0)::numeric as positive_share
    from active_topics
    left join previous_matches on previous_matches.topic_id = active_topics.id
    group by active_topics.id
  ), topic_metrics_base as (
    select current_topic_rows.*,
      coalesce(100.0 * current_topic_rows.review_count / nullif(totals.text_reviews, 0), 0)::numeric as share,
      coalesce(100.0 * current_topic_rows.review_count / nullif(totals.topic_mentions, 0), 0)::numeric as weight,
      (current_topic_rows.positive_share + current_topic_rows.neutral_share * 0.5)::numeric as topic_score,
      (previous_topic_rows.positive_share + previous_topic_rows.neutral_share * 0.5)::numeric as previous_topic_score,
      (current_topic_rows.negative_share - previous_topic_rows.negative_share)::numeric as negative_delta,
      previous_topic_rows.review_count as previous_review_count
    from current_topic_rows
    join previous_topic_rows on previous_topic_rows.id = current_topic_rows.id
    cross join totals
  ), topic_metrics as materialized (
    select topic_metrics_base.*,
      (topic_metrics_base.weight / 100.0 * topic_metrics_base.topic_score)::numeric as cxi_contribution,
      (100.0 * least(1, greatest(0,
        (
          config.exposure_weight * least(1, greatest(0, (topic_metrics_base.share / 100.0) / greatest(config.exposure_threshold, 0.000001)))
          + config.negativity_weight * least(1, greatest(0, topic_metrics_base.negative_share / 100.0))
          + config.acceleration_weight * least(1, greatest(0, topic_metrics_base.negative_delta / 100.0))
          + config.confidence_weight * least(1, greatest(0, topic_metrics_base.review_count / greatest(config.confident_mentions_threshold, 1)))
        ) / greatest(config.exposure_weight + config.negativity_weight + config.acceleration_weight + config.confidence_weight, 0.000001)
      )))::numeric as problem_index,
      config.medium_risk, config.high_risk
    from topic_metrics_base cross join config
  ), selection as (
    select coalesce(
      p_topic_id,
      (select id from topic_metrics where review_count > 0 order by review_count desc, group_sort, sort_order limit 1),
      (select id from topic_metrics order by group_sort, sort_order limit 1)
    ) as topic_id
  ), selected_matches as materialized (
    select current_matches.*
    from current_matches cross join selection
    where current_matches.topic_id = selection.topic_id
  ), selected_summary as (
    select count(*)::bigint as topic_mentions,
      coalesce(avg(rating), 0)::numeric as average_rating,
      coalesce(100.0 * count(*) filter (where sentiment = 'negative') / nullif(count(*), 0), 0)::numeric as negative_share,
      coalesce(100.0 * count(*) filter (where sentiment = 'neutral') / nullif(count(*), 0), 0)::numeric as neutral_share,
      coalesce(100.0 * count(*) filter (where sentiment = 'positive') / nullif(count(*), 0), 0)::numeric as positive_share
    from selected_matches
  ), daily_rows as (
    select review_date, count(*)::bigint as mentions, count(distinct review_id)::bigint as reviews,
      coalesce(avg(rating), 0)::numeric as average_rating,
      coalesce(100.0 * count(*) filter (where sentiment = 'negative') / nullif(count(*), 0), 0)::numeric as negative_share,
      coalesce(100.0 * count(*) filter (where sentiment = 'neutral') / nullif(count(*), 0), 0)::numeric as neutral_share,
      coalesce(100.0 * count(*) filter (where sentiment = 'positive') / nullif(count(*), 0), 0)::numeric as positive_share
    from selected_matches group by review_date
  ), product_rows as (
    select coalesce(local_product_id, cabinet_name || '|' || coalesce(seller_sku, '') || '|' || coalesce(wb_sku, '')) as entity_key,
      max(local_product_id) as local_product_id, max(seller_sku) as seller_sku, max(wb_sku) as wb_sku,
      max(product_name) as product_name, max(cabinet_name) as cabinet_name, count(*)::bigint as mentions,
      coalesce(100.0 * count(*) / nullif((select topic_mentions from selected_summary), 0), 0)::numeric as mention_share,
      coalesce(avg(rating), 0)::numeric as average_rating,
      coalesce(100.0 * count(*) filter (where sentiment = 'negative') / nullif(count(*), 0), 0)::numeric as negative_share,
      coalesce(100.0 * count(*) filter (where sentiment = 'positive') / nullif(count(*), 0), 0)::numeric as positive_share
    from selected_matches
    group by coalesce(local_product_id, cabinet_name || '|' || coalesce(seller_sku, '') || '|' || coalesce(wb_sku, ''))
    order by count(*) desc, negative_share desc limit 15
  ), negative_reasons as (
    select coalesce(rule ->> 'pattern', 'Без формулировки') as pattern, count(*)::bigint as mentions
    from selected_matches
    cross join lateral jsonb_array_elements(coalesce(selected_matches.matched_rules, '[]'::jsonb)) as rule
    where selected_matches.sentiment = 'negative'
    group by coalesce(rule ->> 'pattern', 'Без формулировки')
    order by count(*) desc, pattern limit 18
  ), review_examples as (
    select sentiment, review_id, review_date, seller_sku, wb_sku, product_name, rating,
      review_text, advantages, disadvantages
    from (
      select selected_matches.*,
        row_number() over (partition by sentiment order by review_date desc, review_id desc) as row_number
      from selected_matches where sentiment in ('positive', 'negative')
    ) as ranked
    where row_number <= 2
  ), group_rows as (
    select group_code, group_name, group_sort,
      count(*) filter (where review_count > 0)::integer as active_topics,
      coalesce(sum(review_count), 0)::bigint as mentions,
      coalesce(sum(review_count * topic_score) / nullif(sum(review_count), 0), 0)::numeric as cxi,
      coalesce(sum(previous_review_count * previous_topic_score) / nullif(sum(previous_review_count), 0), 0)::numeric as previous_cxi
    from topic_metrics group by group_code, group_name, group_sort
  )
  select case when not public.is_admin() then null else jsonb_build_object(
    'workspace_version', 1,
    'version', coalesce((select version_number from published), 0),
    'selected_topic_id', (select topic_id from selection),
    'summary', jsonb_build_object(
      'text_reviews', totals.text_reviews,
      'classified_reviews', totals.classified_reviews,
      'topic_mentions', selected_summary.topic_mentions,
      'coverage', coalesce(100.0 * totals.classified_reviews / nullif(totals.text_reviews, 0), 0),
      'average_rating', selected_summary.average_rating,
      'negative_share', selected_summary.negative_share,
      'neutral_share', selected_summary.neutral_share,
      'positive_share', selected_summary.positive_share,
      'topic_score', selected_summary.positive_share + selected_summary.neutral_share * 0.5
    ),
    'groups', coalesce((select jsonb_agg(jsonb_build_object(
      'code', group_rows.group_code, 'name', group_rows.group_name, 'active_topics', group_rows.active_topics,
      'mentions', group_rows.mentions, 'cxi', group_rows.cxi,
      'delta', group_rows.cxi - group_rows.previous_cxi,
      'strongest_topic', (select name from topic_metrics where group_code = group_rows.group_code and review_count > 0 order by topic_score desc, review_count desc limit 1),
      'problem_topic', (select name from topic_metrics where group_code = group_rows.group_code and review_count > 0 order by problem_index desc, review_count desc limit 1)
    ) order by group_rows.group_sort) from group_rows), '[]'::jsonb),
    'attention', coalesce((select jsonb_agg(to_jsonb(attention_rows) order by attention_rows.problem_index desc, attention_rows.negative_delta desc)
      from (select id, name, group_name, review_count, negative_share, negative_delta, problem_index,
        case when problem_index >= high_risk then 'high' when problem_index >= medium_risk then 'medium' else 'low' end as risk
        from topic_metrics where review_count > 0 order by problem_index desc, negative_delta desc, review_count desc limit 5) as attention_rows), '[]'::jsonb),
    'topics', coalesce((select jsonb_agg(jsonb_build_object(
      'id', id, 'name', name, 'group_code', group_code, 'group_name', group_name,
      'review_count', review_count, 'rule_matches', rule_matches, 'share', share, 'weight', weight,
      'average_rating', average_rating, 'negative_share', negative_share, 'neutral_share', neutral_share,
      'positive_share', positive_share, 'topic_score', topic_score, 'negative_delta', negative_delta,
      'cxi_contribution', cxi_contribution, 'problem_index', problem_index,
      'risk', case when problem_index >= high_risk then 'high' when problem_index >= medium_risk then 'medium' else 'low' end
    ) order by problem_index desc, review_count desc, group_sort, sort_order) from topic_metrics), '[]'::jsonb),
    'trend', coalesce((select jsonb_agg(jsonb_build_object(
      'date', review_date, 'mentions', mentions, 'reviews', reviews, 'average_rating', average_rating,
      'negative_share', negative_share, 'neutral_share', neutral_share, 'positive_share', positive_share
    ) order by review_date) from daily_rows), '[]'::jsonb),
    'products', coalesce((select jsonb_agg(to_jsonb(product_rows) order by mentions desc) from product_rows), '[]'::jsonb),
    'negative_reasons', coalesce((select jsonb_agg(to_jsonb(negative_reasons) order by mentions desc) from negative_reasons), '[]'::jsonb),
    'examples', coalesce((select jsonb_agg(to_jsonb(review_examples) order by sentiment desc, review_date desc) from review_examples), '[]'::jsonb)
  ) end
  from totals cross join selected_summary;
$$;

revoke all on function public.get_cx_topics_workspace(date, date, text[], text[], smallint, uuid) from public;
grant execute on function public.get_cx_topics_workspace(date, date, text[], text[], smallint, uuid) to authenticated;
