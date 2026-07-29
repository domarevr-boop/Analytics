import { useMemo, useSyncExternalStore } from 'react';
import { getImportLog, getLocalDataVolumes, getMonthlyPlans, getVersion, subscribe } from '../data/store';
import type { ImportFileLog, ImportSource } from '../types';

function fmt(date: string) {
  const [year, month, day] = date.split('-');
  return `${day}.${month}.${year}`;
}

const DAY_MS = 86_400_000;
type DayInterval = { start: number; end: number };

function formatVolume(bytes: number, estimated: boolean) {
  const prefix = estimated ? '≈ ' : '';
  if (!bytes) return '—';
  if (bytes < 1024 * 1024) return `${prefix}${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${prefix}${(bytes / (1024 * 1024)).toLocaleString('ru-RU', { maximumFractionDigits: 1 })} MB`;
}

function parseIsoDay(value: string | undefined): number | null {
  const match = value?.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const timestamp = Date.UTC(year, month - 1, day);
  const normalized = new Date(timestamp).toISOString().slice(0, 10);
  return normalized === value ? Math.floor(timestamp / DAY_MS) : null;
}

function isoFromDay(day: number): string {
  return new Date(day * DAY_MS).toISOString().slice(0, 10);
}

function coverageFromIntervals(key: string, label: string, intervals: DayInterval[]) {
  const sorted = intervals
    .filter(interval => Number.isFinite(interval.start) && Number.isFinite(interval.end) && interval.end >= interval.start)
    .sort((left, right) => left.start - right.start || left.end - right.end);
  if (!sorted.length) return { key, label, start: '', end: '', dayCount: 0, rangeDays: 0, gaps: 0 };

  const merged: DayInterval[] = [];
  for (const interval of sorted) {
    const previous = merged.at(-1);
    if (previous && interval.start <= previous.end + 1) previous.end = Math.max(previous.end, interval.end);
    else merged.push({ ...interval });
  }

  const startDay = merged[0].start;
  const endDay = merged.at(-1)!.end;
  const dayCount = merged.reduce((sum, interval) => sum + interval.end - interval.start + 1, 0);
  const rangeDays = endDay - startDay + 1;
  return { key, label, start: isoFromDay(startDay), end: isoFromDay(endDay), dayCount, rangeDays, gaps: rangeDays - dayCount };
}

function coverageFromLogs(source: ImportSource, label: string, logs: ImportFileLog[]) {
  const intervals: DayInterval[] = [];
  for (const log of logs) {
    if (log.source !== source || log.status !== 'success' || !log.dataStart) continue;
    const start = parseIsoDay(log.dataStart);
    const end = parseIsoDay(log.dataEnd || log.dataStart);
    if (start !== null && end !== null) intervals.push({ start, end });
  }
  return coverageFromIntervals(source, label, intervals);
}

export default function DataCoverage() {
  const version = useSyncExternalStore(subscribe, getVersion);
  const volumes = useMemo(() => getLocalDataVolumes(), [version]);
  const rows = useMemo(() => {
    const logs = getImportLog();
    const planIntervals: DayInterval[] = [];
    for (const month of new Set(getMonthlyPlans().map(record => record.month))) {
      const match = month.match(/^(\d{4})-(\d{2})$/);
      if (!match) continue;
      const year = Number(match[1]);
      const monthNumber = Number(match[2]);
      if (monthNumber < 1 || monthNumber > 12) continue;
      const start = Math.floor(Date.UTC(year, monthNumber - 1, 1) / DAY_MS);
      const end = Math.floor(Date.UTC(year, monthNumber, 0) / DAY_MS);
      planIntervals.push({ start, end });
    }
    return [
      coverageFromLogs('wb_funnel', 'Воронка WB', logs),
      coverageFromLogs('xway', 'XWay Реклама', logs),
      coverageFromLogs('profitability', 'Рентабельность', logs),
      coverageFromLogs('geography', 'География заказов', logs),
      coverageFromLogs('entry_points', 'Точки входа', logs),
      coverageFromLogs('search_queries', 'Поисковые запросы WB', logs),
      coverageFromLogs('niche_dynamics', 'Динамика ниши', logs),
      coverageFromIntervals('plan_template', 'План', planIntervals),
    ];
  }, [version]);

  if (!rows.some(row => row.dayCount > 0)) return null;

  return <div className="data-coverage">
    <div className="import-section-head"><div><h3 className="coverage-title">Покрытие данных</h3><p>Подтверждённые периоды успешных импортов без полного обхода локальной базы</p></div></div>
    <table className="coverage-table"><thead><tr><th>Отчёт</th><th>Период данных</th><th>Дней</th><th>Покрытие</th></tr></thead><tbody>{rows.map(row => { const volume = volumes[row.key as ImportSource]; return <tr key={row.key} className={!row.dayCount ? 'coverage-empty-row' : ''}><td className="coverage-source"><span>{row.label}</span><small title="Оценка объёма записей отчёта">{formatVolume(volume.bytes, volume.estimated)}</small></td><td className="coverage-range">{row.dayCount ? row.start === row.end ? fmt(row.start) : `${fmt(row.start)} — ${fmt(row.end)}` : 'Нет данных'}</td><td className="coverage-count">{row.dayCount ? `${row.dayCount}/${row.rangeDays}` : '—'}</td><td className={`coverage-pct ${row.gaps > 0 ? 'has-gaps' : row.dayCount ? 'full' : ''}`}>{row.dayCount ? row.gaps ? `Есть пропуски: ${row.gaps} дн.` : 'Нет пропусков' : 'Отчёт ещё не загружен'}</td></tr>; })}</tbody></table>
  </div>;
}
