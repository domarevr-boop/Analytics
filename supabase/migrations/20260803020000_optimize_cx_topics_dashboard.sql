create index if not exists reviews_cx_dashboard_filter_idx
  on public.reviews (review_date, cabinet_name, local_product_id, rating, id);

create index if not exists cx_review_topic_matches_version_review_cover_idx
  on public.cx_review_topic_matches (dictionary_version_id, review_id)
  include (topic_id, sentiment, match_count);

create index if not exists cx_review_topic_matches_version_topic_sentiment_idx
  on public.cx_review_topic_matches (dictionary_version_id, topic_id, sentiment, review_id);

alter function public.get_cx_topics_workspace(date, date, text[], text[], smallint, uuid)
  set statement_timeout = '45s';

alter function public.get_cx_topic_timeseries(date, date, text[], text[], smallint, uuid, text)
  set statement_timeout = '45s';

analyze public.reviews;
analyze public.cx_review_topic_matches;
