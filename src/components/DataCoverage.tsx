import { useMemo, useSyncExternalStore } from 'react';
import { getImportLog, getMonthlyPlans, getVersion, subscribe } from '../data/store';
import type { ImportFileLog, ImportSource } from '../types';

function fmt(date: string) {
  const [year, month, day] = date.split('-');
  return `${day}.${month}.${year}`;
}

function addDays(date: string, amount: number): string {
  const value = new Date(`${date}T00:00:00`);
  value.setDate(value.getDate() + amount);
  return value.toISOString().slice(0, 10);
}

function eachDay(from: string, to: string): string[] {
  const days: string[] = [];
  for (let current = from; current <= to; current = addDays(current, 1)) days.push(current);
  return days;
}

function coverage(key: string, label: string, values: Iterable<string>) {
  const dates = [...new Set(values)].filter(Boolean).sort();
  if (!dates.length) return { key, label, start: '', end: '', dayCount: 0, rangeDays: 0, gaps: 0 };
  const start = dates[0];
  const end = dates.at(-1)!;
  const fullRange = eachDay(start, end);
  const present = new Set(dates);
  return { key, label, start, end, dayCount: dates.length, rangeDays: fullRange.length, gaps: fullRange.filter(date => !present.has(date)).length };
}

function coverageFromLogs(source: ImportSource, label: string, logs: ImportFileLog[]) {
  const dates = new Set<string>();
  for (const log of logs) {
    if (log.source !== source || log.status !== 'success' || !log.dataStart) continue;
    const end = log.dataEnd || log.dataStart;
    for (const date of eachDay(log.dataStart, end)) dates.add(date);
  }
  return coverage(source, label, dates);
}

export default function DataCoverage() {
  const version = useSyncExternalStore(subscribe, getVersion);
  const rows = useMemo(() => {
    const logs = getImportLog();
    const planDates: string[] = [];
    for (const month of new Set(getMonthlyPlans().map(record => record.month))) {
      const [year, monthNumber] = month.split('-').map(Number);
      const end = new Date(year, monthNumber, 0).toISOString().slice(0, 10);
      planDates.push(...eachDay(`${month}-01`, end));
    }
    return [
      coverageFromLogs('wb_funnel', 'Воронка WB', logs),
      coverageFromLogs('xway', 'XWay Реклама', logs),
      coverageFromLogs('profitability', 'Рентабельность', logs),
      coverageFromLogs('geography', 'География заказов', logs),
      coverageFromLogs('entry_points', 'Точки входа', logs),
      coverageFromLogs('search_queries', 'Поисковые запросы WB', logs),
      coverageFromLogs('niche_dynamics', 'Динамика ниши', logs),
      coverage('plan_template', 'План', planDates),
    ];
  }, [version]);

  if (!rows.some(row => row.dayCount > 0)) return null;

  return <div className="data-coverage">
    <div className="import-section-head"><div><h3 className="coverage-title">Покрытие данных</h3><p>Подтверждённые периоды успешных импортов без полного обхода локальной базы</p></div></div>
    <table className="coverage-table"><thead><tr><th>Отчёт</th><th>Период данных</th><th>Дней</th><th>Покрытие</th></tr></thead><tbody>{rows.map(row => <tr key={row.key} className={!row.dayCount ? 'coverage-empty-row' : ''}><td className="coverage-source">{row.label}</td><td className="coverage-range">{row.dayCount ? row.start === row.end ? fmt(row.start) : `${fmt(row.start)} — ${fmt(row.end)}` : 'Нет данных'}</td><td className="coverage-count">{row.dayCount ? `${row.dayCount}/${row.rangeDays}` : '—'}</td><td className={`coverage-pct ${row.gaps > 0 ? 'has-gaps' : row.dayCount ? 'full' : ''}`}>{row.dayCount ? row.gaps ? `Есть пропуски: ${row.gaps} дн.` : 'Нет пропусков' : 'Отчёт ещё не загружен'}</td></tr>)}</tbody></table>
  </div>;
}
