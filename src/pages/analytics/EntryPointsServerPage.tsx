import { useEffect, useMemo, useState } from 'react';
import { Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import AnalyticsHelp from '../../components/AnalyticsHelp';
import DateRangeFilter from '../../components/DateRangeFilter';
import { AnalyticsPageHeader, AnalyticsPanel, AnalyticsToolbar, EmptyState, KpiTile, PanelHeader, SegmentedControl } from '../../components/AnalyticsPrimitives';
import { loadEntryPointsFilterOptions, loadEntryPointsMatrix, loadEntryPointsProductLeaders, loadEntryPointsSeries, loadEntryPointsSummary } from '../../features/entryPoints/entryPointsData';
import type { EntryPointsFilterOptions, EntryPointsFilters, EntryPointsMatrixRow, EntryPointsMetric, EntryPointsProductLeader, EntryPointsSeriesRow, EntryPointsSummary } from '../../features/entryPoints/entryPointsDataCore';
import { entryPointsHelp } from './analyticsHelpContent';

const EMPTY_OPTIONS: EntryPointsFilterOptions = { minDate: null, maxDate: null, cabinetCount: 0, productCount: 0, sections: [], entryPoints: [] };
const EMPTY_SUMMARY: EntryPointsSummary = { impressions: 0, clicks: 0, carts: 0, orders: 0, pointCount: 0, productCount: 0 };
const metricLabels: Record<EntryPointsMetric, string> = { impressions: 'Показы', clicks: 'Переходы', carts: 'Корзины', orders: 'Заказы' };
const topChannels = [{ key: 'поиск', label: 'Поиск' }, { key: 'карточк', label: 'Карточка товара' }, { key: 'ссылк', label: 'Переходы по ссылке' }];
const nf = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 1 });

function shiftDate(value: string, days: number) {
  const date = new Date(`${value}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}
function rangeDays(start: string, end: string) { return Math.round((Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86_400_000) + 1; }
function ratio(numerator: number, denominator: number) { return denominator ? numerator / denominator * 100 : null; }
function pct(value: number | null) { return value === null ? '—' : `${nf.format(value)}%`; }
function delta(current: number, previous: number) { return previous ? (current - previous) / Math.abs(previous) * 100 : current === 0 ? 0 : null; }
function formatDelta(value: number | null) { return value === null ? '—' : `${value > 0 ? '+' : ''}${nf.format(value)}%`; }

export default function EntryPointsServerPage() {
  const today = useMemo(() => new Date().toISOString().slice(0, 10), []);
  const [period, setPeriod] = useState({ start: shiftDate(today, -731), end: today });
  const [bounds, setBounds] = useState({ minDate: '', maxDate: '' });
  const [options, setOptions] = useState<EntryPointsFilterOptions>(EMPTY_OPTIONS);
  const [summary, setSummary] = useState<EntryPointsSummary>(EMPTY_SUMMARY);
  const [previous, setPrevious] = useState<EntryPointsSummary>(EMPTY_SUMMARY);
  const [series, setSeries] = useState<EntryPointsSeriesRow[]>([]);
  const [matrix, setMatrix] = useState<EntryPointsMatrixRow[]>([]);
  const [leaders, setLeaders] = useState<Array<{ label: string; rows: EntryPointsProductLeader[] }>>([]);
  const [section, setSection] = useState('');
  const [entryPoint, setEntryPoint] = useState('');
  const [search, setSearch] = useState('');
  const [appliedSearch, setAppliedSearch] = useState('');
  const [metric, setMetric] = useState<EntryPointsMetric>('orders');
  const [ready, setReady] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [request, setRequest] = useState(0);
  const [showHelp, setShowHelp] = useState(false);

  useEffect(() => {
    let active = true;
    queueMicrotask(() => { if (active) { setLoading(true); setError(''); } });
    loadEntryPointsFilterOptions({ start: shiftDate(today, -731), end: today })
      .then(value => {
        if (!active) return;
        setOptions(value);
        if (value.minDate && value.maxDate) {
          setBounds({ minDate: value.minDate, maxDate: value.maxDate });
          setPeriod({ start: value.minDate, end: value.maxDate });
        }
        setReady(true);
      })
      .catch(reason => { if (active) setError(reason instanceof Error ? reason.message : 'Не удалось определить период данных'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [request, today]);

  useEffect(() => {
    if (!ready) return;
    let active = true;
    const filters: EntryPointsFilters = { start: period.start, end: period.end, search: appliedSearch || null, section: section || null, entryPoint: entryPoint || null };
    const days = rangeDays(period.start, period.end);
    const previousFilters: EntryPointsFilters = { ...filters, start: shiftDate(period.start, -days), end: shiftDate(period.start, -1) };
    queueMicrotask(() => { if (active) { setLoading(true); setError(''); } });
    Promise.all([
      loadEntryPointsFilterOptions({ start: period.start, end: period.end, section: section || null }),
      loadEntryPointsSummary(filters), loadEntryPointsSummary(previousFilters), loadEntryPointsSeries(filters),
      loadEntryPointsMatrix(filters, metric, 100),
      Promise.all(topChannels.map(channel => loadEntryPointsProductLeaders({ start: period.start, end: period.end }, channel.key, metric, 5).then(rows => ({ label: channel.label, rows })))),
    ]).then(([nextOptions, nextSummary, nextPrevious, nextSeries, nextMatrix, nextLeaders]) => {
      if (!active) return;
      setOptions(nextOptions); setSummary(nextSummary); setPrevious(nextPrevious); setSeries(nextSeries); setMatrix(nextMatrix); setLeaders(nextLeaders);
    }).catch(reason => {
      if (!active) return;
      setSummary(EMPTY_SUMMARY); setPrevious(EMPTY_SUMMARY); setSeries([]); setMatrix([]); setLeaders([]);
      setError(reason instanceof Error ? reason.message : 'Не удалось загрузить серверный срез «Точек входа»');
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [appliedSearch, entryPoint, metric, period.end, period.start, ready, request, section]);

  const matrixGroups = useMemo(() => {
    const groups = new Map<string, EntryPointsMatrixRow[]>();
    matrix.forEach(row => { const key = `${row.section}\u001f${row.entryPoint}`; const current = groups.get(key) || []; current.push(row); groups.set(key, current); });
    return [...groups.entries()].map(([key, rows]) => ({ key, section: rows[0].section, entryPoint: rows[0].entryPoint, total: rows.reduce((sum, row) => sum + row[metric], 0), rows })).sort((a, b) => b.total - a.total);
  }, [matrix, metric]);
  const visibleDates = useMemo(() => [...new Set(matrix.map(row => row.date))].sort().slice(-30), [matrix]);
  const structure = matrixGroups.slice(0, 10).map(row => ({ name: row.entryPoint, value: row.total }));
  const kpis = [
    { label: 'Показы', value: summary.impressions, previous: previous.impressions, details: `CTR ${pct(ratio(summary.clicks, summary.impressions))}` },
    { label: 'Переходы', value: summary.clicks, previous: previous.clicks, details: `CR корзины ${pct(ratio(summary.carts, summary.clicks))}` },
    { label: 'Заказы', value: summary.orders, previous: previous.orders, details: `CR переход → заказ ${pct(ratio(summary.orders, summary.clicks))}` },
    { label: 'Точки входа', value: summary.pointCount, previous: previous.pointCount, details: `${summary.productCount} товаров` },
  ];

  if (showHelp) return <section className="entry-page"><AnalyticsHelp data={entryPointsHelp} onClose={() => setShowHelp(false)} /></section>;
  return <section className="entry-page entry-page-server analytics-page-shell ds-page">
    <AnalyticsPageHeader eyebrow="Аналитика › Трафик" title="Структура трафика" description="Серверные точки входа, динамика и товарные лидеры без зависимости от локального хранилища." meta={<span>V5 · Supabase{bounds.maxDate ? ` · данные по ${bounds.maxDate}` : ''}</span>} actions={<button type="button" className="ds-button" onClick={() => setShowHelp(true)}>Справка</button>} />
    <AnalyticsToolbar className="entry-analytics-toolbar table-toolbar" status={<span>Источник: последняя опубликованная партия каждого доступного кабинета</span>} trailing={<button type="button" className="ds-button" onClick={() => { setSection(''); setEntryPoint(''); setSearch(''); setAppliedSearch(''); setMetric('orders'); if (bounds.minDate && bounds.maxDate) setPeriod({ start: bounds.minDate, end: bounds.maxDate }); }}>Сбросить</button>}>
      <DateRangeFilter label="Период" value={period} onChange={setPeriod} maxDate={bounds.maxDate || today} />
      <select className="entry-context-select" aria-label="Раздел" value={section} onChange={event => { setSection(event.target.value); setEntryPoint(''); }}><option value="">Все разделы</option>{options.sections.map(item => <option key={item}>{item}</option>)}</select>
      <select className="entry-context-select" aria-label="Точка входа" value={entryPoint} onChange={event => setEntryPoint(event.target.value)}><option value="">Все точки входа</option>{options.entryPoints.map(item => <option key={item}>{item}</option>)}</select>
      <form className="entry-server-search" onSubmit={event => { event.preventDefault(); setAppliedSearch(search.trim()); }}><input value={search} onChange={event => setSearch(event.target.value)} placeholder="SKU или товар" aria-label="Поиск товара" /><button type="submit" className="ds-button">Найти</button></form>
    </AnalyticsToolbar>

    {loading ? <EmptyState title="Загрузка данных V5" description="Получаем серверные агрегаты без загрузки полного отчёта в браузер." /> : error ? <EmptyState title="Не удалось загрузить «Точки входа» V5" description={error} action={<button type="button" className="ds-button" onClick={() => { setReady(false); setRequest(value => value + 1); }}>Повторить</button>} /> : !summary.impressions && !summary.orders ? <EmptyState title="Нет опубликованных точек входа" description="Импортируйте .xlsx «Точки входа» в V5 или измените период и фильтры." /> : <>
      <section className="entry-kpis ds-kpi-grid" aria-label="Ключевые показатели точек входа">{kpis.map(item => { const change = delta(item.value, item.previous); return <KpiTile key={item.label} className="entry-kpi" label={item.label} value={nf.format(item.value)} delta={formatDelta(change)} comparison={change === null ? 'нет базы сравнения' : 'к прошлому периоду'} tone={change === null ? 'neutral' : change >= 0 ? 'positive' : 'negative'} details={item.details} />; })}</section>
      <AnalyticsPanel density="analytics" className="entry-top-card"><PanelHeader title="Топ-5 товаров по каналам" description="Товар агрегируется внутри раздела один раз; рейтинг строится на сервере." controls={<SegmentedControl value={metric} label="Метрика рейтинга" options={(Object.keys(metricLabels) as EntryPointsMetric[]).map(value => ({ value, label: metricLabels[value] }))} onChange={setMetric} />} /><div className="entry-top-grid">{leaders.map(channel => <article key={channel.label} className="entry-top-column"><h3>{channel.label}</h3>{channel.rows.map((row, index) => <div key={row.productId} className="entry-top-row"><span>{index + 1}</span><div><strong>{row.productName}</strong><small>{row.sellerSku || row.wbSku || 'Без артикула'}</small></div><b>{nf.format(row[metric])}</b></div>)}{!channel.rows.length && <small>Нет данных</small>}</article>)}</div></AnalyticsPanel>
      <AnalyticsPanel density="data" className="entry-matrix-card"><PanelHeader title="Точки входа по дням" description={`Top-${matrixGroups.length} по метрике «${metricLabels[metric]}», до 30 последних дней`} /><div className="entry-matrix-wrap"><table className="entry-matrix"><thead><tr><th>Раздел / точка входа</th>{visibleDates.map(date => <th key={date}>{date.slice(5)}</th>)}<th>Итого</th></tr></thead><tbody>{matrixGroups.map(group => { const byDate = new Map(group.rows.map(row => [row.date, row])); return <tr key={group.key}><td><strong>{group.entryPoint}</strong><small>{group.section}</small></td>{visibleDates.map(date => <td key={date}>{nf.format(byDate.get(date)?.[metric] || 0)}</td>)}<td><strong>{nf.format(group.total)}</strong></td></tr>; })}</tbody></table></div></AnalyticsPanel>
      <div className="entry-bottom-grid">
        <AnalyticsPanel density="analytics"><PanelHeader title="Динамика" description={`${metricLabels[metric]} по дням`} /><ResponsiveContainer width="100%" height={280}><LineChart data={series}><CartesianGrid stroke="var(--ds-color-border-soft)" strokeDasharray="3 3" /><XAxis dataKey="date" tickFormatter={value => String(value).slice(5)} minTickGap={28} /><YAxis /><Tooltip formatter={value => [nf.format(Number(value)), metricLabels[metric]]} /><Line type="monotone" dataKey={metric} stroke="#2563EB" strokeWidth={2.5} dot={false} /></LineChart></ResponsiveContainer></AnalyticsPanel>
        <AnalyticsPanel density="analytics"><PanelHeader title="Структура каналов" description={`Top-10 точек по метрике «${metricLabels[metric]}»`} /><ResponsiveContainer width="100%" height={280}><BarChart data={structure} layout="vertical" margin={{ left: 24 }}><CartesianGrid stroke="var(--ds-color-border-soft)" strokeDasharray="3 3" /><XAxis type="number" /><YAxis type="category" dataKey="name" width={120} tick={{ fontSize: 10 }} /><Tooltip formatter={value => [nf.format(Number(value)), metricLabels[metric]]} /><Bar dataKey="value" fill="#10A778" radius={[0, 4, 4, 0]} /></BarChart></ResponsiveContainer></AnalyticsPanel>
      </div>
      <AnalyticsPanel density="data" className="entry-server-boundary"><PanelHeader title="Граница финансового блока" description="Деньги пока не подмешиваются из V4." /><p>Сумма заказов, прибыль, реклама, ДРР, рентабельность и контроль «Нераспределено» появятся после серверного переноса воронки/XWay и рентабельности. Текущий режим показывает только показатели, реально содержащиеся в файле «Точки входа».</p></AnalyticsPanel>
    </>}
  </section>;
}
