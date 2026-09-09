import { readFile, stat } from 'node:fs/promises';
import { basename, extname, resolve } from 'node:path';
import readExcelFile from 'read-excel-file/node';
import * as XLSXModule from 'xlsx';
import {
  buildCompetitorStagedRows,
  COMPETITOR_MAX_FILE_BYTES,
  extractCompetitorWorkbook,
} from '../src/features/competitors/competitorImportCore.ts';

const args = process.argv.slice(2);
const unsupportedFlags = args.filter(value => value.startsWith('--') && value !== '--accept-excel-dates');
const positionalArgs = args.filter(value => !value.startsWith('--'));
const inputPath = positionalArgs[0] ? resolve(positionalArgs[0]) : '';
const reportYear = Number(positionalArgs[1] || new Date().getFullYear());
const acceptExcelDates = args.includes('--accept-excel-dates');
const XLSX = XLSXModule.default ?? XLSXModule;

function fail(message) {
  console.error(`V5 competitor parser comparison failed: ${message}`);
  process.exit(1);
}

if (!inputPath) fail('pass an .xlsx report path and optional report year');
if (unsupportedFlags.length) fail(`unsupported option: ${unsupportedFlags.join(', ')}`);
if (positionalArgs.length > 2) fail('pass only an .xlsx report path and optional report year');
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
let acceptedDateCorrection = safeRows.length === legacyRows.length;

function isLegacyOneDayBehind(safeValue, legacyValue) {
  if (typeof safeValue !== 'string' || typeof legacyValue !== 'string') return false;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(safeValue) || !/^\d{4}-\d{2}-\d{2}$/.test(legacyValue)) return false;
  const safeTime = Date.parse(`${safeValue}T00:00:00Z`);
  const legacyTime = Date.parse(`${legacyValue}T00:00:00Z`);
  return safeTime - legacyTime === 86_400_000;
}

for (let index = 0; index < Math.max(safeRows.length, legacyRows.length); index++) {
  const safe = safeRows[index];
  const legacy = legacyRows[index];
  if (JSON.stringify(safe) === JSON.stringify(legacy)) continue;
  if (!safe || !legacy || safe.sheet_name !== legacy.sheet_name || safe.row_number !== legacy.row_number) {
    acceptedDateCorrection = false;
  }
  const section = safe?.sheet_name || legacy?.sheet_name || 'unknown';
  const fields = new Set([...Object.keys(safe?.payload || {}), ...Object.keys(legacy?.payload || {})]);
  for (const field of fields) {
    if (JSON.stringify(safe?.payload[field]) === JSON.stringify(legacy?.payload[field])) continue;
    const key = `${section}.${field}`;
    mismatchCounts[key] = (mismatchCounts[key] || 0) + 1;
    if (field !== 'date' || !isLegacyOneDayBehind(safe?.payload[field], legacy?.payload[field])) {
      acceptedDateCorrection = false;
    }
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

acceptedDateCorrection = acceptedDateCorrection && Boolean(firstMismatch);
const parity = safeRows.length === legacyRows.length && !firstMismatch;
const accepted = parity || (acceptExcelDates && acceptedDateCorrection);

console.log(JSON.stringify({
  sourceFile: basename(inputPath),
  totalRows: safeRows.length,
  sectionCounts,
  safePeriod: [safeWorkbook.dateStart, safeWorkbook.dateEnd],
  legacyPeriod: [legacyParsed.dateStart, legacyParsed.dateEnd],
  parity,
  acceptedDateCorrection: acceptExcelDates && acceptedDateCorrection,
  mismatchCounts,
  firstMismatch,
}, null, 2));

if (!accepted) process.exit(2);
