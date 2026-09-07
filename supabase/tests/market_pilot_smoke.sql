begin;

create temporary table market_smoke_batches (
  label text primary key,
  batch_id uuid not null
) on commit drop;

grant select, insert on market_smoke_batches to authenticated;

do $$
declare
  v_user_id uuid;
begin
  select ua.user_id
  into strict v_user_id
  from app.user_access ua
  where ua.access_role = 'admin'
    and ua.is_active;

  perform set_config('request.jwt.claim.sub', v_user_id::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
end
$$;

set local role authenticated;

do $$
declare
  v_created jsonb;
  v_duplicate jsonb;
  v_batch_id uuid;
  v_object_path text;
  v_result jsonb;
  v_day record;
  v_month record;
begin
  v_created := public.v5_market_create_batch(
    '__v5_market_smoke_initial.xlsx',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    128,
    repeat('1', 64)
  );
  v_batch_id := (v_created ->> 'batch_id')::uuid;
  v_object_path := v_created ->> 'object_path';

  if (v_created ->> 'duplicate')::boolean or v_created ->> 'status' <> 'created' then
    raise exception 'Initial market batch creation assertion failed';
  end if;

  v_duplicate := public.v5_market_create_batch(
    '__v5_market_smoke_duplicate.xlsx',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    128,
    repeat('1', 64)
  );

  if not (v_duplicate ->> 'duplicate')::boolean
    or (v_duplicate ->> 'batch_id')::uuid <> v_batch_id
  then
    raise exception 'Market batch idempotency assertion failed';
  end if;

  insert into storage.objects (bucket_id, name, owner_id)
  values ('v5-import-sources', v_object_path, auth.uid()::text);

  perform public.v5_market_stage_rows(
    v_batch_id,
    jsonb_build_array(
      jsonb_build_object(
        'sheet_name', 'Рынок',
        'row_number', 999,
        'payload', jsonb_build_object(
          'date', '2025-01-01',
          'market_ordered_amount', 1,
          'own_ordered_amount', 1,
          'market_orders', 1,
          'own_orders', 1
        )
      )
    )
  );

  v_result := public.v5_market_reset_staging(v_batch_id);
  if v_result ->> 'status' <> 'uploaded'
    or (v_result ->> 'cleared_rows')::integer <> 1
    or exists (select 1 from ingest.import_rows row_data where row_data.batch_id = v_batch_id)
    or not exists (
      select 1
      from ingest.import_batches batch
      where batch.id = v_batch_id
        and batch.uploaded_at is not null
    )
  then
    raise exception 'Market staging reset assertion failed: %', v_result;
  end if;

  v_result := public.v5_market_stage_rows(
    v_batch_id,
    jsonb_build_array(
      jsonb_build_object(
        'sheet_name', 'Рынок',
        'row_number', 2,
        'payload', jsonb_build_object(
          'date', '2026-06-01',
          'market_ordered_amount', 49526859,
          'own_ordered_amount', 3904149,
          'amount_share', 7.88,
          'market_orders', 15248,
          'own_orders', 2101,
          'orders_share', 13.8,
          'own_avg_check', 1858,
          'market_avg_check', 3248
        )
      ),
      jsonb_build_object(
        'sheet_name', 'Рынок',
        'row_number', 3,
        'payload', jsonb_build_object(
          'date', '2026-06-02',
          'market_ordered_amount', 50617556,
          'own_ordered_amount', 3814588,
          'amount_share', 7.54,
          'market_orders', 15598,
          'own_orders', 2144,
          'orders_share', 13.7,
          'own_avg_check', 1779,
          'market_avg_check', 3245
        )
      )
    )
  );

  if v_result ->> 'status' <> 'validating'
    or (v_result ->> 'total_rows')::integer <> 2
  then
    raise exception 'Market row staging assertion failed';
  end if;

  v_result := public.v5_market_publish_batch(v_batch_id);
  if v_result ->> 'status' <> 'published'
    or (v_result ->> 'accepted_rows')::integer <> 2
  then
    raise exception 'Market publishing assertion failed: %', v_result;
  end if;

  v_result := public.v5_market_batch_summary(v_batch_id);
  if v_result ->> 'status' <> 'published'
    or not (v_result ->> 'source_file_retained')::boolean
    or (v_result ->> 'accepted_rows')::integer <> 2
  then
    raise exception 'Market batch summary assertion failed: %', v_result;
  end if;

  select *
  into strict v_day
  from public.v5_market_series('2026-06-01', '2026-06-01', 'day');

  if v_day.market_ordered_amount <> 49526859
    or v_day.own_ordered_amount <> 3904149
    or v_day.market_orders <> 15248
    or v_day.own_orders <> 2101
    or v_day.own_avg_check <> 1858
    or v_day.market_avg_check <> 3248
  then
    raise exception 'Daily market series assertion failed';
  end if;

  select *
  into strict v_month
  from public.v5_market_series('2026-06-01', '2026-06-30', 'month');

  if v_month.market_ordered_amount <> 100144415
    or v_month.own_ordered_amount <> 7718737
    or v_month.market_orders <> 30846
    or v_month.own_orders <> 4245
    or round(v_month.amount_share, 8) <> round(7718737::numeric / 100144415 * 100, 8)
    or round(v_month.orders_share, 8) <> round(4245::numeric / 30846 * 100, 8)
  then
    raise exception 'Monthly market aggregation assertion failed';
  end if;

  insert into market_smoke_batches (label, batch_id)
  values ('initial', v_batch_id);
end
$$;

do $$
declare
  v_created jsonb;
  v_batch_id uuid;
  v_result jsonb;
  v_current_own numeric;
begin
  v_created := public.v5_market_create_batch(
    '__v5_market_smoke_replacement.csv',
    'text/csv',
    64,
    repeat('2', 64)
  );
  v_batch_id := (v_created ->> 'batch_id')::uuid;

  insert into storage.objects (bucket_id, name, owner_id)
  values ('v5-import-sources', v_created ->> 'object_path', auth.uid()::text);

  perform public.v5_market_stage_rows(
    v_batch_id,
    jsonb_build_array(
      jsonb_build_object(
        'sheet_name', 'Рынок',
        'row_number', 2,
        'payload', jsonb_build_object(
          'date', '2026-06-01',
          'market_ordered_amount', 49526859,
          'own_ordered_amount', 4000000,
          'market_orders', 15248,
          'own_orders', 2200
        )
      )
    )
  );
  v_result := public.v5_market_publish_batch(v_batch_id);

  select data.own_ordered_amount
  into strict v_current_own
  from public.v5_market_series('2026-06-01', '2026-06-01', 'day') data;

  if v_result ->> 'status' <> 'published' or v_current_own <> 4000000 then
    raise exception 'Latest published market version assertion failed';
  end if;

  v_result := public.v5_market_rollback_batch(v_batch_id, 'transactional smoke');

  select data.own_ordered_amount
  into strict v_current_own
  from public.v5_market_series('2026-06-01', '2026-06-01', 'day') data;

  if v_result ->> 'status' <> 'cancelled' or v_current_own <> 3904149 then
    raise exception 'Market rollback assertion failed';
  end if;

  insert into market_smoke_batches (label, batch_id)
  values ('replacement', v_batch_id);
end
$$;

do $$
declare
  v_created jsonb;
  v_batch_id uuid;
  v_result jsonb;
begin
  v_created := public.v5_market_create_batch(
    '__v5_market_smoke_invalid.xlsx',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    64,
    repeat('3', 64)
  );
  v_batch_id := (v_created ->> 'batch_id')::uuid;

  insert into storage.objects (bucket_id, name, owner_id)
  values ('v5-import-sources', v_created ->> 'object_path', auth.uid()::text);

  perform public.v5_market_stage_rows(
    v_batch_id,
    jsonb_build_array(
      jsonb_build_object(
        'sheet_name', 'Рынок',
        'row_number', 2,
        'payload', jsonb_build_object(
          'date', '2026-02-30',
          'market_ordered_amount', 'not-a-number',
          'own_ordered_amount', -1,
          'market_orders', 1.5,
          'own_orders', 1,
          'amount_share', 101
        )
      )
    )
  );
  v_result := public.v5_market_publish_batch(v_batch_id);

  if v_result ->> 'status' <> 'failed'
    or (v_result ->> 'rejected_rows')::integer <> 1
    or (v_result ->> 'error_count')::integer < 5
  then
    raise exception 'Invalid market row assertion failed: %', v_result;
  end if;

  insert into market_smoke_batches (label, batch_id)
  values ('invalid', v_batch_id);
end
$$;

select jsonb_build_object(
  'valid_publish', exists (
    select 1
    from ingest.import_batches batch
    join market_smoke_batches smoke on smoke.batch_id = batch.id
    where smoke.label = 'initial' and batch.status = 'published'
  ),
  'replacement_rollback', exists (
    select 1
    from ingest.import_batches batch
    join market_smoke_batches smoke on smoke.batch_id = batch.id
    where smoke.label = 'replacement' and batch.status = 'cancelled'
  ),
  'invalid_row_rejected', exists (
    select 1
    from ingest.import_batches batch
    join market_smoke_batches smoke on smoke.batch_id = batch.id
    where smoke.label = 'invalid' and batch.status = 'failed' and batch.rejected_rows = 1
  ),
  'history_contains_smoke_batches', jsonb_array_length(public.v5_market_batch_history(20)) >= 3,
  'history_source_paths_present', not exists (
    select 1
    from jsonb_array_elements(public.v5_market_batch_history(20)) history_item
    where not (history_item ? 'object_path')
  ),
  'invalid_error_detail_available', jsonb_array_length(public.v5_market_batch_errors((select batch_id from market_smoke_batches where label = 'invalid'), 100)) >= 5,
  'published_event_timeline_available', jsonb_array_length(public.v5_market_batch_events((select batch_id from market_smoke_batches where label = 'initial'), 100)) >= 3,
  'failed_event_timeline_available', jsonb_array_length(public.v5_market_batch_events((select batch_id from market_smoke_batches where label = 'invalid'), 100)) >= 3,
  'published_day_count', (select day_count from public.v5_market_date_bounds()),
  'transaction_will_rollback', true
) as market_pilot_smoke;

rollback;
