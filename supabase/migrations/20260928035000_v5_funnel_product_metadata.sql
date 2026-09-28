begin;

-- Funnel rows already resolve product_id before a batch becomes published.
-- Enrich only import-created placeholders; never overwrite curated catalog fields.
create or replace function core.enrich_funnel_product_metadata()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.source_code not in ('wb_funnel', 'xway') or new.status <> 'published' or old.status = 'published' then
    return new;
  end if;

  insert into core.categories (external_key, name)
  select distinct on (lower(btrim(row_data.payload ->> 'category_name')))
    'report-category:' || lower(btrim(row_data.payload ->> 'category_name')),
    btrim(row_data.payload ->> 'category_name')
  from ingest.import_rows row_data
  where row_data.batch_id = new.id and row_data.accepted
    and nullif(btrim(row_data.payload ->> 'category_name'), '') is not null
    and length(btrim(row_data.payload ->> 'category_name')) <= 500
    and not exists (select 1 from core.categories category
      where lower(btrim(category.name)) = lower(btrim(row_data.payload ->> 'category_name')))
  order by lower(btrim(row_data.payload ->> 'category_name')), row_data.row_number desc
  on conflict (external_key) do nothing;

  insert into core.brands (external_key, name)
  select distinct on (lower(btrim(row_data.payload ->> 'brand_name')))
    'report-brand:' || lower(btrim(row_data.payload ->> 'brand_name')),
    btrim(row_data.payload ->> 'brand_name')
  from ingest.import_rows row_data
  where row_data.batch_id = new.id and row_data.accepted
    and nullif(btrim(row_data.payload ->> 'brand_name'), '') is not null
    and length(btrim(row_data.payload ->> 'brand_name')) <= 500
    and not exists (select 1 from core.brands brand
      where lower(btrim(brand.name)) = lower(btrim(row_data.payload ->> 'brand_name')))
  order by lower(btrim(row_data.payload ->> 'brand_name')), row_data.row_number desc
  on conflict (external_key) do nothing;

  with latest as (
    select distinct on ((row_data.payload ->> 'product_id')::uuid)
      (row_data.payload ->> 'product_id')::uuid as product_id,
      nullif(btrim(row_data.payload ->> 'product_name'), '') as product_name,
      nullif(btrim(row_data.payload ->> 'category_name'), '') as category_name,
      nullif(btrim(row_data.payload ->> 'brand_name'), '') as brand_name
    from ingest.import_rows row_data
    where row_data.batch_id = new.id and row_data.accepted
      and row_data.payload ? 'product_id'
      and (nullif(btrim(row_data.payload ->> 'product_name'), '') is not null
        or nullif(btrim(row_data.payload ->> 'category_name'), '') is not null
        or nullif(btrim(row_data.payload ->> 'brand_name'), '') is not null)
    order by (row_data.payload ->> 'product_id')::uuid,
      (row_data.payload ->> 'date')::date desc, row_data.row_number desc
  )
  update core.products product
  set name = case
        when latest.product_name is not null and length(latest.product_name) <= 2000
          and product.name in (product.external_key, product.seller_sku, product.wb_sku)
        then latest.product_name else product.name end,
      category_id = coalesce(product.category_id, category.id),
      brand_id = coalesce(product.brand_id, brand.id)
  from latest
    left join lateral (select candidate.id from core.categories candidate
      where lower(btrim(candidate.name)) = lower(latest.category_name)
      order by candidate.external_key = 'report-category:' || lower(latest.category_name) desc, candidate.id
      limit 1) category on true
    left join lateral (select candidate.id from core.brands candidate
      where lower(btrim(candidate.name)) = lower(latest.brand_name)
      order by candidate.external_key = 'report-brand:' || lower(latest.brand_name) desc, candidate.id
      limit 1) brand on true
  where product.id = latest.product_id and product.cabinet_id = new.cabinet_id
    and product.data_source = 'import';

  return new;
end
$$;

revoke all on function core.enrich_funnel_product_metadata() from public, anon, authenticated;

create trigger v5_funnel_product_metadata_after_publish
after update of status on ingest.import_batches
for each row
when (new.status = 'published' and old.status is distinct from new.status)
execute function core.enrich_funnel_product_metadata();

comment on function core.enrich_funnel_product_metadata() is
  'Enrich import-created product placeholders from published WB/XWay report metadata without replacing curated fields.';

commit;
