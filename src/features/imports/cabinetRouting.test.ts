import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildCabinetRoutingPlan,
  cabinetRoutingError,
  subsetWorkbookByCabinet,
} from './cabinetRouting.ts';

const cabinets = [
  { id: 'one', externalKey: 'cab-1', name: 'Светпланет' },
  { id: 'two', externalKey: 'cab-2', name: 'Ледситипро' },
];

test('routes seller SKUs by the V4 cabinet prefixes', () => {
  const plan = buildCabinetRoutingPlan([
    { seller_sku: '30001' },
    { seller_sku: ' 40002.0 ' },
    { seller_sku: '50003' },
  ], cabinets);

  assert.deepEqual(plan.routes.map(route => [route.cabinet.id, route.rowIndexes]), [
    ['one', [0, 1]],
    ['two', [2]],
  ]);
  assert.deepEqual(plan.unresolvedRowIndexes, []);
});

test('reports unknown prefixes instead of assigning the wrong cabinet', () => {
  const plan = buildCabinetRoutingPlan([{ seller_sku: '90001' }, { wb_sku: '123' }], cabinets);
  assert.deepEqual(plan.unresolvedRowIndexes, [0, 1]);
  assert.match(cabinetRoutingError(plan, [17, 18]), /строки 17, 18/u);
});

test('matches cabinets by name when legacy external keys are unavailable', () => {
  const plan = buildCabinetRoutingPlan([{ seller_sku: '50001' }], [
    { id: 'generated', externalKey: 'other', name: ' ЛЕДСИТИПРО ' },
  ]);
  assert.equal(plan.routes[0]?.cabinet.id, 'generated');
});

test('creates a cabinet workbook subset with aligned source rows and dates', () => {
  const workbook = {
    rows: [
      { date: '2026-09-03', seller_sku: '30001' },
      { date: '2026-09-01', seller_sku: '50001' },
    ],
    sourceRowNumbers: [7, 9],
    inputRows: 2,
    replacedDuplicateRows: 1,
    dateStart: '2026-09-01',
    dateEnd: '2026-09-03',
  };
  const subset = subsetWorkbookByCabinet(workbook, [1]);
  assert.deepEqual(subset.rows, [workbook.rows[1]]);
  assert.deepEqual(subset.sourceRowNumbers, [9]);
  assert.equal(subset.inputRows, 1);
  assert.equal(subset.replacedDuplicateRows, 0);
  assert.equal(subset.dateStart, '2026-09-01');
  assert.equal(subset.dateEnd, '2026-09-01');
});
