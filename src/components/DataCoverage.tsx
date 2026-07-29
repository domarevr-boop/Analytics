import { useMemo, useSyncExternalStore } from 'react';
import { getEntryPoints, getGeographyOrders, getMetrics, getMonthlyPlans, getNicheDynamics, getProfitabilityRecords, getSearchQueries, getVersion, subscribe } from '../data/store';

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

export default function DataCoverage() {
  const version = useSyncExternalStore(subscribe, getVersion);
  const rows = useMemo(() => {
    const metrics = getMetrics();
    const profitabilityDates: string[] = [];
    for (const record of getProfitabilityRecords()) profitabilityDates.push(...eachDay(record.period_start, record.period_end || record.period_start));
    const planDates: string[] = [];
    for (const month of new Set(getMonthlyPlans().map(record => record.month))) {
      const [year, monthNumber] = month.split('-').map(Number);
      const end = new Date(year, monthNumber, 0).toISOString().slice(0, 10);
      planDates.push(...eachDay(`${month}-01`, end));
    }
    return [
      coverage('wb_funnel', 'Воронка WB', metrics.filter(item => item.ordered_amount > 0 || item.impressions > 0).map(item => item.date)),
      coverage('xway', 'XWay Реклама', metrics.filter(item => item.ad_spend > 0 || item.ad_impressions > 0).map(item => item.date)),
      coverage('profitability', 'Рентабельность', profitabilityDates),
      coverage('geography', 'География заказов', getGeographyOrders().map(item => item.date)),
      coverage('entry_points', 'Точки входа', getEntryPoints().map(item => item.date)),
      coverage('search_queries', 'Поисковые запросы WB', getSearchQueries().map(item => item.date)),
      coverage('niche_dynamics', 'Динамика ниши', getNicheDynamics().map(item => item.date)),
      coverage('plan_template', 'План', planDates),
    ];
  }, [version]);

  if (!rows.some(row => row.dayCount > 0)) return null;

  return <div className="data-coverage">
    <div className="import-section-head"><div><h3 className="coverage-title">Покрытие данных</h3><p>Фактически сохранённый период и наличие пропущенных дней</p></div></div>
    <table className="coverage-table"><thead><tr><th>Отчёт</th><th>Период данных</th><th>Дней</th><th>Покрытие</th></tr></thead><tbody>{rows.map(row => <tr key={row.key} className={!row.dayCount ? 'coverage-empty-row' : ''}><td className="coverage-source">{row.label}</td><td className="coverage-range">{row.dayCount ? row.start === row.end ? fmt(row.start) : `${fmt(row.start)} — ${fmt(row.end)}` : 'Нет данных'}</td><td className="coverage-count">{row.dayCount ? `${row.dayCount}/${row.rangeDays}` : '—'}</td><td className={`coverage-pct ${row.gaps > 0 ? 'has-gaps' : row.dayCount ? 'full' : ''}`}>{row.dayCount ? row.gaps ? `Есть пропуски: ${row.gaps} дн.` : 'Нет пропусков' : 'Отчёт ещё не загружен'}</td></tr>)}</tbody></table>
  </div>;
}
