import type { ProfitabilityRecord } from '../types';

let _data: ProfitabilityRecord[] = [];
let _version = 0;
const _listeners = new Set<() => void>();

function notify() {
  _version++;
  _listeners.forEach(fn => fn());
}

export function subscribeProfitability(fn: () => void) {
  _listeners.add(fn);
  return () => _listeners.delete(fn);
}

export function getProfitabilityVersion() { return _version; }

export function getProfitability(): ProfitabilityRecord[] {
  return _data.map(r => ({ ...r }));
}

export function getProfitabilityForProduct(productId: string): ProfitabilityRecord[] {
  return _data.filter(r => r.product_id === productId).map(r => ({ ...r }));
}

export function getProfitabilityForPeriod(productId: string, start: string, end: string): ProfitabilityRecord | undefined {
  return _data.find(r =>
    r.product_id === productId &&
    r.period_start === start &&
    r.period_end === end
  );
}

export function upsertProfitability(rec: ProfitabilityRecord) {
  const idx = _data.findIndex(r =>
    r.product_id === rec.product_id &&
    r.period_start === rec.period_start &&
    r.period_end === rec.period_end
  );
  if (idx >= 0) {
    _data[idx] = rec;
  } else {
    _data.push(rec);
  }
  notify();
}

export function deleteProfitability(id: string) {
  _data = _data.filter(r => r.id !== id);
  notify();
}

export function setProfitabilityAll(records: ProfitabilityRecord[]) {
  _data = records;
  notify();
}

export function getProfitabilityAggregated(productIds: string[], start: string, end: string) {
  let totalProfit = 0;
  let totalRevenue = 0;
  for (const pid of productIds) {
    const rec = getProfitabilityForPeriod(pid, start, end);
    if (rec) {
      totalProfit += rec.actual_profit;
      totalRevenue += rec.profit_revenue;
    }
  }
  const margin = totalRevenue ? (totalProfit / totalRevenue) * 100 : 0;
  return { totalProfit, totalRevenue, margin };
}
