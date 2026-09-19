import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeGroupHistoryImport, removeReplacedGroupHistorySnapshots } from './groupHistoryImport.ts';

function snapshot(date: string, cabinet: string, prefix: string, groupFor: (index: number) => string, size = 30) {
  return Array.from({ length: size }, (_, index) => ({
    date,
    cabinet,
    sku: `${prefix}${String(index).padStart(3, '0')}`,
    wb_sku: `${prefix}9${String(index).padStart(4, '0')}`,
    group_code: groupFor(index),
  }));
}

test('keeps ordinary sparse dates and reports a missing cabinet snapshot', () => {
  const rows = [
    ...snapshot('2026-09-19', 'Первый', '4', () => 'A'),
    ...snapshot('2026-09-19', 'Второй', '5', () => 'B'),
    ...snapshot('2026-09-20', 'Первый', '4', () => 'A'),
    ...snapshot('2026-09-21', 'Первый', '4', () => 'A'),
    ...snapshot('2026-09-21', 'Второй', '5', () => 'B'),
  ];
  const analysis = analyzeGroupHistoryImport(rows);
  assert.equal(analysis.missingSnapshots.length, 1);
  assert.equal(analysis.missingSnapshots[0].date, '2026-09-20');
  assert.equal(analysis.acceptedRows.length, rows.length);
});

test('skips a mass change and compares the next date with the last accepted state', () => {
  const rows = [
    ...snapshot('2026-09-19', 'Первый', '4', () => 'A'),
    ...snapshot('2026-09-20', 'Первый', '4', index => index < 25 ? 'B' : 'A'),
    ...snapshot('2026-09-21', 'Первый', '4', () => 'A'),
  ];
  const analysis = analyzeGroupHistoryImport(rows);
  assert.equal(analysis.anomalies.filter(issue => issue.kind === 'mass_change').length, 1);
  assert.equal(analysis.acceptedRows.filter(row => row.date === '2026-09-20').length, 0);
  assert.equal(analysis.acceptedRows.filter(row => row.date === '2026-09-21').length, 30);
});

test('imports a confirmed mass change', () => {
  const rows = [
    ...snapshot('2026-09-19', 'Первый', '4', () => 'A'),
    ...snapshot('2026-09-20', 'Первый', '4', () => 'B'),
  ];
  const analysis = analyzeGroupHistoryImport(rows, undefined, undefined, { acceptAnomalies: true });
  assert.equal(analysis.anomalies.filter(issue => issue.kind === 'mass_change').length, 1);
  assert.equal(analysis.acceptedRows.length, rows.length);
});

test('accepts a mass transition automatically when the next snapshot confirms it', () => {
  const rows = [
    ...snapshot('2026-09-19', 'Первый', '4', () => 'A'),
    ...snapshot('2026-09-20', 'Первый', '4', () => 'B'),
    ...snapshot('2026-09-21', 'Первый', '4', () => 'B'),
  ];
  const analysis = analyzeGroupHistoryImport(rows);

  assert.equal(analysis.anomalies.filter(issue => issue.kind === 'mass_change').length, 0);
  assert.equal(analysis.acceptedRows.length, rows.length);
});

test('accepts changes up to 15 percent without confirmation', () => {
  const rows = [
    ...snapshot('2026-09-11', 'Второй', '5', () => 'СКЛ-014', 20),
    ...snapshot('2026-09-13', 'Второй', '5', index => index < 3 ? 'СКЛ-012' : 'СКЛ-014', 20),
  ];
  const analysis = analyzeGroupHistoryImport(rows);

  assert.equal(analysis.anomalies.length, 0);
  assert.equal(analysis.acceptedRows.length, rows.length);
});

test('requests confirmation when more than 15 percent changes', () => {
  const rows = [
    ...snapshot('2026-09-11', 'Второй', '5', () => 'СКЛ-014', 20),
    ...snapshot('2026-09-13', 'Второй', '5', index => index < 4 ? 'СКЛ-012' : 'СКЛ-014', 20),
  ];
  const analysis = analyzeGroupHistoryImport(rows);

  assert.equal(analysis.anomalies.length, 1);
  assert.equal(analysis.anomalies[0].changeRate, 0.2);
  assert.equal(analysis.acceptedRows.filter(row => row.date === '2026-09-13').length, 0);
});

test('marks ambiguous WB IDs as unsafe without rejecting stable seller SKUs', () => {
  const rows = [
    { date: '2026-09-19', cabinet: 'Первый', sku: '40001', wb_sku: '1008000000', group_code: 'A' },
    { date: '2026-09-19', cabinet: 'Первый', sku: '40002', wb_sku: '1008000000', group_code: 'A' },
    { date: '2026-09-20', cabinet: 'Первый', sku: '40001', wb_sku: '1007610189', group_code: 'A' },
  ];
  const analysis = analyzeGroupHistoryImport(rows);
  assert.equal(analysis.errors.length, 0);
  assert.equal(analysis.unsafeSellerKeys.has('name:первый|40001'), true);
  assert.equal(analysis.unsafeWbKeys.has('name:первый|1008000000'), true);
});

test('rejects a one-row cross-cabinet code without requesting confirmation', () => {
  const rows = [
    ...snapshot('2026-09-19', 'Второй', '5', () => 'СКЛ-012'),
    { date: '2026-09-19', cabinet: 'Первый', sku: '40581', wb_sku: '1507427752', group_code: 'СКЛ-012' },
  ];
  const analysis = analyzeGroupHistoryImport(rows);
  assert.equal(analysis.anomalies.length, 0);
  assert.equal(analysis.acceptedRows.some(row => row.sku === '40581'), false);
  assert.equal(analysis.warnings.some(message => message.includes('массово относящихся к другому кабинету')), true);
});

test('clears imported date and cabinet snapshots even when a cabinet is absent from that date', () => {
  const history = [
    { date: '2026-09-19', product_id: 'p1', group_id: 'A' },
    { date: '2026-09-20', product_id: 'p1', group_id: 'A' },
    { date: '2026-09-20', product_id: 'p2', group_id: 'B' },
    { date: '2026-09-20', product_id: 'unknown', group_id: 'C' },
    { date: '2026-09-20', product_id: 'duplicate', group_id: 'D' },
    { date: '2026-09-21', product_id: 'p2', group_id: 'B' },
  ];
  const result = removeReplacedGroupHistorySnapshots(
    history,
    new Map([['p1', 'cab-1'], ['p2', 'cab-2']]),
    new Set(['2026-09-20']),
    new Set(['cab-1', 'cab-2']),
    new Set(['duplicate']),
  );

  assert.deepEqual(result, [history[0], history[3], history[5]]);
});
