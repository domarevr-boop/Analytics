import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, extname, join, resolve } from 'node:path';
import readExcelFile from 'read-excel-file/node';
import {
  buildGeographyStagedRows,
  extractGeographyWorkbook,
  GEOGRAPHY_MAX_FILE_BYTES,
  splitGeographyRows,
} from '../src/features/geography/geographyImportCore.ts';

const inputPath = process.argv[2] ? resolve(process.argv[2]) : '';

function fail(message) {
  console.error(`V5 geography file smoke failed: ${message}`);
  process.exit(1);
}

function sqlString(value) {
  return String(value).replaceAll("'", "''");
}

if (!inputPath) fail('pass an .xlsx geography report path after --');
if (extname(inputPath).toLocaleLowerCase('en-US') !== '.xlsx') fail('the control report must be an .xlsx file');
const fileStats = await stat(inputPath).catch(() => null);
if (!fileStats?.isFile()) fail('the control report does not exist');
if (fileStats.size <= 0 || fileStats.size > GEOGRAPHY_MAX_FILE_BYTES) fail('the control report must be between 1 byte and 25 MiB');

const sheets = await readExcelFile(inputPath);
const workbook = extractGeographyWorkbook(sheets.map(sheet => ({ name: sheet.sheet, data: sheet.data })));
const stagedRows = buildGeographyStagedRows(workbook);
const productPairs = new Map();
for (const row of workbook.rows) {
  const sellerSku = String(row.seller_sku || '').trim();
  const wbSku = String(row.wb_sku || '').trim();
  const key = sellerSku || `wb:${wbSku}`;
  const previous = productPairs.get(key);
  if (previous && previous.wbSku !== wbSku) fail('one seller SKU points to multiple WB SKU values');
  productPairs.set(key, { sellerSku, wbSku });
}
const products = [...productPairs.values()];
if (new Set(products.map(row => row.wbSku).filter(Boolean)).size !== products.filter(row => row.wbSku).length) {
  fail('one WB SKU points to multiple seller SKU values');
}

const totals = workbook.rows.reduce((result, row) => ({
  orders: result.orders + Number(row.orders_total || 0),
  fbo: result.fbo + Number(row.wb_local_orders || 0) + Number(row.wb_nonlocal_orders || 0),
  fbs: result.fbs + Number(row.marketplace_local_orders || 0) + Number(row.marketplace_nonlocal_orders || 0),
}), { orders: 0, fbo: 0, fbs: 0 });
const fileBytes = await readFile(inputPath);
const smokeHash = createHash('sha256').update(fileBytes).update('\0v5-geography-file-smoke').digest('hex');
const fields = [
  'date', 'seller_sku', 'wb_sku', 'region', 'area', 'city', 'delivery_hours',
  'orders_total', 'product_local_orders', 'product_nonlocal_orders',
  'wb_local_orders', 'wb_nonlocal_orders', 'marketplace_local_orders', 'marketplace_nonlocal_orders',
];
const stageCalls = splitGeographyRows(stagedRows).map(chunk => {
  const compactRows = chunk.map(row => [row.row_number, ...fields.map(field => row.payload[field])]);
  const payloadFields = fields.flatMap((field, index) => [`'${field}'`, `item -> ${index + 1}`]).join(', ');
  return `perform public.v5_geography_stage_rows(v_batch_id, (
    select jsonb_agg(jsonb_build_object(
      'row_number', (item ->> 0)::integer,
      'payload', jsonb_build_object(${payloadFields})
    )) from jsonb_array_elements('${sqlString(JSON.stringify(compactRows))}'::jsonb) item
  ));`;
}).join('\n');

const sql = `begin;

create temporary table geography_file_smoke_ids (cabinet_id uuid not null) on commit drop;
grant select, insert on geography_file_smoke_ids to authenticated;

do $setup$
declare
  v_user_id uuid;
  v_cabinet_id uuid := gen_random_uuid();
begin
  select access.user_id into strict v_user_id from app.user_access access
  where access.access_role = 'admin' and access.is_active;
  perform set_config('request.jwt.claim.sub', v_user_id::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  insert into core.cabinets (id, external_key, name)
  values (v_cabinet_id, 'geography-real-file-smoke-' || left('${smokeHash}', 12), 'Geography real file smoke');
  insert into core.products (id, cabinet_id, external_key, seller_sku, wb_sku, name, data_source)
  select gen_random_uuid(), v_cabinet_id, 'geo-file-' || row_number() over (),
    nullif(item ->> 'seller_sku', ''), nullif(item ->> 'wb_sku', ''), 'Geography smoke product', 'seed'
  from jsonb_array_elements('${sqlString(JSON.stringify(products))}'::jsonb) item;
  insert into geography_file_smoke_ids values (v_cabinet_id);
end
$setup$;

set local role authenticated;

do $smoke$
declare
  v_created jsonb;
  v_batch_id uuid;
  v_cabinet_id uuid := (select cabinet_id from geography_file_smoke_ids);
  v_result jsonb;
  v_bounds jsonb;
  v_totals jsonb;
begin
  v_created := public.v5_geography_create_batch(
    v_cabinet_id, '__v5_real_geography_file_smoke.xlsx',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', ${fileStats.size}, '${smokeHash}'
  );
  if (v_created ->> 'duplicate')::boolean then raise exception 'Control report smoke unexpectedly resolved to an existing batch'; end if;
  v_batch_id := (v_created ->> 'batch_id')::uuid;
  insert into storage.objects (bucket_id, name, owner_id)
  values ('v5-import-sources', v_created ->> 'object_path', auth.uid()::text);

  ${stageCalls}

  v_result := public.v5_geography_publish_batch(v_batch_id);
  if v_result ->> 'status' <> 'published'
    or (v_result ->> 'input_rows')::integer <> ${stagedRows.length}
    or (v_result ->> 'canonical_rows')::integer <> ${stagedRows.length}
    or (v_result ->> 'replaced_duplicate_rows')::integer <> 0
    or v_result ->> 'period_start' <> '${workbook.dateStart}'
    or v_result ->> 'period_end' <> '${workbook.dateEnd}'
  then raise exception 'Real geography file publication assertion failed: %', v_result; end if;

  v_bounds := public.v5_geography_snapshot_bounds(v_cabinet_id);
  if v_bounds ->> 'batch_id' <> v_batch_id::text
    or (v_bounds ->> 'row_count')::integer <> ${stagedRows.length}
    or v_bounds ->> 'min_date' <> '${workbook.dateStart}'
    or v_bounds ->> 'max_date' <> '${workbook.dateEnd}'
  then raise exception 'Real geography file snapshot assertion failed: %', v_bounds; end if;

  select jsonb_object_agg(summary.fulfillment, summary.orders)
  into v_totals
  from public.v5_geography_summary('${workbook.dateStart}'::date, '${workbook.dateEnd}'::date, array[v_cabinet_id], null, null, null, null) summary;
  if (v_totals ->> 'all')::bigint <> ${totals.orders}
    or (v_totals ->> 'fbo')::bigint <> ${totals.fbo}
    or (v_totals ->> 'fbs')::bigint <> ${totals.fbs}
  then raise exception 'Real geography file totals differ: %', v_totals; end if;
end
$smoke$;

select jsonb_build_object(
  'source_file', '${sqlString(basename(inputPath))}',
  'input_rows', ${workbook.inputRows},
  'canonical_rows', ${stagedRows.length},
  'products', ${products.length},
  'period_start', '${workbook.dateStart}',
  'period_end', '${workbook.dateEnd}',
  'orders', ${totals.orders},
  'fbo_orders', ${totals.fbo},
  'fbs_orders', ${totals.fbs},
  'transaction_will_rollback', true
) as geography_file_smoke;

rollback;
`;

const temporaryDirectory = await mkdtemp(join(tmpdir(), 'analytics-v5-geography-'));
const sqlPath = join(temporaryDirectory, 'geography-file-smoke.sql');
const cliEntry = resolve(process.cwd(), 'node_modules', 'supabase', 'dist', 'supabase.js');
let cliStatus = 1;

try {
  await writeFile(sqlPath, sql, 'utf8');
  console.log(`Control geography report parsed: ${stagedRows.length} rows, ${products.length} products, ${workbook.dateStart} to ${workbook.dateEnd}.`);
  console.log(`Compact transactional SQL payload: ${(Buffer.byteLength(sql, 'utf8') / 1024).toFixed(1)} KiB.`);
  const result = spawnSync(process.execPath, [cliEntry, 'db', 'query', '--linked', '--file', sqlPath, '--agent', 'no', '--output-format', 'text'], {
    cwd: process.cwd(),
    env: { ...process.env, SUPABASE_TELEMETRY_DISABLED: '1' },
    stdio: 'inherit',
    shell: false,
  });
  if (result.error) throw result.error;
  cliStatus = result.status ?? 1;
} finally {
  await rm(temporaryDirectory, { recursive: true, force: true });
}

if (cliStatus !== 0) process.exit(cliStatus);
