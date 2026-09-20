begin;

create temporary table profitability_smoke_ids (label text primary key, value uuid not null) on commit drop;
grant select, insert on profitability_smoke_ids to authenticated;

do $$
declare v_user_id uuid; v_cabinet_id uuid := gen_random_uuid();
begin
  select access.user_id into strict v_user_id from app.user_access access
  where access.access_role = 'admin' and access.is_active limit 1;
  perform set_config('request.jwt.claim.sub', v_user_id::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  insert into core.cabinets (id, external_key, name) values (v_cabinet_id, 'profitability-smoke', 'Profitability smoke');
  insert into profitability_smoke_ids values ('cabinet', v_cabinet_id);
end
$$;

set local role authenticated;

do $$
declare
  v_created jsonb;
  v_result jsonb;
  v_batch_id uuid;
  v_cabinet_id uuid := (select value from profitability_smoke_ids where label = 'cabinet');
begin
  v_created := public.v5_profitability_create_batch(v_cabinet_id, '__profitability.xlsx', null, 100, repeat('e', 64));
  v_batch_id := (v_created ->> 'batch_id')::uuid;
  insert into storage.objects (bucket_id, name, owner_id)
  values ('v5-import-sources', v_created ->> 'object_path', auth.uid()::text);
  perform public.v5_profitability_stage_rows(v_batch_id, jsonb_build_array(jsonb_build_object(
    'row_number', 2,
    'payload', jsonb_build_object(
      'date', '2026-08-01', 'seller_sku', 'PROFIT-SKU.0', 'wb_sku', '880001',
      'quantity', 2.5, 'revenue', 1000, 'cost', 300, 'agent_fee', 100,
      'logistics_cost', 50, 'marketing_cost', 25, 'storage_cost', 25,
      'reported_gross_profit', 500, 'reported_gross_margin', 50
    )
  )));
  v_result := public.v5_profitability_publish_batch(v_batch_id);
  if v_result ->> 'status' <> 'published' or (v_result ->> 'canonical_rows')::integer <> 1 then
    raise exception 'Profitability publish failed: %', v_result;
  end if;
  insert into profitability_smoke_ids values ('batch', v_batch_id);
end
$$;

reset role;

do $$
declare v_row record; v_view_count integer; v_filtered_count integer;
begin
  select * into strict v_row from app.v5_profitability_current(date '2026-08-01', date '2026-08-01');
  if v_row.quantity <> 2.5 or v_row.revenue <> 1000 or v_row.gross_profit <> 500
    or v_row.gross_margin <> 50 or v_row.reported_gross_profit <> 500 or v_row.reported_gross_margin <> 50
  then raise exception 'Profitability generated amounts failed: %', row_to_json(v_row); end if;
  select count(*) into v_view_count from analytics.profitability_current_enriched where date = date '2026-08-01';
  select count(*) into v_filtered_count from app.v5_profitability_filtered(date '2026-08-01', date '2026-08-01');
  if v_view_count <> 1 or v_filtered_count <> 1 then raise exception 'Profitability read path missing: view %, filtered %', v_view_count, v_filtered_count; end if;
end
$$;

set local role authenticated;

do $$
declare
  v_summary record;
  v_row record;
  v_expense jsonb;
  v_cabinet_id uuid := (select value from profitability_smoke_ids where label = 'cabinet');
begin
  select * into strict v_summary from public.v5_profitability_summary(date '2026-08-01', date '2026-08-01');
  if v_summary.gross_profit <> 500 or v_summary.net_profit is not null or v_summary.expenses_configured then
    raise exception 'Profitability summary must keep net metrics null before expense configuration: %', row_to_json(v_summary);
  end if;
  v_expense := public.v5_profitability_set_expense(v_cabinet_id, date '2026-08-01', 10);
  if (v_expense ->> 'expense_pct')::numeric <> 10 then raise exception 'Expense setting failed: %', v_expense; end if;
  select * into strict v_summary from public.v5_profitability_summary(date '2026-08-01', date '2026-08-01');
  if v_summary.expense_amount <> 100 or v_summary.net_profit <> 400 or v_summary.profitability <> 40 or not v_summary.expenses_configured then
    raise exception 'Configured profitability summary is wrong: %', row_to_json(v_summary);
  end if;
  select * into strict v_row from public.v5_profitability_rows(
    date '2026-08-01', date '2026-08-01', array[v_cabinet_id], null, null, null, null, 'PROFIT-SKU', 'net_profit', 0, 10
  );
  if v_row.net_profit <> 400 or v_row.total_count <> 1 then raise exception 'Bounded profitability row is wrong: %', row_to_json(v_row); end if;
end
$$;

do $$
declare
  v_created jsonb;
  v_result jsonb;
  v_batch_id uuid;
  v_cabinet_id uuid := (select value from profitability_smoke_ids where label = 'cabinet');
begin
  v_created := public.v5_profitability_create_batch(v_cabinet_id, '__profitability_invalid.xlsx', null, 100, repeat('f', 64));
  v_batch_id := (v_created ->> 'batch_id')::uuid;
  insert into storage.objects (bucket_id, name, owner_id)
  values ('v5-import-sources', v_created ->> 'object_path', auth.uid()::text);
  perform public.v5_profitability_stage_rows(v_batch_id, jsonb_build_array(jsonb_build_object(
    'row_number', 2,
    'payload', jsonb_build_object(
      'date', '2026-02-30', 'seller_sku', 'INVALID-PROFIT', 'quantity', -1,
      'revenue', 1000, 'agent_fee', 100, 'logistics_cost', 50,
      'marketing_cost', 25, 'storage_cost', 25
    )
  )));
  v_result := public.v5_profitability_publish_batch(v_batch_id);
  if v_result ->> 'status' <> 'failed' or (v_result ->> 'error_count')::integer < 3 then
    raise exception 'Invalid profitability batch was accepted: %', v_result;
  end if;
  if exists (select 1 from core.products product where product.cabinet_id = v_cabinet_id and product.seller_sku = 'INVALID-PROFIT') then
    raise exception 'Invalid profitability row created a product';
  end if;
end
$$;

do $$
declare v_result jsonb; v_batch_id uuid := (select value from profitability_smoke_ids where label = 'batch');
begin
  v_result := public.v5_profitability_rollback_batch(v_batch_id, 'transactional smoke');
  if v_result ->> 'status' <> 'cancelled' or (v_result ->> 'version_rows')::integer <> 1 then
    raise exception 'Profitability rollback failed: %', v_result;
  end if;
end
$$;

reset role;

do $$
begin
  if exists (select 1 from app.v5_profitability_current(date '2026-08-01', date '2026-08-01')) then
    raise exception 'Profitability rollback left a current fact';
  end if;
end
$$;

select jsonb_build_object(
  'generated_gross_profit_verified', true,
  'generated_gross_margin_verified', true,
  'nullable_net_profit_verified', true,
  'monthly_expense_verified', true,
  'bounded_read_verified', true,
  'invalid_rows_do_not_create_products', true,
  'rollback_verified', true,
  'transaction_will_rollback', true
) as profitability_smoke;

rollback;
