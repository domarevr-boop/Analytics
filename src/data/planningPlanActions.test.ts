import test from 'node:test';
import assert from 'node:assert/strict';
import type { AggregateMonthlyPlanRecord, AggregatePlanKind } from '../types/index.ts';
import { buildBackupRecords, buildPromotedFixedRecords, buildRestoredFixedRecords, removeBackupForYear } from './planningPlanActions.ts';

function record(kind: AggregatePlanKind, month: string, value: number, entity = 'lighting'): AggregateMonthlyPlanRecord {
  return {
    id: `${kind}|${month}|category|cab|${entity}`, kind, month, scope: 'category', cabinet_id: 'cab', entity_id: entity, entity_name: entity,
    orders_sum: value, avg_qty_per_day: null, avg_check: 2_000, buyout_rate: 80, payout_rate: 70, profitability: 20, updated_at: '',
  };
}

test('promotes only matching scenario records and preserves untouched fixed plans', () => {
  const records = [record('fixed', '2025-12', 1), record('fixed', '2026-01', 2), record('fixed', '2026-01', 6, 'decor'), record('scenario', '2026-01', 3), record('scenario', '2027-01', 4)];
  const promoted = buildPromotedFixedRecords(records, 2026);
  assert.deepEqual(promoted.map(item => [item.kind, item.month, item.entity_id, item.orders_sum]), [['fixed', '2025-12', 'lighting', 1], ['fixed', '2026-01', 'lighting', 3], ['fixed', '2026-01', 'decor', 6]]);
});

test('backs up and restores the selected year without retaining a stale backup', () => {
  const records = [record('fixed', '2026-01', 2), record('fixed', '2027-01', 7), record('backup', '2025-01', 5)];
  const backup = buildBackupRecords(records, 2026);
  const withBackup = [...records.filter(item => item.kind !== 'backup'), ...backup];
  const restored = buildRestoredFixedRecords(withBackup, 2026);
  assert.deepEqual(restored.map(item => [item.month, item.orders_sum]), [['2027-01', 7], ['2026-01', 2]]);
  assert.deepEqual(removeBackupForYear(withBackup, 2026).map(item => item.month), ['2025-01']);
});
