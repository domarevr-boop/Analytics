import test from 'node:test';
import assert from 'node:assert/strict';
import {
  assertV5DirectoryPageRequest,
  parseV5DirectoryFilters,
  parseV5DirectorySnapshot,
} from './directoryDataCore.ts';

const snapshotRow = {
  total_count: '1',
  product_id: 'product-1',
  cabinet_id: 'cabinet-1',
  cabinet_external_key: 'cabinet-one',
  cabinet_name: 'Кабинет 1',
  product_external_key: 'product-one',
  seller_sku: '40001',
  wb_sku: '223155786',
  product_name: 'Люстра',
  product_status: 'active',
  category_id: 'category-1',
  category_external_key: 'lights',
  category_name: 'Люстры',
  brand_id: null,
  brand_external_key: null,
  brand_name: null,
  group_known: true,
  group_id: 'group-1',
  group_external_key: 'СКЛ-003',
  group_name: 'СКЛ-003',
  is_ungrouped: false,
  group_effective_date: '2026-08-25',
};

test('maps a bounded directory snapshot without changing dated membership', () => {
  const page = parseV5DirectorySnapshot([snapshotRow]);
  assert.equal(page.totalCount, 1);
  assert.equal(page.rows[0].wbSku, '223155786');
  assert.equal(page.rows[0].group?.externalKey, 'СКЛ-003');
  assert.equal(page.rows[0].groupEffectiveDate, '2026-08-25');
  assert.equal(page.rows[0].brand, null);
});

test('keeps unknown membership distinct from the explicit ungrouped state', () => {
  const unknown = parseV5DirectorySnapshot([{
    ...snapshotRow,
    group_known: false,
    group_id: null,
    group_external_key: null,
    group_name: null,
    group_effective_date: null,
  }]);
  assert.equal(unknown.rows[0].groupKnown, false);
  assert.equal(unknown.rows[0].group, null);

  const ungrouped = parseV5DirectorySnapshot([{
    ...snapshotRow,
    group_external_key: '__ungrouped__',
    group_name: 'Без склейки',
    is_ungrouped: true,
  }]);
  assert.equal(ungrouped.rows[0].groupKnown, true);
  assert.equal(ungrouped.rows[0].isUngrouped, true);
});

test('validates page bounds and rejects contradictory server rows', () => {
  assert.deepEqual(assertV5DirectoryPageRequest({ asOf: '2026-08-25' }), {
    asOf: '2026-08-25', cabinetId: null, search: null, limit: 100, offset: 0,
  });
  assert.throws(() => assertV5DirectoryPageRequest({ asOf: '25.08.2026' }), /YYYY-MM-DD/);
  assert.throws(() => assertV5DirectoryPageRequest({ asOf: '2026-08-25', limit: 501 }), /от 1 до 500/);
  assert.throws(() => parseV5DirectorySnapshot([{ ...snapshotRow, group_known: false }]), /противоречивые данные/);
});

test('maps accessible filter dimensions and rejects duplicate ids', () => {
  const filters = parseV5DirectoryFilters({
    cabinets: [{ id: 'cabinet-1', external_key: 'cabinet-one', name: 'Кабинет 1' }],
    categories: [{ id: 'category-1', external_key: 'lights', name: 'Люстры' }],
    brands: [],
  });
  assert.equal(filters.cabinets[0].externalKey, 'cabinet-one');
  assert.throws(() => parseV5DirectoryFilters({
    cabinets: [
      { id: 'cabinet-1', external_key: 'one', name: 'Один' },
      { id: 'cabinet-1', external_key: 'two', name: 'Два' },
    ],
    categories: [], brands: [],
  }), /повтор cabinets.id/);
});
