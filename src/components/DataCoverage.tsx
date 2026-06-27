import { useMemo, useSyncExternalStore } from 'react';
import { subscribe, getVersion, getMetrics } from '../data/store';

function fmt(d: string) {
  const [y, m, day] = d.split('-');
  return `${day}.${m}.${y}`;
}

function addDays(d: string, n: number): string {
  const dt = new Date(Number(d.slice(0, 4)), Number(d.slice(5, 7)) - 1, Number(d.slice(8)));
  dt.setDate(dt.getDate() + n);
  const y = dt.getFullYear();
  const mo = String(dt.getMonth() + 1).padStart(2, '0');
  const dd = String(dt.getDate()).padStart(2, '0');
  return `${y}-${mo}-${dd}`;
}

function eachDay(from: string, to: string): string[] {
  const days: string[] = [];
  let cur = from;
  while (cur <= to) {
    days.push(cur);
    cur = addDays(cur, 1);
  }
  return days;
}

const SOURCE_KEYS: { key: string; label: string; test: (m: import('../types').DailyMetrics) => boolean }[] = [
  { key: 'wb_funnel', label: 'Воронка WB', test: m => m.ordered_amount > 0 || m.impressions > 0 },
  { key: 'xway', label: 'XWay Реклама', test: m => m.ad_spend > 0 },
  { key: 'profitability', label: 'Рентабельность', test: m => m.actual_profit !== 0 || m.actual_margin !== 0 },
];

export default function DataCoverage() {
  const version = useSyncExternalStore(subscribe, getVersion);

  const rows = useMemo(() => {
    const metrics = getMetrics();
    if (!metrics.length) return [];

    return SOURCE_KEYS.map(sk => {
      const dates = new Set<string>();
      for (const m of metrics) {
        if (sk.test(m)) dates.add(m.date);
      }
      if (!dates.size) return { ...sk, start: '', end: '', dayCount: 0, rangeDays: 0, gaps: 0 };

      const sorted = [...dates].sort();
      const start = sorted[0];
      const end = sorted[sorted.length - 1];
      const dayCount = sorted.length;
      const allDays = eachDay(start, end);
      const rangeDays = allDays.length;
      const present = new Set(sorted);
      const gaps = allDays.filter(d => !present.has(d)).length;

      return { ...sk, start, end, dayCount, rangeDays, gaps };
    });
  }, [version]);

  if (!rows.length) return null;

  const hasAny = rows.some(r => r.dayCount > 0);
  if (!hasAny) return null;

  return (
    <div className="data-coverage">
      <h3 className="coverage-title">Покрытие данных</h3>
      <table className="coverage-table">
        <thead>
          <tr>
            <th>Тип</th>
            <th>Период</th>
            <th>Дней</th>
            <th>Покрытие</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(r => (
            <tr key={r.key}>
              <td className="coverage-source">{r.label}</td>
              <td className="coverage-range">
                {r.dayCount > 0 ? (
                  r.start === r.end
                    ? fmt(r.start)
                    : `${fmt(r.start)} — ${fmt(r.end)}`
                ) : '—'}
              </td>
              <td className="coverage-count">{r.dayCount > 0 ? `${r.dayCount}/${r.rangeDays}` : '—'}</td>
              <td className={`coverage-pct ${r.gaps > 0 ? 'has-gaps' : 'full'}`}>
                {r.dayCount > 0 ? (
                  r.gaps > 0
                    ? `есть пропуски (${r.gaps} дн.)`
                    : 'нет пропусков'
                ) : '—'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}