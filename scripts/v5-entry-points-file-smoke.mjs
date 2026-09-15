import { spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, extname, join, resolve } from 'node:path';
import readExcelFile from 'read-excel-file/node';
import {
  buildEntryPointsStagedRows,
  ENTRY_POINTS_MAX_FILE_BYTES,
  extractEntryPointsWorkbook,
  splitEntryPointsRows,
} from '../src/features/entryPoints/entryPointsImportCore.ts';
import {
  buildCabinetRoutingPlan,
  cabinetRoutingError,
  subsetWorkbookByCabinet,
} from '../src/features/imports/cabinetRouting.ts';

const inputPath = process.argv[2] ? resolve(process.argv[2]) : '';
const localOnly = process.argv.includes('--local-only');
const fail = message => { console.error(`V5 entry points file smoke failed: ${message}`); process.exit(1); };
const sqlString = value => String(value).replaceAll("'", "''");

if (!inputPath) fail('pass an .xlsx entry points report path after --');
if (extname(inputPath).toLocaleLowerCase('en-US') !== '.xlsx') fail('the control report must be .xlsx');
const fileStats = await stat(inputPath).catch(() => null);
if (!fileStats?.isFile()) fail('the control report does not exist');
if (fileStats.size <= 0 || fileStats.size > ENTRY_POINTS_MAX_FILE_BYTES) fail('the control report size is outside the allowed range');

const sheets = await readExcelFile(inputPath);
const workbook = extractEntryPointsWorkbook(sheets.map(sheet => ({ name: sheet.sheet, data: sheet.data })));
const cabinets = [
  { id: randomUUID(), externalKey: 'cab-1', name: 'Светпланет' },
  { id: randomUUID(), externalKey: 'cab-2', name: 'Ледситипро' },
];
const routing = buildCabinetRoutingPlan(workbook.rows, cabinets);
const routingFailure = cabinetRoutingError(routing, workbook.sourceRowNumbers);
if (routingFailure) fail(routingFailure);

const fileBytes = await readFile(inputPath);
const smokeHash = createHash('sha256').update(fileBytes).update('\0v5-entry-points-file-smoke').digest('hex');
const fields = ['date', 'seller_sku', 'wb_sku', 'section', 'entry_point', 'impressions', 'clicks', 'carts', 'orders'];
const payloadSql = fields.flatMap((field, index) => [`'${field}'`, `item -> ${index + 1}`]).join(', ');

const routeChecks = routing.routes.map((route, routeIndex) => {
  const routeWorkbook = subsetWorkbookByCabinet(workbook, route.rowIndexes);
  const stagedRows = buildEntryPointsStagedRows(routeWorkbook);
  const productCount = new Set(routeWorkbook.rows.map(row => String(row.seller_sku || row.wb_sku || '').replace(/\.0+$/u, '').trim())).size;
  const totals = routeWorkbook.rows.reduce((sum, row) => ({
    impressions: sum.impressions + Number(row.impressions || 0),
    clicks: sum.clicks + Number(row.clicks || 0),
    carts: sum.carts + Number(row.carts || 0),
    orders: sum.orders + Number(row.orders || 0),
  }), { impressions: 0, clicks: 0, carts: 0, orders: 0 });
  const pointCount = new Set(routeWorkbook.rows.map(row => `${row.section}\u001f${row.entry_point}`)).size;
  const stageCalls = splitEntryPointsRows(stagedRows).map(chunk => {
    const compactRows = chunk.map(row => [row.row_number, ...fields.map(field => row.payload[field])]);
    return `perform public.v5_entry_points_stage_rows(v_batch_id, (
      select jsonb_agg(jsonb_build_object(
        'row_number', (item ->> 0)::integer,
        'payload', jsonb_build_object(${payloadSql})
      )) from jsonb_array_elements('${sqlString(JSON.stringify(compactRows))}'::jsonb) item
    ));`;
  }).join('\n');
  return {
    cabinet: route.cabinet,
    rowCount: stagedRows.length,
    productCount,
    sql: `
  v_created := public.v5_entry_points_create_batch(
    '${route.cabinet.id}'::uuid, '${sqlString(basename(inputPath))}',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', ${fileStats.size}, '${smokeHash}'
  );
  if (v_created ->> 'duplicate')::boolean then raise exception 'Route ${routeIndex + 1} unexpectedly resolved to an existing batch'; end if;
  v_batch_id := (v_created ->> 'batch_id')::uuid;
  insert into storage.objects (bucket_id, name, owner_id)
  values ('v5-import-sources', v_created ->> 'object_path', v_user_id::text);
  ${stageCalls}
  v_result := public.v5_entry_points_publish_batch(v_batch_id);
  if v_result ->> 'status' <> 'published'
    or (v_result ->> 'input_rows')::integer <> ${stagedRows.length}
    or (v_result ->> 'canonical_rows')::integer <> ${stagedRows.length}
    or (v_result ->> 'replaced_duplicate_rows')::integer <> 0
    or (v_result ->> 'products_created')::integer <> ${productCount}
    or v_result ->> 'period_start' <> '${routeWorkbook.dateStart}'
    or v_result ->> 'period_end' <> '${routeWorkbook.dateEnd}'
  then raise exception 'Route ${routeIndex + 1} publication assertion failed: %', v_result; end if;
  select * into v_summary from public.v5_entry_points_summary(
    '${routeWorkbook.dateStart}'::date, '${routeWorkbook.dateEnd}'::date,
    array['${route.cabinet.id}'::uuid], null, null, null, null, null, null, null
  );
  if v_summary.impressions <> ${totals.impressions}
    or v_summary.clicks <> ${totals.clicks}
    or v_summary.carts <> ${totals.carts}
    or v_summary.orders <> ${totals.orders}
    or v_summary.point_count <> ${pointCount}
  then raise exception 'Route ${routeIndex + 1} aggregate assertion failed: %', row_to_json(v_summary); end if;`,
  };
});

const cabinetSetup = routing.routes.map((route, index) => `
  insert into core.cabinets (id, external_key, name)
  values ('${route.cabinet.id}'::uuid, 'entry-file-smoke-${index + 1}-${smokeHash.slice(0, 12)}', '${sqlString(route.cabinet.name)} smoke');`).join('\n');

const sql = `begin;

do $smoke$
declare
  v_user_id uuid;
  v_created jsonb;
  v_batch_id uuid;
  v_result jsonb;
  v_summary record;
begin
  select user_id into v_user_id from app.user_access where is_active and access_role = 'admin' limit 1;
  if v_user_id is null then raise exception 'Entry points file smoke requires an existing V5 administrator'; end if;
  perform set_config('request.jwt.claim.sub', v_user_id::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  ${cabinetSetup}
  ${routeChecks.map(route => route.sql).join('\n')}
end
$smoke$;

select jsonb_build_object(
  'source_file', '${sqlString(basename(inputPath))}',
  'input_rows', ${workbook.inputRows},
  'canonical_rows', ${workbook.rows.length},
  'period_start', '${workbook.dateStart}',
  'period_end', '${workbook.dateEnd}',
  'cabinet_routes', ${routing.routes.length},
  'route_summary', '${sqlString(routeChecks.map(route => `${route.cabinet.name}: ${route.rowCount} rows, ${route.productCount} products`).join('; '))}',
  'transaction_will_rollback', true
) as entry_points_file_smoke;

rollback;
`;

const routeSummary = routeChecks
  .map(route => `${route.cabinet.name}: ${route.rowCount} rows, ${route.productCount} products`)
  .join('; ');
console.log(`Control entry points report parsed: ${workbook.rows.length} rows across ${routing.routes.length} cabinet routes, ${workbook.dateStart} to ${workbook.dateEnd}.`);
console.log(`Route summary: ${routeSummary}.`);
console.log(`Transactional SQL payload: ${(Buffer.byteLength(sql, 'utf8') / 1024).toFixed(1)} KiB.`);
if (localOnly) {
  console.log('Local-only validation complete. No data was sent to Supabase.');
  process.exit(0);
}

const temporaryDirectory = await mkdtemp(join(tmpdir(), 'analytics-v5-entry-points-'));
const sqlPath = join(temporaryDirectory, 'entry-points-file-smoke.sql');
const cliEntry = resolve(process.cwd(), 'node_modules', 'supabase', 'dist', 'supabase.js');
let cliStatus = 1;

try {
  await writeFile(sqlPath, sql, 'utf8');
  const result = spawnSync(process.execPath, [cliEntry, 'db', 'query', '--linked', '--file', sqlPath, '--agent', 'no', '--output-format', 'text'], {
    cwd: process.cwd(), env: { ...process.env, SUPABASE_TELEMETRY_DISABLED: '1' }, stdio: 'inherit', shell: false,
  });
  if (result.error) throw result.error;
  cliStatus = result.status ?? 1;
} finally {
  await rm(temporaryDirectory, { recursive: true, force: true });
}

if (cliStatus !== 0) process.exit(cliStatus);
