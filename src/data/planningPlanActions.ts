import type { AggregateMonthlyPlanRecord, AggregatePlanKind } from '../types';
import { makeAggregatePlanId } from './planningCalculations.ts';

function cloneAs(record: AggregateMonthlyPlanRecord, kind: AggregatePlanKind): AggregateMonthlyPlanRecord {
  return {
    ...record,
    id: makeAggregatePlanId(kind, record.month, record.scope, record.cabinet_id, record.entity_id),
    kind,
    updated_at: new Date().toISOString(),
  };
}

export function buildBackupRecords(records: AggregateMonthlyPlanRecord[], year: number): AggregateMonthlyPlanRecord[] {
  const prefix = `${year}-`;
  return [
    ...records.filter(record => record.kind === 'backup' && !record.month.startsWith(prefix)),
    ...records.filter(record => record.kind === 'fixed' && record.month.startsWith(prefix)).map(record => cloneAs(record, 'backup')),
  ];
}

export function buildPromotedFixedRecords(records: AggregateMonthlyPlanRecord[], year: number): AggregateMonthlyPlanRecord[] {
  const prefix = `${year}-`;
  const fixed = new Map(records.filter(record => record.kind === 'fixed').map(record => [record.id, record]));
  for (const scenario of records.filter(record => record.kind === 'scenario' && record.scope === 'category' && record.month.startsWith(prefix))) {
    const promoted = cloneAs(scenario, 'fixed');
    fixed.set(promoted.id, promoted);
  }
  return [...fixed.values()];
}

export function buildRestoredFixedRecords(records: AggregateMonthlyPlanRecord[], year: number): AggregateMonthlyPlanRecord[] {
  const prefix = `${year}-`;
  return [
    ...records.filter(record => record.kind === 'fixed' && !record.month.startsWith(prefix)),
    ...records.filter(record => record.kind === 'backup' && record.month.startsWith(prefix)).map(record => cloneAs(record, 'fixed')),
  ];
}

export function removeBackupForYear(records: AggregateMonthlyPlanRecord[], year: number): AggregateMonthlyPlanRecord[] {
  const prefix = `${year}-`;
  return records.filter(record => record.kind === 'backup' && !record.month.startsWith(prefix));
}
