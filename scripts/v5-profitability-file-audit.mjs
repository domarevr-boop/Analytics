import { stat } from 'node:fs/promises';
import { basename, extname, resolve } from 'node:path';
import readExcelFile from 'read-excel-file/node';
import { calculateProfitabilityAmounts, extractProfitabilityWorkbook } from '../src/features/profitability/profitabilityImportCore.ts';

const inputPath = process.argv[2] ? resolve(process.argv[2]) : '';
const text = value => String(value ?? '').replace(/\u00a0/gu, ' ').replace(/\s+/gu, ' ').trim();
const normalized = value => text(value).toLocaleLowerCase('ru-RU').replace(/ё/gu, 'е');
const fail = message => { console.error(`V5 profitability file audit failed: ${message}`); process.exit(1); };

if (!inputPath) fail('pass an .xlsx report path');
if (extname(inputPath).toLocaleLowerCase('en-US') !== '.xlsx') fail('the control report must be .xlsx');
const fileStats = await stat(inputPath).catch(() => null);
if (!fileStats?.isFile()) fail('the control report does not exist');

const sheets = await readExcelFile(inputPath);
const workbook = extractProfitabilityWorkbook(sheets.map(sheet => ({ name: sheet.sheet, data: sheet.data })));
const summaries = sheets.map(sheet => {
  const candidates = sheet.data.slice(0, 40).map((row, index) => {
    const headers = row.map(text).filter(Boolean);
    const values = headers.map(normalized);
    const score = values.filter(value => /артикул|sku|выручк|прибыл|маржин|себесто|логист|хранен|реклам/iu.test(value)).length;
    return { index, headers, score };
  });
  const best = candidates.sort((left, right) => right.score - left.score || right.headers.length - left.headers.length)[0];
  return {
    sheetName: sheet.sheet,
    rowsIncludingHeader: sheet.data.length,
    headerRow: (best?.index ?? 0) + 1,
    headers: best?.headers || [],
  };
});
const marginTypeCounts = sheets.reduce((counts, sheet) => {
  const headerIndex = sheet.data.findIndex(row => row.some(value => normalized(value).includes('итоговая маржинальность')));
  if (headerIndex < 0) return counts;
  const columnIndex = sheet.data[headerIndex].findIndex(value => normalized(value).includes('итоговая маржинальность'));
  for (const row of sheet.data.slice(headerIndex + 1)) {
    const value = row[columnIndex]; const kind = typeof value;
    counts[kind] = (counts[kind] || 0) + 1;
    if (kind === 'string' && String(value).includes('%')) counts.stringWithPercent = (counts.stringWithPercent || 0) + 1;
  }
  return counts;
}, {});

const amountFields = ['quantity', 'revenue', 'cost', 'agent_fee', 'logistics_cost', 'marketing_cost', 'storage_cost', 'reported_gross_profit'];
const totals = Object.fromEntries(amountFields.map(field => [field, workbook.rows.reduce((sum, row) => sum + (typeof row[field] === 'number' ? row[field] : 0), 0)]));
const invalidNumericValues = workbook.rows.reduce((count, row) => count + workbook.presentFields.filter(field => typeof row[field] !== 'number').length, 0);
const calculated = workbook.rows.map(calculateProfitabilityAmounts);
const calculatedGrossProfit = calculated.reduce((sum, row) => sum + row.grossProfit, 0);
const reportedGrossProfit = Number(totals.reported_gross_profit || 0);
const grossProfitMismatchRows = workbook.rows.filter((row, index) => typeof row.reported_gross_profit === 'number' && Math.abs(row.reported_gross_profit - calculated[index].grossProfit) > 0.01).length;
const grossMarginMismatchRows = workbook.rows.filter((row, index) => typeof row.reported_gross_margin === 'number' && Math.abs(row.reported_gross_margin - calculated[index].grossMargin) > 0.01).length;
const grossMarginMismatchByTolerance = Object.fromEntries([0.01, 0.1, 0.5, 1].map(tolerance => [String(tolerance), workbook.rows.filter((row, index) => typeof row.reported_gross_margin === 'number' && Math.abs(row.reported_gross_margin - calculated[index].grossMargin) > tolerance).length]));
const marginScaleHistogram = Object.entries(workbook.rows.reduce((counts, row, index) => {
  if (typeof row.reported_gross_margin !== 'number' || Math.abs(calculated[index].grossMargin) < 0.000001) return counts;
  const ratio = (row.reported_gross_margin / calculated[index].grossMargin).toFixed(2);
  counts[ratio] = (counts[ratio] || 0) + 1;
  return counts;
}, {})).sort((left, right) => right[1] - left[1]).slice(0, 10);

console.log(JSON.stringify({
  fileName: basename(inputPath),
  sizeBytes: fileStats.size,
  sheets: summaries,
  parsed: {
    inputRows: workbook.inputRows,
    canonicalRows: workbook.rows.length,
    replacedDuplicateRows: workbook.replacedDuplicateRows,
    dateStart: workbook.dateStart,
    dateEnd: workbook.dateEnd,
    presentFields: workbook.presentFields,
    marginTypeCounts,
    invalidNumericValues,
    totals,
    calculatedGrossProfit,
    reportedGrossProfit,
    grossProfitDelta: calculatedGrossProfit - reportedGrossProfit,
    grossProfitMismatchRows,
    grossMarginMismatchRows,
    grossMarginMismatchByTolerance,
    marginScaleHistogram,
  },
}, null, 2));
