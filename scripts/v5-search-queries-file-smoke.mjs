import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, extname, join, resolve } from 'node:path';
import readExcelFile from 'read-excel-file/node';
import {
  buildSearchQueriesStagedRows,
  extractSearchQueriesWorkbook,
  SEARCH_QUERIES_MAX_FILE_BYTES,
  splitSearchQueriesRows,
} from '../src/features/searchQueries/searchQueriesImportCore.ts';

const inputPath = process.argv[2] ? resolve(process.argv[2]) : '';
const fail = message => { console.error(`V5 search queries file smoke failed: ${message}`); process.exit(1); };
const sqlString = value => String(value).replaceAll("'", "''");

if (!inputPath) fail('pass an .xlsx report path after --');
if (extname(inputPath).toLocaleLowerCase('en-US') !== '.xlsx') fail('the control report must be .xlsx');
const fileStats = await stat(inputPath).catch(() => null);
if (!fileStats?.isFile()) fail('the control report does not exist');
if (fileStats.size <= 0 || fileStats.size > SEARCH_QUERIES_MAX_FILE_BYTES) fail('the control report size is outside the allowed range');

const sheets = await readExcelFile(inputPath);
const workbook = extractSearchQueriesWorkbook(sheets.map(sheet => ({ name: sheet.sheet, data: sheet.data })));
const stagedRows = buildSearchQueriesStagedRows(workbook);
const totals = workbook.rows.reduce((sum, row) => ({
  requests: sum.requests + Number(row.requests || 0),
  cardClicks: sum.cardClicks + Number(row.card_clicks || 0),
  carts: sum.carts + Number(row.carts || 0),
  orders: sum.orders + Number(row.orders || 0),
}), { requests: 0, cardClicks: 0, carts: 0, orders: 0 });
const keyCount = new Set(workbook.rows.map(row => `${row.query}\u001f${row.category}`)).size;
const fileBytes = await readFile(inputPath);
const smokeHash = createHash('sha256').update(fileBytes).update('\0v5-search-query-smoke').digest('hex');
const payloadFields = [
  'date', 'query', 'category',
  'requests', 'requests_previous', 'avg_daily_requests', 'avg_daily_requests_previous',
  'card_clicks', 'card_clicks_previous', 'carts', 'carts_previous',
  'cart_conversion', 'cart_conversion_previous', 'orders', 'orders_previous',
  'order_conversion', 'order_conversion_previous', 'ordered_subjects',
  'ordered_subjects_previous', 'products', 'products_previous',
];
const compactPayloadSql = payloadFields
  .map((field, index) => `'${field}', compact_row -> ${index + 1}`)
  .join(', ');
const stageCalls = splitSearchQueriesRows(stagedRows)
  .map(chunk => {
    const compactRows = chunk.map(row => [row.row_number, ...payloadFields.map(field => row.payload[field])]);
    return `perform public.v5_search_queries_stage_rows(v_batch_id, (
      select jsonb_agg(jsonb_build_object(
        'row_number', compact_row -> 0,
        'payload', jsonb_build_object(${compactPayloadSql})
      ))
      from jsonb_array_elements('${sqlString(JSON.stringify(compactRows))}'::jsonb) compact_row
    ));`;
  })
  .join('\n');

const sql = `begin;

do $smoke$
declare
  v_user_id uuid;
  v_created jsonb;
  v_batch_id uuid;
  v_result jsonb;
  v_summary jsonb;
  v_total_count bigint;
begin
  select user_id into v_user_id from app.user_access where is_active and access_role = 'admin' limit 1;
  if v_user_id is null then raise exception 'Search query smoke requires an existing V5 administrator'; end if;
  perform set_config('request.jwt.claim.sub', v_user_id::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  v_created := public.v5_search_queries_create_batch('${sqlString(basename(inputPath))}', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', ${fileStats.size}, '${smokeHash}');
  v_batch_id := (v_created ->> 'batch_id')::uuid;
  if (v_created ->> 'duplicate')::boolean then raise exception 'Control search report unexpectedly already exists'; end if;
  insert into storage.objects (bucket_id, name, owner_id)
  values ('v5-import-sources', v_created ->> 'object_path', v_user_id::text);
  ${stageCalls}
  v_result := public.v5_search_queries_publish_batch(v_batch_id);
  if v_result ->> 'status' <> 'published'
    or (v_result ->> 'canonical_rows')::integer <> ${stagedRows.length}
    or v_result ->> 'period_start' <> '${workbook.dateStart}'
    or v_result ->> 'period_end' <> '${workbook.dateEnd}'
  then raise exception 'Real search file publication assertion failed: %', v_result; end if;
  v_summary := public.v5_search_queries_summary('${workbook.dateStart}'::date, '${workbook.dateEnd}'::date, null, null);
  if (v_summary ->> 'requests')::bigint <> ${totals.requests}
    or (v_summary ->> 'card_clicks')::bigint <> ${totals.cardClicks}
    or (v_summary ->> 'carts')::bigint <> ${totals.carts}
    or (v_summary ->> 'orders')::bigint <> ${totals.orders}
    or (v_summary ->> 'query_count')::bigint <> ${keyCount}
  then raise exception 'Real search file totals differ: %', v_summary; end if;
  select result.total_count into v_total_count
  from public.v5_search_queries_rows('${workbook.dateStart}'::date, '${workbook.dateEnd}'::date, null, null, 'requests', 0, 1) result;
  if v_total_count <> ${keyCount} then raise exception 'Real search file page count differs: %', v_total_count; end if;
end
$smoke$;

select jsonb_build_object(
  'source_file', '${sqlString(basename(inputPath))}',
  'input_rows', ${workbook.inputRows},
  'canonical_rows', ${stagedRows.length},
  'query_category_keys', ${keyCount},
  'period_start', '${workbook.dateStart}',
  'period_end', '${workbook.dateEnd}',
  'requests', ${totals.requests},
  'card_clicks', ${totals.cardClicks},
  'carts', ${totals.carts},
  'orders', ${totals.orders},
  'transaction_will_rollback', true
) as search_queries_file_smoke;

rollback;
`;

const temporaryDirectory = await mkdtemp(join(tmpdir(), 'analytics-v5-search-queries-'));
const sqlPath = join(temporaryDirectory, 'search-queries-file-smoke.sql');
const cliEntry = resolve(process.cwd(), 'node_modules', 'supabase', 'dist', 'supabase.js');
let cliStatus = 1;
try {
  await writeFile(sqlPath, sql, 'utf8');
  console.log(`Control search report parsed: ${stagedRows.length} rows, ${keyCount} keys, ${workbook.dateStart} to ${workbook.dateEnd}.`);
  console.log(`Transactional SQL payload: ${(Buffer.byteLength(sql, 'utf8') / 1024).toFixed(1)} KiB.`);
  const result = spawnSync(process.execPath, [cliEntry, 'db', 'query', '--linked', '--file', sqlPath, '--agent', 'no', '--output-format', 'text'], {
    cwd: process.cwd(), env: { ...process.env, SUPABASE_TELEMETRY_DISABLED: '1' }, stdio: 'inherit', shell: false,
  });
  if (result.error) throw result.error;
  cliStatus = result.status ?? 1;
} finally {
  await rm(temporaryDirectory, { recursive: true, force: true });
}
if (cliStatus !== 0) process.exit(cliStatus);
