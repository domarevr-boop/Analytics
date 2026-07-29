import type { ProfitabilityRecord } from '../types';

export function getReportMargin(record: ProfitabilityRecord): number {
  if (record.actual_margin !== 0 || record.actual_profit === 0 || record.profit_revenue === 0) {
    return record.actual_margin;
  }
  return record.actual_profit / record.profit_revenue * 100;
}

export function getReportGrossProfit(record: ProfitabilityRecord): number {
  return record.profit_revenue * getReportMargin(record) / 100;
}

export function getReportNetProfit(record: ProfitabilityRecord, extraExpensePct: number): number {
  return record.profit_revenue * (getReportMargin(record) - extraExpensePct) / 100;
}
