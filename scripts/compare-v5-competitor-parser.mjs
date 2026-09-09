import { readFile, stat } from 'node:fs/promises';
import { basename, extname, resolve } from 'node:path';
import readExcelFile from 'read-excel-file/node';
import * as XLSXModule from 'xlsx';
import {
  buildCompetitorStagedRows,
  COMPETITOR_MAX_FILE_BYTES,
  extractCompetitorWorkbook,
} from '../src/features/competitors/competitorImportCore.ts';

const inputPath = process.argv[2] ? resolve(process.argv[2]) : '';
const reportYear = Number(process.argv[3] || new Date().getFullYear());
const XLSX = XLSXModule.default ?? XLSXModule;

function fail(message) {
  console.error(`V5 competitor parser comparison failed: ${message}`);
  process.exit(1);
}

if (!inputPath) fail('pass an .xlsx report path and optional report year');
if (extname(inputPath).toLocaleLowerCase('en-US') !== '.xlsx') fail('the control report must be an .xlsx file');
if (!Number.isInteger(reportYear) || reportYear < 2000 || reportYear > 2100) fail('report year must be between 2000 and 2100');

const fileStats = await stat(inputPath).catch(() => null);
if (!fileStats?.isFile()) fail('the control report does not exist');
if (fileStats.size <= 0 || fileStats.size > COMPETITOR_MAX_FILE_BYTES) fail('the control report must be between 1 byte and 25 MiB');

const safeSheets = await readExcelFile(inputPath);
const safeWorkbook = extractCompetitorWorkbook(
  safeSheets.map(sheet => ({ name: sheet.sheet, data: sheet.data })),
  reportYear,
);

const fileBytes = await readFile(inputPath);
const legacyWorkbook = XLSX.read(fileBytes, { type: 'buffer', cellDates: true });
const legacyParsed = extractCompetitorWorkbook(
  legacyWorkbook.SheetNames.map(name => ({
    name,
    data: XLSX.utils.sheet_to_json(legacyWorkbook.Sheets[name], { header: 1, defval: '', raw: true }),
  })),
  reportYear,
);

const safeRows = buildCompetitorStagedRows(safeWorkbook);
const legacyRows = buildCompetitorStagedRows(legacyParsed);
const sectionCounts = Object.fromEntries(Object.entries(safeWorkbook.sections).map(([section, value]) => [section, value.rows.length]));
const mismatchCounts = {};
let firstMismatch = null;

for (let index = 0; index < Math.max(safeRows.length, legacyRows.length); index++) {
  const safe = safeRows[index];
  const legacy = legacyRows[index];
  if (JSON.stringify(safe) === JSON.stringify(legacy)) continue;
  const section = safe?.sheet_name || legacy?.sheet_name || 'unknown';
  const fields = new Set([...Object.keys(safe?.payload || {}), ...Object.keys(legacy?.payload || {})]);
  for (const field of fields) {
    if (JSON.stringify(safe?.payload[field]) === JSON.stringify(legacy?.payload[field])) continue;
    const key = `${section}.${field}`;
    mismatchCounts[key] = (mismatchCounts[key] || 0) + 1;
    if (!firstMismatch) {
      firstMismatch = {
        section,
        sourceRow: safe?.row_number || legacy?.row_number || null,
        field,
        safeValue: safe?.payload[field] ?? null,
        legacyValue: legacy?.payload[field] ?? null,
      };
    }
  }
}

console.log(JSON.stringify({
  sourceFile: basename(inputPath),
  totalRows: safeRows.length,
  sectionCounts,
  safePeriod: [safeWorkbook.dateStart, safeWorkbook.dateEnd],
  legacyPeriod: [legacyParsed.dateStart, legacyParsed.dateEnd],
  parity: safeRows.length === legacyRows.length && !firstMismatch,
  mismatchCounts,
  firstMismatch,
}, null, 2));

if (safeRows.length !== legacyRows.length || firstMismatch) process.exit(2);
