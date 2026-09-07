begin;

create or replace function public.v5_market_batch_errors(
  p_batch_id uuid,
  p_limit integer default 100
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_result jsonb;
begin
  if auth.uid() is null or not app.can_import() then
    raise exception 'V5 importer access is required';
  end if;

  if p_batch_id is null or not app.can_read_batch(p_batch_id) or not exists (
    select 1
    from ingest.import_batches batch
    where batch.id = p_batch_id
      and batch.source_code = 'market_dynamics'
  ) then
    raise exception 'Market batch is not available';
  end if;

  if p_limit is null or p_limit < 1 or p_limit > 200 then
    raise exception 'Market batch error limit must be between 1 and 200';
  end if;

  select coalesce(jsonb_agg(to_jsonb(error_row) order by error_row.sheet_name, error_row.row_number nulls last, error_row.error_id), '[]'::jsonb)
  into v_result
  from (
    select
      error.id as error_id,
      error.sheet_name,
      error.row_number,
      error.column_name,
      error.error_code,
      error.message,
      error.raw_value,
      error.created_at
    from ingest.import_errors error
    where error.batch_id = p_batch_id
    order by error.sheet_name, error.row_number nulls last, error.id
    limit p_limit
  ) error_row;

  return v_result;
end
$$;

revoke all on function public.v5_market_batch_errors(uuid, integer) from public, anon;
grant execute on function public.v5_market_batch_errors(uuid, integer) to authenticated;

create or replace function public.v5_health()
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select jsonb_build_object(
    'environment', 'analytics-v5',
    'schema_version', '20260907005000',
    'status', 'ok'
  )
$$;

revoke all on function public.v5_health() from public;
grant execute on function public.v5_health() to anon, authenticated;

comment on function public.v5_market_batch_errors(uuid, integer) is 'Bounded row-level validation errors for one accessible V5 Market import batch.';

commit;
