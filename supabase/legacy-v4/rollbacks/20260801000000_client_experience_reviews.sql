-- Run manually only when the Client Experience experiment must be fully removed.
drop function if exists public.verify_review_import_batch(uuid);
drop table if exists public.review_fragments;
drop table if exists public.empty_review_stats;
drop table if exists public.reviews;
drop table if exists public.review_row_registry;
drop table if exists public.review_import_batches;
delete from storage.objects where bucket_id = 'cx-review-imports';
delete from storage.buckets where id = 'cx-review-imports';
