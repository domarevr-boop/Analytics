import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, extname, join, resolve } from 'node:path';
import readExcelFile from 'read-excel-file/node';
import {
  buildCompetitorStagedRows,
  COMPETITOR_MAX_FILE_BYTES,
  extractCompetitorWorkbook,
  splitCompetitorRows,
} from '../src/features/competitors/competitorImportCore.ts';

const inputPath = process.argv[2] ? resolve(process.argv[2]) : '';
const reportYear = Number(process.argv[3] || new Date().getFullYear());

function fail(message) {
  console.error(`V5 competitor file smoke failed: ${message}`);
  process.exit(1);
}

function sqlString(value) {
  return String(value).replaceAll("'", "''");
}

if (!inputPath) fail('pass an .xlsx report path and optional report year after --');
if (extname(inputPath).toLocaleLowerCase('en-US') !== '.xlsx') fail('the control report must be an .xlsx file');
if (!Number.isInteger(reportYear) || reportYear < 2000 || reportYear > 2100) fail('report year must be between 2000 and 2100');

const fileStats = await stat(inputPath).catch(() => null);
if (!fileStats?.isFile()) fail('the control report does not exist');
if (fileStats.size <= 0 || fileStats.size > COMPETITOR_MAX_FILE_BYTES) fail('the control report must be between 1 byte and 25 MiB');

const sheets = await readExcelFile(inputPath);
const workbook = extractCompetitorWorkbook(
  sheets.map(sheet => ({ name: sheet.sheet, data: sheet.data })),
  reportYear,
);
const stagedRows = buildCompetitorStagedRows(workbook);
const sectionCounts = Object.fromEntries(
  Object.entries(workbook.sections).map(([section, value]) => [section, value.rows.length]),
);
const fileBytes = await readFile(inputPath);
const smokeHash = createHash('sha256').update(fileBytes).update('\0v5-competitor-file-smoke').digest('hex');
const sectionFields = {
  funnel: ['date', 'wb_article', 'position', 'seller', 'brand', 'ordered_amount', 'discounted_price', 'buyer_median_price', 'avg_search_position', 'impressions', 'clicks', 'reported_ctr', 'carts', 'reported_cart_conversion', 'orders', 'reported_order_conversion', 'buyouts', 'reported_buyout_rate'],
  search: ['date', 'wb_article', 'query', 'requests', 'requests_previous', 'reported_cart_conversion', 'reported_cart_conversion_previous', 'reported_order_conversion', 'reported_order_conversion_previous'],
  stocks: ['date', 'wb_article', 'name', 'subject', 'brand', 'region', 'warehouse', 'stock', 'in_transit_to_customer', 'in_transit_from_customer', 'avg_daily_orders'],
  positions: ['date', 'wb_article', 'position', 'seller', 'brand'],
};
const stageCalls = Object.entries(sectionFields).flatMap(([section, fields]) => {
  const sectionRows = stagedRows.filter(row => row.sheet_name === section);
  return splitCompetitorRows(sectionRows).map(chunk => {
    const compactRows = chunk.map(row => [row.row_number, ...fields.map(field => row.payload[field])]);
    const payloadFields = fields.flatMap((field, index) => [`'${field}'`, `item -> ${index + 1}`]).join(', ');
    return `perform public.v5_competitor_stage_rows(v_batch_id, (
      select jsonb_agg(jsonb_build_object(
        'sheet_name', '${section}',
        'row_number', (item ->> 0)::integer,
        'payload', jsonb_build_object(${payloadFields})
      ))
      from jsonb_array_elements('${sqlString(JSON.stringify(compactRows))}'::jsonb) item
    ));`;
  });
}).join('\n');

const sql = `begin;

do $setup$
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
$setup$;

set local role authenticated;

do $smoke$
declare
  v_created jsonb;
  v_batch_id uuid;
  v_result jsonb;
  v_summary jsonb;
  v_bounds jsonb;
  v_history jsonb;
  v_history_item jsonb;
  v_errors jsonb;
  v_error_summary jsonb;
begin
  v_created := public.v5_competitor_create_batch(
    '__v5_real_competitor_file_smoke.xlsx',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    ${fileStats.size},
    '${smokeHash}'
  );
  if (v_created ->> 'duplicate')::boolean then
    raise exception 'Control report smoke unexpectedly resolved to an existing batch';
  end if;

  v_batch_id := (v_created ->> 'batch_id')::uuid;
  insert into storage.objects (bucket_id, name, owner_id)
  values ('v5-import-sources', v_created ->> 'object_path', auth.uid()::text);

  ${stageCalls}

  v_result := public.v5_competitor_publish_batch(v_batch_id);
  if v_result ->> 'status' <> 'published' then
    v_errors := public.v5_competitor_batch_errors(v_batch_id, 200);
    select jsonb_object_agg(grouped.error_key, grouped.error_count)
    into v_error_summary
    from (
      select concat_ws('.', item ->> 'sheet_name', coalesce(item ->> 'column_name', '_row'), item ->> 'error_code') as error_key,
        count(*) as error_count
      from jsonb_array_elements(v_errors) item
      group by 1
    ) grouped;
    raise exception 'Real competitor file validation failed: result %, aggregate errors %', v_result, v_error_summary;
  end if;

  if (v_result ->> 'accepted_rows')::integer <> ${stagedRows.length}
    or v_result ->> 'period_start' <> '${workbook.dateStart}'
    or v_result ->> 'period_end' <> '${workbook.dateEnd}'
    or (v_result -> 'section_counts' ->> 'funnel')::integer <> ${sectionCounts.funnel}
    or (v_result -> 'section_counts' ->> 'search')::integer <> ${sectionCounts.search}
    or (v_result -> 'section_counts' ->> 'stocks')::integer <> ${sectionCounts.stocks}
    or (v_result -> 'section_counts' ->> 'positions')::integer <> ${sectionCounts.positions}
  then
    raise exception 'Real competitor file publication assertion failed: %', v_result;
  end if;

  v_summary := public.v5_competitor_batch_summary(v_batch_id);
  if v_summary ->> 'status' <> 'published'
    or (v_summary ->> 'accepted_rows')::integer <> ${stagedRows.length}
    or v_summary ->> 'period_start' <> '${workbook.dateStart}'
    or v_summary ->> 'period_end' <> '${workbook.dateEnd}'
  then
    raise exception 'Real competitor file summary assertion failed: %', v_summary;
  end if;

  v_bounds := public.v5_competitor_snapshot_bounds();
  if (v_bounds ->> 'batch_id')::uuid <> v_batch_id
    or (v_bounds -> 'funnel' ->> 'row_count')::integer <> ${sectionCounts.funnel}
    or (v_bounds -> 'search' ->> 'row_count')::integer <> ${sectionCounts.search}
    or (v_bounds -> 'stocks' ->> 'row_count')::integer <> ${sectionCounts.stocks}
    or (v_bounds -> 'positions' ->> 'row_count')::integer <> ${sectionCounts.positions}
    or v_bounds -> 'funnel' ->> 'min_date' <> '${workbook.dateStart}'
    or v_bounds -> 'positions' ->> 'max_date' <> '${workbook.dateEnd}'
  then
    raise exception 'Real competitor file snapshot assertion failed: %', v_bounds;
  end if;

  v_history := public.v5_competitor_batch_history(50);
  select item into v_history_item
  from jsonb_array_elements(v_history) item
  where (item ->> 'batch_id')::uuid = v_batch_id;
  if v_history_item is null or not coalesce((v_history_item ->> 'source_file_retained')::boolean, false) then
    raise exception 'Real competitor file source-retention assertion failed: %', v_history_item;
  end if;
end
$smoke$;

select jsonb_build_object(
  'rows', ${stagedRows.length},
  'section_counts', '${sqlString(JSON.stringify(sectionCounts))}'::jsonb,
  'period_start', '${workbook.dateStart}',
  'period_end', '${workbook.dateEnd}',
  'source_file', '${sqlString(basename(inputPath))}',
  'transaction_will_rollback', true
) as competitor_file_smoke;

rollback;
`;

const temporaryDirectory = await mkdtemp(join(tmpdir(), 'analytics-v5-competitors-'));
const sqlPath = join(temporaryDirectory, 'competitor-file-smoke.sql');
const cliEntry = resolve(process.cwd(), 'node_modules', 'supabase', 'dist', 'supabase.js');
let cliStatus = 1;

try {
  await writeFile(sqlPath, sql, 'utf8');
  console.log(`Control report parsed with actual Excel dates: ${stagedRows.length} rows, ${workbook.dateStart} to ${workbook.dateEnd}.`);
  console.log(`Compact transactional SQL payload: ${(Buffer.byteLength(sql, 'utf8') / 1024).toFixed(1)} KiB.`);
  const result = spawnSync(process.execPath, [cliEntry, 'db', 'query', '--linked', '--file', sqlPath], {
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
