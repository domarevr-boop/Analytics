create or replace function public.verify_review_import_batch(batch_uuid uuid)
returns table (
  verified boolean,
  total_rows integer,
  accounted_rows integer,
  stored_reviews integer,
  stored_empty_rows integer,
  message text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  target public.review_import_batches%rowtype;
  stored_review_count integer;
  stored_empty_count integer;
  stored_registry_count integer;
  accounted integer;
  ok boolean;
  result_message text;
begin
  if not public.is_admin() then
    raise exception 'admin access required';
  end if;

  select * into target from public.review_import_batches where id = batch_uuid for update;
  if not found then raise exception 'review import batch not found'; end if;

  select count(*)::integer into stored_review_count
  from public.reviews where import_batch_id = batch_uuid;

  select coalesce(sum(stats.review_count), 0)::integer into stored_empty_count
  from public.empty_review_stats as stats where stats.import_batch_id = batch_uuid;

  select count(*)::integer into stored_registry_count
  from public.review_row_registry where import_batch_id = batch_uuid;

  accounted := target.text_rows + target.empty_rows + target.duplicate_rows + target.rejected_rows;
  ok := accounted = target.total_rows
    and stored_review_count = target.text_rows
    and stored_empty_count = target.empty_rows
    and stored_registry_count = target.text_rows + target.empty_rows;
  result_message := case when ok then 'all rows reconciled' else 'row reconciliation failed' end;

  update public.review_import_batches
  set status = case when ok then 'completed' else 'verification_failed' end,
      inserted_reviews = stored_review_count,
      inserted_empty_rows = stored_empty_count,
      inserted_registry_rows = stored_registry_count,
      verified_at = now(),
      error_message = case when ok then null else result_message end
  where id = batch_uuid;

  return query
  select ok, target.total_rows, accounted, stored_review_count, stored_empty_count, result_message;
end;
$$;

revoke all on function public.verify_review_import_batch(uuid) from public;
grant execute on function public.verify_review_import_batch(uuid) to authenticated;
