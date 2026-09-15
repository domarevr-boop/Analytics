import { stat } from 'node:fs/promises';
import { extname, resolve } from 'node:path';
import readExcelFile from 'read-excel-file/node';
import { extractFunnelWorkbook } from '../src/features/funnel/funnelImportCore.ts';
import { buildCabinetRoutingPlan, cabinetRoutingError, cabinetRoutingSummary } from '../src/features/imports/cabinetRouting.ts';

const inputPath = process.argv[2] ? resolve(process.argv[2]) : '';
const source = process.argv[3] === 'wb_funnel' ? 'wb_funnel' : 'xway';
const fail = message => { console.error(`V5 funnel file audit failed: ${message}`); process.exit(1); };

if (!inputPath) fail('pass an .xlsx report path and optional source (xway or wb_funnel)');
if (extname(inputPath).toLocaleLowerCase('en-US') !== '.xlsx') fail('the control report must be .xlsx');
const fileStats = await stat(inputPath).catch(() => null);
if (!fileStats?.isFile()) fail('the control report does not exist');

const sheets = await readExcelFile(inputPath);
const workbook = extractFunnelWorkbook(sheets.map(sheet => ({ name: sheet.sheet, data: sheet.data })), source);
const totals = Object.fromEntries(workbook.presentMetricFields.map(field => [
  field,
  workbook.rows.reduce((sum, row) => sum + (typeof row[field] === 'number' ? row[field] : 0), 0),
]));
const invalidNumericValues = workbook.rows.reduce((count, row) => count
  + workbook.presentMetricFields.filter(field => typeof row[field] !== 'number').length, 0);
const routing = buildCabinetRoutingPlan(workbook.rows, [
  { id: 'cab-1', externalKey: 'cab-1', name: 'Светпланет' },
  { id: 'cab-2', externalKey: 'cab-2', name: 'Ледситипро' },
]);
const routingError = cabinetRoutingError(routing, workbook.sourceRowNumbers);

console.log(JSON.stringify({
  source: workbook.source,
  sheetName: workbook.sheetName,
  inputRows: workbook.inputRows,
  canonicalRows: workbook.rows.length,
  aggregatedRows: workbook.aggregatedRows,
  dateStart: workbook.dateStart,
  dateEnd: workbook.dateEnd,
  presentMetricFields: workbook.presentMetricFields,
  invalidNumericValues,
  cabinetRoutes: cabinetRoutingSummary(routing),
  routingError: routingError || null,
  totals,
}, null, 2));
