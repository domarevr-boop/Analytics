begin;

do $$
declare
  v_user_id uuid;
begin
  select access.user_id
  into v_user_id
  from app.user_access access
  where access.access_role = 'admin'
    and access.is_active
  order by access.created_at
  limit 1;

  if v_user_id is null then
    raise exception 'Directory bootstrap smoke requires the bootstrapped V5 admin';
  end if;

  perform set_config('request.jwt.claim.sub', v_user_id::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
end
$$;

set local role authenticated;

do $$
declare
  v_created jsonb;
  v_published jsonb;
  v_duplicate jsonb;
  v_batch_id uuid;
  v_product_id uuid;
  v_manifest jsonb;
  v_resolved jsonb;
begin
  v_created := public.v5_directory_create_batch(
    '__v5_directory_bootstrap_smoke.json',
    1024,
    repeat('a', 64),
    repeat('b', 64)
  );
  v_batch_id := (v_created ->> 'batch_id')::uuid;

  if (v_created ->> 'duplicate')::boolean or v_created ->> 'status' <> 'created' then
    raise exception 'Directory batch creation failed: %', v_created;
  end if;

  insert into storage.objects (bucket_id, name, owner_id, metadata)
  values (
    'v5-import-sources',
    v_created ->> 'object_path',
    auth.uid()::text,
    jsonb_build_object('mimetype', 'application/json', 'size', 1024)
  );

  v_manifest := jsonb_build_object(
    'schemaVersion', 1,
    'source', jsonb_build_object(
      'version', 'v4.0',
      'exportedAt', '2026-09-06T15:49:11.425Z',
      'sizeBytes', 406210120,
      'sha256', repeat('b', 64)
    ),
    'summary', jsonb_build_object('acceptedProducts', 1, 'queuedProductComponents', 1),
    'cabinets', jsonb_build_array(
      jsonb_build_object('externalKey', '__v5_directory_bootstrap_cabinet__', 'name', 'Bootstrap cabinet')
    ),
    'brands', jsonb_build_array(
      jsonb_build_object('externalKey', '__v5_directory_bootstrap_brand__', 'name', 'Bootstrap brand')
    ),
    'categories', jsonb_build_array(
      jsonb_build_object('externalKey', '__v5_directory_bootstrap_category__', 'name', 'Bootstrap category')
    ),
    'groups', jsonb_build_array(
      jsonb_build_object(
        'externalKey', '__ungrouped__',
        'cabinetExternalKey', '__v5_directory_bootstrap_cabinet__',
        'name', 'Без склейки',
        'isUngrouped', true
      ),
      jsonb_build_object(
        'externalKey', '__v5_directory_bootstrap_group__',
        'cabinetExternalKey', '__v5_directory_bootstrap_cabinet__',
        'name', 'Bootstrap group',
        'isUngrouped', false
      )
    ),
    'products', jsonb_build_array(
      jsonb_build_object(
        'externalKey', '__v5_directory_bootstrap_product__',
        'cabinetExternalKey', '__v5_directory_bootstrap_cabinet__',
        'sellerSku', 'BOOTSTRAP-SKU',
        'wbSku', '990000001',
        'name', 'Bootstrap product',
        'categoryExternalKey', '__v5_directory_bootstrap_category__',
        'brandExternalKey', '__v5_directory_bootstrap_brand__',
        'status', 'active',
        'dataSource', 'seed',
        'legacyProductIds', jsonb_build_array('__v4_bootstrap_product__')
      )
    ),
    'aliases', jsonb_build_array(
      jsonb_build_object(
        'productExternalKey', '__v5_directory_bootstrap_product__',
        'cabinetExternalKey', '__v5_directory_bootstrap_cabinet__',
        'value', 'BOOTSTRAP-SKU-OLD',
        'type', 'historical'
      )
    ),
    'groupHistory', jsonb_build_array(
      jsonb_build_object(
        'productExternalKey', '__v5_directory_bootstrap_product__',
        'cabinetExternalKey', '__v5_directory_bootstrap_cabinet__',
        'effectiveDate', '2026-08-25',
        'groupExternalKey', '__v5_directory_bootstrap_group__',
        'source', 'legacy'
      )
    ),
    'legacyProductMap', jsonb_build_array(
      jsonb_build_object(
        'legacyProductId', '__v4_bootstrap_product__',
        'productExternalKey', '__v5_directory_bootstrap_product__',
        'cabinetExternalKey', '__v5_directory_bootstrap_cabinet__'
      )
    ),
    'reviewQueue', jsonb_build_array(
      jsonb_build_object(
        'type', 'product_identity',
        'legacyProductIds', jsonb_build_array('__v4_review_product__'),
        'reasons', jsonb_build_array('missing_or_ambiguous_cabinet')
      )
    )
  );

  v_published := public.v5_directory_publish_bootstrap(v_batch_id, v_manifest);

  if v_published ->> 'status' <> 'published'
    or (v_published ->> 'accepted_rows')::integer <> 9
    or (v_published ->> 'rejected_rows')::integer <> 1
  then
    raise exception 'Directory bootstrap publication failed: %', v_published;
  end if;

  select product.id
  into strict v_product_id
  from core.products product
  join core.cabinets cabinet on cabinet.id = product.cabinet_id
  where cabinet.external_key = '__v5_directory_bootstrap_cabinet__'
    and product.external_key = '__v5_directory_bootstrap_product__'
    and product.data_source = 'seed'
    and product.source_batch_id = v_batch_id;

  v_resolved := public.v5_group_membership_at(v_product_id, date '2026-08-25');
  if not (v_resolved ->> 'known')::boolean
    or v_resolved ->> 'group_name' <> 'Bootstrap group'
  then
    raise exception 'Bootstrapped dated group resolution failed: %', v_resolved;
  end if;

  if (select count(*) from ingest.import_rows where batch_id = v_batch_id) <> 10
    or (select count(*) from ingest.legacy_product_map where batch_id = v_batch_id) <> 1
    or (select count(*) from ingest.directory_review_items where batch_id = v_batch_id and status = 'pending') <> 1
    or (select count(*) from ingest.import_errors where batch_id = v_batch_id) <> 1
  then
    raise exception 'Directory bootstrap lineage assertion failed';
  end if;

  v_duplicate := public.v5_directory_publish_bootstrap(v_batch_id, v_manifest);
  if not (v_duplicate ->> 'duplicate')::boolean
    or v_duplicate ->> 'status' <> 'published'
  then
    raise exception 'Published directory batch must be idempotent: %', v_duplicate;
  end if;
end
$$;

select jsonb_build_object(
  'retained_manifest_required', true,
  'atomic_directory_publication', true,
  'legacy_mapping_retained', true,
  'review_queue_isolated', true,
  'dated_membership_resolved', true,
  'published_retry_idempotent', true,
  'transaction_will_rollback', true
) as directory_bootstrap_smoke;

rollback;
