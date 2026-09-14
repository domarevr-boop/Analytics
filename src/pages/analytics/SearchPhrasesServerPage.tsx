import { useEffect, useMemo, useState } from 'react';
import { CartesianGrid, Cell, Line, LineChart, ResponsiveContainer, Scatter, ScatterChart, Tooltip, XAxis, YAxis, ZAxis } from 'recharts';
import AnalyticsHelp from '../../components/AnalyticsHelp';
import DateRangeFilter from '../../components/DateRangeFilter';
import { AnalyticsPageHeader, AnalyticsPanel, AnalyticsToolbar, EmptyState, KpiTile, PanelHeader, SegmentedControl } from '../../components/AnalyticsPrimitives';
import { loadSearchQueriesOptions, loadSearchQueriesRows, loadSearchQueriesSeries, loadSearchQueriesSummary } from '../../features/searchQueries/searchQueriesData';
import type { SearchQueriesFilters, SearchQueriesMetric, SearchQueriesOptions, SearchQueriesRow, SearchQueriesSeriesRow, SearchQueriesSort, SearchQueriesSummary } from '../../features/searchQueries/searchQueriesDataCore';
import { searchQueriesHelp } from './analyticsHelpContent';

const EMPTY_OPTIONS: SearchQueriesOptions = { minDate: null, maxDate: null, categoryCount: 0, queryCount: 0, categories: [] };
const EMPTY_SUMMARY: SearchQueriesSummary = { requests: 0, requestsPrevious: 0, cardClicks: 0, cardClicksPrevious: 0, carts: 0, cartsPrevious: 0, orders: 0, ordersPrevious: 0, orderAmount: 0, orderAmountPrevious: 0, queryCount: 0, ownOrders: null, ownOrdersShare: null };
const metricLabels: Record<SearchQueriesMetric, string> = { requests: 'Запросы', card_clicks: 'Переходы', carts: 'Корзины', orders: 'Заказы, шт', order_amount: 'Сумма заказов', products: 'Товары' };
const sortLabels: Record<SearchQueriesSort, string> = { requests: 'По запросам', growth: 'По росту', order_amount: 'По сумме заказов', orders: 'По заказам', cart_cr: 'По CR корзины', order_cr: 'По CR заказа', opportunity: 'По потенциалу', products: 'По конкуренции' };
const nf = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 1 });
const money = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 });
const competitionColors = { low: '#10B981', medium: '#F59E0B', high: '#EF5A67', none: '#94A3B8' };
function ratio(a: number, b: number) { return b ? a / b * 100 : null; }
function delta(current: number, previous: number) { return previous ? (current - previous) / previous * 100 : current ? 100 : 0; }
function pct(value: number | null) { return value === null ? '—' : `${value > 0 ? '+' : ''}${nf.format(value)}%`; }
function metricValue(row: SearchQueriesSeriesRow, metric: SearchQueriesMetric) {
  if (metric === 'card_clicks') return row.cardClicks;
  if (metric === 'order_amount') return row.orderAmount;
  return row[metric];
}
function previousMetricValue(row: SearchQueriesSeriesRow, metric: SearchQueriesMetric) {
  if (metric === 'card_clicks') return row.cardClicksPrevious;
  if (metric === 'order_amount') return row.orderAmountPrevious;
  if (metric === 'requests') return row.requestsPrevious;
  if (metric === 'carts') return row.cartsPrevious;
  if (metric === 'orders') return row.ordersPrevious;
  return row.productsPrevious;
}
function competitionFor(products: number, thresholds: { low: number; high: number }) {
  return !products ? 'none' : products <= thresholds.low ? 'low' : products <= thresholds.high ? 'medium' : 'high';
}

export default function SearchPhrasesServerPage() {
  const today = useMemo(() => new Date().toISOString().slice(0, 10), []);
  const [period, setPeriod] = useState({ start: '2026-01-01', end: today });
  const [options, setOptions] = useState<SearchQueriesOptions>(EMPTY_OPTIONS);
  const [summary, setSummary] = useState<SearchQueriesSummary>(EMPTY_SUMMARY);
  const [series, setSeries] = useState<SearchQueriesSeriesRow[]>([]);
  const [querySeries, setQuerySeries] = useState<SearchQueriesSeriesRow[]>([]);
  const [rows, setRows] = useState<SearchQueriesRow[]>([]);
  const [overviewRows, setOverviewRows] = useState<SearchQueriesRow[]>([]);
  const [category, setCategory] = useState('');
  const [search, setSearch] = useState('');
  const [appliedSearch, setAppliedSearch] = useState('');
  const [selectedQuery, setSelectedQuery] = useState('');
  const [metric, setMetric] = useState<SearchQueriesMetric>('requests');
  const [sort, setSort] = useState<SearchQueriesSort>('requests');
  const [page, setPage] = useState(0);
  const [ready, setReady] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [request, setRequest] = useState(0);
  const [showHelp, setShowHelp] = useState(false);
  const pageSize = 50;

  useEffect(() => {
    let active = true;
    queueMicrotask(() => { if (active) { setLoading(true); setError(''); } });
    loadSearchQueriesOptions().then(value => {
      if (!active) return;
      setOptions(value);
      if (value.minDate && value.maxDate) setPeriod({ start: value.minDate, end: value.maxDate });
      setReady(true);
    }).catch(reason => { if (active) setError(reason instanceof Error ? reason.message : 'Не удалось определить период данных'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [request]);

  useEffect(() => {
    if (!ready) return;
    let active = true;
    const filters: SearchQueriesFilters = { start: period.start, end: period.end, category: category || null, search: appliedSearch || null };
    queueMicrotask(() => { if (active) { setLoading(true); setError(''); } });
    Promise.all([
      loadSearchQueriesSummary(filters), loadSearchQueriesSeries(filters),
      loadSearchQueriesRows(filters, sort, page * pageSize, pageSize), loadSearchQueriesRows(filters, 'requests', 0, 1000),
    ]).then(([nextSummary, nextSeries, nextRows, nextOverview]) => {
      if (!active) return;
      setSummary(nextSummary); setSeries(nextSeries); setRows(nextRows); setOverviewRows(nextOverview);
      setSelectedQuery(current => nextOverview.some(row => row.query === current) ? current : nextOverview[0]?.query || '');
    }).catch(reason => {
      if (!active) return;
      setSummary(EMPTY_SUMMARY); setSeries([]); setRows([]); setOverviewRows([]);
      setError(reason instanceof Error ? reason.message : 'Не удалось загрузить серверный срез поисковых запросов');
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [appliedSearch, category, page, period.end, period.start, ready, request, sort]);

  useEffect(() => {
    if (!ready || !selectedQuery) return;
    let active = true;
    loadSearchQueriesSeries({ start: period.start, end: period.end, category: category || null, search: appliedSearch || null }, selectedQuery)
      .then(value => { if (active) setQuerySeries(value); }).catch(() => { if (active) setQuerySeries([]); });
    return () => { active = false; };
  }, [appliedSearch, category, period.end, period.start, ready, selectedQuery]);

  const thresholds = useMemo(() => {
    const values = overviewRows.map(row => row.products).filter(Boolean).sort((a, b) => a - b);
    return { low: values[Math.floor(values.length * .34)] || 0, high: values[Math.floor(values.length * .67)] || 0 };
  }, [overviewRows]);
  const scatter = useMemo(() => overviewRows.slice(0, 250).map(row => ({ ...row, x: row.requests, y: row.orderCr, z: Math.max(row.orderAmount, 2), competition: competitionFor(row.products, thresholds) })), [overviewRows, thresholds]);
  const growing = useMemo(() => [...overviewRows].filter(row => row.requestsPrevious >= 50).sort((a, b) => b.growth - a.growth).slice(0, 5), [overviewRows]);
  const opportunities = useMemo(() => [...overviewRows].filter(row => row.requests >= 100).sort((a, b) => b.opportunity - a.opportunity).slice(0, 5), [overviewRows]);
  const pageCount = Math.max(1, Math.ceil((rows[0]?.totalCount || 0) / pageSize));
  const trend = series.map(row => ({ date: row.date, current: metricValue(row, metric), previous: previousMetricValue(row, metric) }));
  const selectedTrend = querySeries.map(row => ({ date: row.date, current: metricValue(row, metric), previous: previousMetricValue(row, metric) }));
  const kpis = [
    { label: 'Поисковые запросы', value: summary.requests, previous: summary.requestsPrevious, details: `${summary.queryCount} ключей` },
    { label: 'Переходы в карточку', value: summary.cardClicks, previous: summary.cardClicksPrevious, details: `CR корзины ${nf.format(ratio(summary.carts, summary.cardClicks) || 0)}%` },
    { label: 'Заказы', value: summary.orders, previous: summary.ordersPrevious, details: `CR заказа ${nf.format(ratio(summary.orders, summary.carts) || 0)}%` },
    { label: 'Оценка суммы заказов', value: summary.orderAmount, previous: summary.orderAmountPrevious, details: 'По среднему чеку «Рынка»', currency: true },
  ];

  if (showHelp) return <section className="search-analytics-page search-analytics-v2"><AnalyticsHelp data={searchQueriesHelp} onClose={() => setShowHelp(false)} /></section>;
  return <section className="search-analytics-page search-analytics-v2 analytics-page-shell ds-page">
    <AnalyticsPageHeader eyebrow="Аналитика › Трафик" title="Поисковые запросы" description="Серверный спрос, динамика ключей, конкуренция и возможности роста в поиске Wildberries." meta={<span>V5 · Supabase{options.maxDate ? ` · данные по ${options.maxDate}` : ''}</span>} actions={<button type="button" className="ds-button" onClick={() => setShowHelp(true)}>Справка</button>} />
    <AnalyticsToolbar className="search-toolbar" status={<span>Источник: последняя опубликованная версия каждого ключа</span>} trailing={<button type="button" className="ds-button" onClick={() => { setCategory(''); setSearch(''); setAppliedSearch(''); setMetric('requests'); setSort('requests'); setPage(0); if (options.minDate && options.maxDate) setPeriod({ start: options.minDate, end: options.maxDate }); }}>Сбросить</button>}>
      <DateRangeFilter label="Период" value={period} onChange={value => { setPeriod(value); setPage(0); }} maxDate={options.maxDate || today} />
      <select aria-label="Предмет" value={category} onChange={event => { setCategory(event.target.value); setPage(0); }}><option value="">Все предметы</option>{options.categories.map(item => <option key={item}>{item}</option>)}</select>
      <form onSubmit={event => { event.preventDefault(); setAppliedSearch(search.trim().toLocaleLowerCase('ru-RU')); setPage(0); }}><input value={search} onChange={event => setSearch(event.target.value)} placeholder="Поиск по запросу" aria-label="Поиск по запросу" /><button type="submit" className="ds-button">Найти</button></form>
    </AnalyticsToolbar>

    {loading ? <EmptyState title="Загрузка данных V5" description="Получаем серверные агрегаты без загрузки полного отчёта в браузер." /> : error ? <EmptyState title="Не удалось загрузить «Поисковые запросы» V5" description={error} action={<button type="button" className="ds-button" onClick={() => { setReady(false); setRequest(value => value + 1); }}>Повторить</button>} /> : !summary.requests ? <EmptyState title="Нет опубликованных поисковых запросов" description="Импортируйте .xlsx «Поисковые запросы WB» в V5 или измените период и фильтры." /> : <>
      <section className="search-kpi-grid ds-kpi-grid">{kpis.map(item => { const change = delta(item.value, item.previous); return <KpiTile key={item.label} className="search-kpi" label={item.label} value={`${money.format(item.value)}${item.currency ? ' ₽' : ''}`} delta={pct(change)} comparison="к полю прошлого периода" tone={change >= 0 ? 'positive' : 'negative'} details={item.details} />; })}</section>
      <AnalyticsPanel density="compact" className="search-share-strip"><PanelHeader title="Наша доля поиска по заказам" description={appliedSearch ? 'Скрыта: «Точки входа» не содержат поисковую фразу.' : 'Наши заказы из «Точек входа → Поиск» ÷ заказы текущего поискового среза.'} controls={<strong>{summary.ownOrdersShare === null ? '—' : `${nf.format(summary.ownOrdersShare)}%`}</strong>} /><p>Денежная доля появится после серверного переноса финансовой атрибуции; текущая оценка суммы — рынок, а не выручка продавца.</p></AnalyticsPanel>
      <div className="search-chart-grid">
        <AnalyticsPanel density="analytics"><PanelHeader title="Динамика категории" description="Текущий показатель и поле предыдущего периода" controls={<SegmentedControl value={metric} label="Метрика" options={(Object.keys(metricLabels) as SearchQueriesMetric[]).map(value => ({ value, label: metricLabels[value] }))} onChange={setMetric} />} /><ResponsiveContainer width="100%" height={280}><LineChart data={trend}><CartesianGrid stroke="var(--ds-color-border-soft)" strokeDasharray="3 3" /><XAxis dataKey="date" tickFormatter={value => String(value).slice(5)} minTickGap={28} /><YAxis /><Tooltip formatter={value => money.format(Number(value))} /><Line dataKey="current" stroke="#2563EB" strokeWidth={2.5} dot={false} /><Line dataKey="previous" stroke="#94A3B8" strokeDasharray="5 5" dot={false} /></LineChart></ResponsiveContainer></AnalyticsPanel>
        <AnalyticsPanel density="analytics"><PanelHeader title="Динамика запроса" description={selectedQuery || 'Выберите запрос'} controls={<select value={selectedQuery} onChange={event => setSelectedQuery(event.target.value)}>{overviewRows.slice(0, 250).map(row => <option key={`${row.query}-${row.category}`} value={row.query}>{row.query}</option>)}</select>} /><ResponsiveContainer width="100%" height={280}><LineChart data={selectedTrend}><CartesianGrid stroke="var(--ds-color-border-soft)" strokeDasharray="3 3" /><XAxis dataKey="date" tickFormatter={value => String(value).slice(5)} minTickGap={28} /><YAxis /><Tooltip formatter={value => money.format(Number(value))} /><Line dataKey="current" stroke="#10A778" strokeWidth={2.5} dot={false} /><Line dataKey="previous" stroke="#94A3B8" strokeDasharray="5 5" dot={false} /></LineChart></ResponsiveContainer></AnalyticsPanel>
      </div>
      <div className="search-chart-grid">
        <AnalyticsPanel density="analytics"><PanelHeader title="Карта спроса и отдачи" description="Top-250 по частотности: X — запросы, Y — CR заказа, размер — оценка суммы, цвет — относительная конкуренция" /><ResponsiveContainer width="100%" height={330}><ScatterChart margin={{ top: 10, right: 18, bottom: 8, left: 4 }}><CartesianGrid stroke="var(--ds-color-border-soft)" strokeDasharray="3 3" /><XAxis type="number" scale="log" domain={['auto', 'auto']} dataKey="x" tickFormatter={value => money.format(Number(value))} /><YAxis type="number" dataKey="y" unit="%" width={48} /><ZAxis type="number" dataKey="z" range={[28, 520]} /><Tooltip cursor={{ strokeDasharray: '3 3' }} /><Scatter data={scatter} fillOpacity={0.78}>{scatter.map(row => <Cell key={`${row.query}-${row.category}`} fill={competitionColors[row.competition as keyof typeof competitionColors]} />)}</Scatter></ScatterChart></ResponsiveContainer></AnalyticsPanel>
        <div className="search-rank-stack"><AnalyticsPanel density="compact" className="search-ranking"><PanelHeader title="Растущие запросы" />{growing.map(row => <button key={`${row.query}-${row.category}`} onClick={() => setSelectedQuery(row.query)}><span><strong>{row.query}</strong><small>{row.category}</small></span><em>{pct(row.growth)}</em><b>{nf.format(row.orderCr)}%</b></button>)}</AnalyticsPanel><AnalyticsPanel density="compact" className="search-ranking"><PanelHeader title="Возможности" />{opportunities.map(row => <button key={`${row.query}-${row.category}`} onClick={() => setSelectedQuery(row.query)}><span><strong>{row.query}</strong><small>{money.format(row.requests)} запросов</small></span><em>{nf.format(row.opportunity)}</em><b>{nf.format(row.orderCr)}%</b></button>)}</AnalyticsPanel></div>
      </div>
      <AnalyticsPanel density="data" className="search-table-card"><PanelHeader title="Ключевые запросы" description={`${money.format(rows[0]?.totalCount || 0)} строк после серверной агрегации`} controls={<select value={sort} onChange={event => { setSort(event.target.value as SearchQueriesSort); setPage(0); }}>{(Object.keys(sortLabels) as SearchQueriesSort[]).map(value => <option key={value} value={value}>{sortLabels[value]}</option>)}</select>} /><div className="search-table-wrap"><table><thead><tr><th>Запрос / предмет</th><th>Запросы</th><th>Δ</th><th>Переходы</th><th>Корзины</th><th>CR корзины</th><th>Сумма заказов</th><th>Заказы</th><th>Средний чек</th><th>CR заказа</th><th>Конкуренция</th><th>Потенциал</th></tr></thead><tbody>{rows.map(row => { const level = competitionFor(row.products, thresholds); return <tr key={`${row.query}-${row.category}`} onClick={() => setSelectedQuery(row.query)}><td><strong>{row.query}</strong><small>{row.category}</small></td><td>{money.format(row.requests)}</td><td className={row.growth >= 0 ? 'positive' : 'negative'}>{pct(row.growth)}</td><td>{money.format(row.cardClicks)}</td><td>{money.format(row.carts)}</td><td>{nf.format(row.cartCr)}%</td><td>{row.orderAmount ? `${money.format(row.orderAmount)} ₽` : '—'}</td><td>{money.format(row.orders)}</td><td>{row.orders ? `${money.format(row.orderAmount / row.orders)} ₽` : '—'}</td><td>{nf.format(row.orderCr)}%</td><td><span className={`search-competition-badge ${level}`}>{level === 'low' ? 'Низкая' : level === 'medium' ? 'Средняя' : level === 'high' ? 'Высокая' : 'Нет данных'}</span></td><td>{nf.format(row.opportunity)}</td></tr>; })}</tbody></table></div><footer><button disabled={page === 0} onClick={() => setPage(value => Math.max(0, value - 1))}>←</button><span>{page + 1} / {pageCount}</span><button disabled={page + 1 >= pageCount} onClick={() => setPage(value => Math.min(pageCount - 1, value + 1))}>→</button></footer></AnalyticsPanel>
    </>}
  </section>;
}
