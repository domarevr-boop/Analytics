begin;

create temporary table competitor_import_ui_smoke_state (batch_id uuid not null) on commit drop;
grant select, insert on competitor_import_ui_smoke_state to authenticated;

do $$
declare
  v_user_id uuid;
begin
  select access.user_id into strict v_user_id from app.user_access access
  where access.access_role = 'admin' and access.is_active limit 1;
  perform set_config('request.jwt.claim.sub', v_user_id::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
end
$$;

set local role authenticated;

do $$
declare
  v_created jsonb;
  v_result jsonb;
  v_batch_id uuid;
begin
  v_created := public.v5_competitor_create_batch('__v5_competitor_ui_smoke.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 512, repeat('e', 64));
  v_batch_id := (v_created ->> 'batch_id')::uuid;
  insert into storage.objects (bucket_id, name, owner_id) values ('v5-import-sources', v_created ->> 'object_path', auth.uid()::text);
  perform public.v5_competitor_stage_rows(v_batch_id, jsonb_build_array(
    jsonb_build_object('sheet_name', 'search', 'row_number', 7, 'payload', jsonb_build_object(
      'date', '2026-02-30', 'wb_article', '', 'query', '', 'requests', 1.5, 'requests_previous', -1,
      'reported_cart_conversion', -1, 'reported_cart_conversion_previous', 0,
      'reported_order_conversion', 0, 'reported_order_conversion_previous', 0
    ))
  ));
  v_result := public.v5_competitor_publish_batch(v_batch_id);
  if v_result ->> 'status' <> 'failed' then raise exception 'Expected failed fixture batch: %', v_result; end if;
  insert into competitor_import_ui_smoke_state values (v_batch_id);
end
$$;

do $$
declare
  v_batch_id uuid := (select batch_id from competitor_import_ui_smoke_state limit 1);
  v_summary jsonb;
  v_history jsonb;
  v_errors jsonb;
  v_events jsonb;
begin
  v_summary := public.v5_competitor_batch_summary(v_batch_id);
  v_history := public.v5_competitor_batch_history(20);
  v_errors := public.v5_competitor_batch_errors(v_batch_id, 100);
  v_events := public.v5_competitor_batch_events(v_batch_id, 100);
  if v_summary ->> 'status' <> 'failed' or (v_summary ->> 'error_count')::integer < 1 then raise exception 'Summary contract failed: %', v_summary; end if;
  if not exists (select 1 from jsonb_array_elements(v_history) row_data where row_data ->> 'batch_id' = v_batch_id::text and row_data ->> 'object_path' <> '') then raise exception 'History contract failed: %', v_history; end if;
  if jsonb_array_length(v_errors) < 1 or not exists (select 1 from jsonb_array_elements(v_errors) row_data where row_data ->> 'row_number' = '7') then raise exception 'Error contract failed: %', v_errors; end if;
  if jsonb_array_length(v_events) < 3 then raise exception 'Event contract failed: %', v_events; end if;
end
$$;

select jsonb_build_object(
  'summary_bounded_and_visible', true,
  'history_contains_private_source_path', true,
  'errors_bounded_to_batch', true,
  'events_bounded_to_batch', true,
  'transaction_will_rollback', true
) as competitors_import_ui_smoke;

rollback;
