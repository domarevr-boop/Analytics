import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, extname, join, resolve } from 'node:path';
import readExcelFile from 'read-excel-file/node';
import * as XLSXModule from 'xlsx';
import {
  buildMarketStagedRows,
  extractMarketTable,
  mapMarketSourceRows,
  MARKET_MAX_FILE_BYTES,
  splitMarketRows,
} from '../src/features/market/marketImportCore.ts';

const inputPath = process.argv[2] ? resolve(process.argv[2]) : '';
const XLSX = XLSXModule.default ?? XLSXModule;

function fail(message) {
  console.error(`V5 market file smoke failed: ${message}`);
  process.exit(1);
}

function sqlString(value) {
  return String(value).replaceAll("'", "''");
}

function finiteNumber(value, field, rowNumber) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    fail(`row ${rowNumber} has a non-numeric ${field}`);
  }
  return value;
}

function legacySheetGrid(sheet, date1904) {
  if (!sheet['!ref']) return [];
  const range = XLSX.utils.decode_range(sheet['!ref']);
  const rows = [];
  for (let rowIndex = range.s.r; rowIndex <= range.e.r; rowIndex++) {
    const row = [];
    for (let columnIndex = range.s.c; columnIndex <= range.e.c; columnIndex++) {
      const cell = sheet[XLSX.utils.encode_cell({ r: rowIndex, c: columnIndex })];
      if (!cell) {
        row.push('');
      } else if (cell.t === 'n' && cell.z && XLSX.SSF.is_date(cell.z)) {
        const parsed = XLSX.SSF.parse_date_code(cell.v, { date1904 });
        row.push(parsed
          ? `${parsed.y}-${String(parsed.m).padStart(2, '0')}-${String(parsed.d).padStart(2, '0')}`
          : cell.v);
      } else {
        row.push(cell.v ?? '');
      }
    }
    rows.push(row);
  }
  return rows;
}

if (!inputPath) fail('pass an .xlsx report path after --');
if (extname(inputPath).toLocaleLowerCase('en-US') !== '.xlsx') fail('the control report must be an .xlsx file');

const fileStats = await stat(inputPath).catch(() => null);
if (!fileStats?.isFile()) fail('the control report does not exist');
if (fileStats.size <= 0 || fileStats.size > MARKET_MAX_FILE_BYTES) fail('the control report must be between 1 byte and 10 MiB');

const sheets = await readExcelFile(inputPath);
let candidate = null;
for (const sheet of sheets) {
  candidate = extractMarketTable(sheet.data, sheet.sheet);
  if (candidate) break;
}
if (!candidate) fail('market headers were not found in the first 30 rows of any sheet');

const mappedRows = mapMarketSourceRows(candidate.rows);
const stagedRows = buildMarketStagedRows(mappedRows, candidate.sourceRowNumbers, candidate.sheetName);
if (stagedRows.length === 0) fail('the control report has no data rows');

const dates = stagedRows.map(row => String(row.payload.date)).sort();
const periodStart = dates[0];
const periodEnd = dates.at(-1);
const totals = stagedRows.reduce((result, row) => {
  result.marketAmount += finiteNumber(row.payload.market_ordered_amount, 'market_ordered_amount', row.row_number);
  result.ownAmount += finiteNumber(row.payload.own_ordered_amount, 'own_ordered_amount', row.row_number);
  result.marketOrders += finiteNumber(row.payload.market_orders, 'market_orders', row.row_number);
  result.ownOrders += finiteNumber(row.payload.own_orders, 'own_orders', row.row_number);
  return result;
}, { marketAmount: 0, ownAmount: 0, marketOrders: 0, ownOrders: 0 });

const fileBytes = await readFile(inputPath);
const legacyWorkbook = XLSX.read(fileBytes, { type: 'buffer', cellDates: false, cellNF: true });
const legacyDate1904 = Boolean(legacyWorkbook.Workbook?.WBProps?.date1904);
let legacyCandidate = null;
for (const sheetName of legacyWorkbook.SheetNames) {
  const grid = legacySheetGrid(legacyWorkbook.Sheets[sheetName], legacyDate1904);
  legacyCandidate = extractMarketTable(grid, sheetName);
  if (legacyCandidate) break;
}
if (!legacyCandidate) fail('the legacy XLSX parser did not recognize the control report');

const legacyRows = buildMarketStagedRows(
  mapMarketSourceRows(legacyCandidate.rows),
  legacyCandidate.sourceRowNumbers,
  legacyCandidate.sheetName,
);
const parserMismatchIndex = legacyRows.findIndex((row, index) => JSON.stringify(row) !== JSON.stringify(stagedRows[index]));
if (legacyRows.length !== stagedRows.length || parserMismatchIndex >= 0) {
  const mismatch = parserMismatchIndex >= 0 ? parserMismatchIndex : Math.min(legacyRows.length, stagedRows.length);
  fail(`the safe parser and the legacy XLSX parser differ at data row ${mismatch + 1}: safe=${JSON.stringify(stagedRows[mismatch])}, legacy=${JSON.stringify(legacyRows[mismatch])}`);
}

const smokeHash = createHash('sha256').update(fileBytes).update('\0v5-market-file-smoke').digest('hex');
const stageCalls = splitMarketRows(stagedRows).map(chunk => (
  `perform public.v5_market_stage_rows(v_batch_id, '${sqlString(JSON.stringify(chunk))}'::jsonb);`
)).join('\n');

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
  v_rows bigint;
  v_market_amount numeric;
  v_own_amount numeric;
  v_market_orders numeric;
  v_own_orders numeric;
begin
  v_created := public.v5_market_create_batch(
    '__v5_real_market_file_smoke.xlsx',
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

  v_result := public.v5_market_publish_batch(v_batch_id);
  if v_result ->> 'status' <> 'published'
    or (v_result ->> 'accepted_rows')::integer <> ${stagedRows.length}
  then
    raise exception 'Real market file publication assertion failed: %', v_result;
  end if;

  v_summary := public.v5_market_batch_summary(v_batch_id);
  if v_summary ->> 'status' <> 'published'
    or not (v_summary ->> 'source_file_retained')::boolean
    or (v_summary ->> 'period_start') <> '${periodStart}'
    or (v_summary ->> 'period_end') <> '${periodEnd}'
  then
    raise exception 'Real market file summary assertion failed: %', v_summary;
  end if;

  select count(*),
         coalesce(sum(series.market_ordered_amount), 0),
         coalesce(sum(series.own_ordered_amount), 0),
         coalesce(sum(series.market_orders), 0),
         coalesce(sum(series.own_orders), 0)
  into v_rows, v_market_amount, v_own_amount, v_market_orders, v_own_orders
  from public.v5_market_series('${periodStart}', '${periodEnd}', 'day') series;

  if v_rows <> ${stagedRows.length}
    or abs(v_market_amount - ${totals.marketAmount}) > 0.01
    or abs(v_own_amount - ${totals.ownAmount}) > 0.01
    or v_market_orders <> ${totals.marketOrders}
    or v_own_orders <> ${totals.ownOrders}
  then
    raise exception 'Real market file aggregate mismatch: rows %, market amount %, own amount %, market orders %, own orders %',
      v_rows, v_market_amount, v_own_amount, v_market_orders, v_own_orders;
  end if;
end
$smoke$;

select jsonb_build_object(
  'rows', ${stagedRows.length},
  'period_start', '${periodStart}',
  'period_end', '${periodEnd}',
  'source_file', '${sqlString(basename(inputPath))}',
  'transaction_will_rollback', true
) as market_file_smoke;

rollback;
`;

const temporaryDirectory = await mkdtemp(join(tmpdir(), 'analytics-v5-market-'));
const sqlPath = join(temporaryDirectory, 'market-file-smoke.sql');
const cliEntry = resolve(process.cwd(), 'node_modules', 'supabase', 'dist', 'supabase.js');
let cliStatus = 1;

try {
  await writeFile(sqlPath, sql, 'utf8');
  console.log(`Control report parsed with V4/V5 parity: ${stagedRows.length} rows, ${periodStart} to ${periodEnd}.`);
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
