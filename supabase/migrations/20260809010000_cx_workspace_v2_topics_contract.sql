-- Preserve the v2 RPC contract: topic arrays contain topic objects only.
-- A legacy workspace payload can include a JSON null element; do not propagate it.
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

  for item in
    select value
    from jsonb_array_elements(coalesce(result->'topics', '[]'::jsonb))
    where jsonb_typeof(value) = 'object' and nullif(value->>'id', '') is not null
  loop
    positive := coalesce((item->>'positive_share')::numeric, 0);
    neutral := coalesce((item->>'neutral_share')::numeric, 0);
    negative := coalesce((item->>'negative_share')::numeric, 0);
    evaluative := coalesce((item->>'review_count')::numeric, 0) * (positive + negative) / 100.0;
    total_evaluative := total_evaluative + evaluative;
  end loop;

  for item in
    select value
    from jsonb_array_elements(coalesce(result->'topics', '[]'::jsonb))
    where jsonb_typeof(value) = 'object' and nullif(value->>'id', '') is not null
  loop
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

revoke all on function public.get_cx_topics_workspace_v2(date, date, text[], text[], smallint, uuid) from public;
grant execute on function public.get_cx_topics_workspace_v2(date, date, text[], text[], smallint, uuid) to authenticated;
