import { readdir, stat } from 'node:fs/promises';
import { basename, extname, resolve } from 'node:path';
import readExcelFile from 'read-excel-file/node';
import { extractSearchQueriesWorkbook, SEARCH_QUERIES_MAX_FILE_BYTES } from '../src/features/searchQueries/searchQueriesImportCore.ts';

const inputs = process.argv.slice(2);
if (!inputs.length) {
  console.error('Usage: node scripts/audit-v5-search-queries.mjs <file-or-directory> [...]');
  process.exit(1);
}

async function expand(input) {
  const target = resolve(input);
  const info = await stat(target).catch(() => null);
  if (!info) return [];
  if (info.isFile()) return [target];
  if (!info.isDirectory()) return [];
  return (await readdir(target, { withFileTypes: true }))
    .filter(item => item.isFile() && extname(item.name).toLocaleLowerCase('en-US') === '.xlsx')
    .map(item => resolve(target, item.name));
}

const files = (await Promise.all(inputs.map(expand))).flat();
const results = [];
for (const file of files) {
  const info = await stat(file);
  if (info.size <= 0 || info.size > SEARCH_QUERIES_MAX_FILE_BYTES) continue;
  try {
    const sheets = await readExcelFile(file);
    const workbook = extractSearchQueriesWorkbook(sheets.map(sheet => ({ name: sheet.sheet, data: sheet.data })));
    const totals = workbook.rows.reduce((sum, row) => ({
      requests: sum.requests + Number(row.requests || 0),
      clicks: sum.clicks + Number(row.card_clicks || 0),
      carts: sum.carts + Number(row.carts || 0),
      orders: sum.orders + Number(row.orders || 0),
    }), { requests: 0, clicks: 0, carts: 0, orders: 0 });
    results.push({
      file: basename(file), bytes: info.size, sheet: workbook.sheetName,
      inputRows: workbook.inputRows, canonicalRows: workbook.rows.length,
      replacedDuplicateRows: workbook.replacedDuplicateRows,
      dateStart: workbook.dateStart, dateEnd: workbook.dateEnd,
      categoryCount: new Set(workbook.rows.map(row => String(row.category))).size,
      queryCount: new Set(workbook.rows.map(row => String(row.query))).size,
      ...totals,
    });
  } catch {
    // A directory may contain unrelated workbooks; they are intentionally ignored.
  }
}

console.log(JSON.stringify(results.sort((a, b) => b.canonicalRows - a.canonicalRows), null, 2));
if (!results.length) process.exitCode = 2;
