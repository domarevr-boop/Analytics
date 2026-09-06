create or replace function public.cx_context_sentiment(
  p_lemmatized_text text,
  p_anchor_terms text[] default null,
  p_window integer default 6
)
returns table (sentiment text, sentiment_score integer, positive_hits integer, negative_hits integer)
language sql
stable
set search_path = public
as $$
  with token_rows as materialized (
    select token, position::integer
    from unnest(regexp_split_to_array(lower(btrim(coalesce(p_lemmatized_text, ''))), '\s+'))
      with ordinality as source(token, position)
    where token <> ''
  ), anchor_rows as materialized (
    select tokens.position
    from token_rows as tokens
    where coalesce(array_length(p_anchor_terms, 1), 0) > 0
      and tokens.token = any(p_anchor_terms)
  ), scored as (
    select case when exists (
      select 1 from token_rows as previous
      where previous.position between tokens.position - 3 and tokens.position - 1
        and previous.token in ('не', 'ни', 'нет', 'без')
    ) then -lexicon.score else lexicon.score end as contribution
    from token_rows as tokens
    join public.cx_sentiment_lexicon as lexicon
      on lexicon.lemma = tokens.token and lexicon.is_active
    where not exists (select 1 from anchor_rows)
      or exists (
        select 1 from anchor_rows as anchors
        where abs(tokens.position - anchors.position) <= greatest(coalesce(p_window, 6), 1)
      )
  ), totals as (
    select coalesce(sum(contribution), 0)::integer as score,
      count(*) filter (where contribution > 0)::integer as positives,
      count(*) filter (where contribution < 0)::integer as negatives
    from scored
  )
  select case when totals.score > 0 then 'positive'
      when totals.score < 0 then 'negative' else 'neutral' end,
    totals.score, totals.positives, totals.negatives
  from totals;
$$;

revoke all on function public.cx_context_sentiment(text, text[], integer) from public;
grant execute on function public.cx_context_sentiment(text, text[], integer) to authenticated;
