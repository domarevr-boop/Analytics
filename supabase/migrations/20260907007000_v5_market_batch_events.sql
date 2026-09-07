begin;

create or replace function public.v5_market_batch_events(
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
    raise exception 'Market batch event limit must be between 1 and 200';
  end if;

  select coalesce(jsonb_agg(to_jsonb(event_row) order by event_row.created_at, event_row.event_id), '[]'::jsonb)
  into v_result
  from (
    select
      event.id as event_id,
      event.status,
      event.message,
      event.details,
      event.created_at
    from ingest.import_events event
    where event.batch_id = p_batch_id
    order by event.created_at desc, event.id desc
    limit p_limit
  ) event_row;

  return v_result;
end
$$;

revoke all on function public.v5_market_batch_events(uuid, integer) from public, anon;
grant execute on function public.v5_market_batch_events(uuid, integer) to authenticated;

create or replace function public.v5_health()
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select jsonb_build_object(
    'environment', 'analytics-v5',
    'schema_version', '20260907007000',
    'status', 'ok'
  )
$$;

revoke all on function public.v5_health() from public;
grant execute on function public.v5_health() to anon, authenticated;

comment on function public.v5_market_batch_events(uuid, integer) is 'Bounded chronological lifecycle events for one accessible V5 Market import batch.';

commit;
