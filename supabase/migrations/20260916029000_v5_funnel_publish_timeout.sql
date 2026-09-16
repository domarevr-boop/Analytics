-- Allow the deliberately bounded funnel publication RPC to finish for full
-- cabinet exports without raising the timeout for unrelated API requests.

begin;

alter function public.v5_funnel_publish_batch(uuid)
  set statement_timeout to '120s';

create or replace function public.v5_health()
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select jsonb_build_object(
    'environment', 'analytics-v5',
    'schema_version', '20260916029000',
    'status', 'ok'
  )
$$;

revoke all on function public.v5_health() from public;
grant execute on function public.v5_health() to anon, authenticated;

comment on function public.v5_funnel_publish_batch(uuid) is
  'Publishes one validated, retained V5 funnel batch. The RPC has a 120-second function-local timeout for full cabinet exports.';

commit;
