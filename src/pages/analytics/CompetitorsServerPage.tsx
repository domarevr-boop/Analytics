import { useEffect, useMemo, useState } from 'react';
import { Bar, CartesianGrid, Cell, ComposedChart, Line, LineChart, Pie, PieChart, ResponsiveContainer, Scatter, ScatterChart, Tooltip, XAxis, YAxis, ZAxis } from 'recharts';
import AnalyticsHelp from '../../components/AnalyticsHelp';
import { AnalyticsPageHeader, AnalyticsToolbar, EmptyState, KpiTile } from '../../components/AnalyticsPrimitives';
import DateRangeFilter from '../../components/DateRangeFilter';
import {
  loadV5CompetitorArticles,
  loadV5CompetitorBrands,
  loadV5CompetitorFilters,
  loadV5CompetitorOverview,
  loadV5CompetitorQueries,
  loadV5CompetitorStock,
  loadV5CompetitorTopMovements,
  loadV5CompetitorTopSummary,
} from '../../features/competitors/competitorData';
import type {
  V5CompetitorArticleRow,
  V5CompetitorBrandRow,
  V5CompetitorFilters,
  V5CompetitorMovementStatus,
  V5CompetitorOverviewRow,
  V5CompetitorPage,
  V5CompetitorQueryLeader,
  V5CompetitorStockSlice,
  V5CompetitorTopMovement,
  V5CompetitorTopSummary,
} from '../../features/competitors/competitorDataCore';
import { competitorsHelp } from './analyticsHelpContent';

const nf = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 1 });
const money = (value: number) => `${new Intl.NumberFormat('ru-RU', { notation: value >= 1_000_000 ? 'compact' : 'standard', maximumFractionDigits: 1 }).format(value || 0)} ₽`;
const pct = (value: number | null) => value == null ? '—' : `${nf.format(value)}%`;
const shortDate = (value: string) => value ? value.slice(5).split('-').reverse().join('.') : '—';
const change = (values: number[], points = false) => {
  if (values.length < 2) return { value: 0, label: 'нет динамики' };
  const first = values[0];
  const last = values.at(-1) || 0;
  if (points) return { value: last - first, label: `${last - first > 0 ? '+' : ''}${nf.format(last - first)} п.п.` };
  if (!first) return { value: 0, label: 'нет базы' };
  const delta = (last - first) / first * 100;
  return { value: delta, label: `${delta > 0 ? '+' : ''}${nf.format(delta)}%` };
};

type ChartMetricKey = 'share' | 'weightedPrice' | 'orders' | 'orderedAmount' | 'impressions' | 'orderConversion' | 'buyoutRate' | 'articles';
const chartMetrics: Record<ChartMetricKey, { label: string; kind: 'money' | 'percent' | 'count' }> = {
  share: { label: 'Доля среза', kind: 'percent' },
  weightedPrice: { label: 'Средняя цена', kind: 'money' },
  orders: { label: 'Заказы', kind: 'count' },
  orderedAmount: { label: 'Сумма заказов', kind: 'money' },
  impressions: { label: 'Показы', kind: 'count' },
  orderConversion: { label: 'CR показ → заказ', kind: 'percent' },
  buyoutRate: { label: 'Выкуп', kind: 'percent' },
  articles: { label: 'Артикулы', kind: 'count' },
};
const chartMetricKeys = Object.keys(chartMetrics) as ChartMetricKey[];
const chartFormat = (value: number, kind: 'money' | 'percent' | 'count') => kind === 'money' ? money(value) : kind === 'percent' ? pct(value) : nf.format(value);

const emptyPage = <T,>(): V5CompetitorPage<T> => ({ totalCount: 0, rows: [] });
const emptyStock: V5CompetitorStockSlice = { dateStart: null, dateEnd: null, totalPrevious: 0, totalCurrent: 0, totalDelta: 0, warehouses: [], brands: [] };
const emptyTop: V5CompetitorTopSummary = { dates: [], timeline: [], brandStructure: [], stabilityRate: null, entrants: 0, exits: 0, averageMovement: null, brandsLatest: 0 };
const topStatusLabels: Record<Exclude<V5CompetitorMovementStatus, 'all'>, string> = { retained: 'Остался в TOP', new: 'Вошёл в TOP', exited: 'Вышел из TOP', intermittent: 'Был внутри периода' };

function Spark({ values, tone = 'market' }: { values: number[]; tone?: 'market' | 'own' }) {
  const min = Math.min(...values, 0);
  const max = Math.max(...values, 1);
  const range = max - min || 1;
  const points = values.map((value, index) => `${values.length > 1 ? index / (values.length - 1) * 58 : 29},${18 - (value - min) / range * 16}`).join(' ');
  return <svg className={tone} viewBox="0 0 58 20" aria-hidden="true"><polyline points={points} /></svg>;
}

export default function CompetitorsServerPage() {
  const [filters, setFilters] = useState<V5CompetitorFilters | null>(null);
  const [overview, setOverview] = useState<V5CompetitorOverviewRow[]>([]);
  const [brands, setBrands] = useState<V5CompetitorPage<V5CompetitorBrandRow>>(emptyPage);
  const [articles, setArticles] = useState<V5CompetitorPage<V5CompetitorArticleRow>>(emptyPage);
  const [queries, setQueries] = useState<V5CompetitorQueryLeader[]>([]);
  const [stock, setStock] = useState<V5CompetitorStockSlice>(emptyStock);
  const [top, setTop] = useState<V5CompetitorTopSummary>(emptyTop);
  const [movements, setMovements] = useState<V5CompetitorPage<V5CompetitorTopMovement>>(emptyPage);
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [brand, setBrand] = useState('');
  const [query, setQuery] = useState('');
  const [appliedQuery, setAppliedQuery] = useState('');
  const [articleOffset, setArticleOffset] = useState(0);
  const [brandOffset, setBrandOffset] = useState(0);
  const [topOffset, setTopOffset] = useState(0);
  const [topDepth, setTopDepth] = useState(50);
  const [topStatus, setTopStatus] = useState<V5CompetitorMovementStatus>('all');
  const [activeTab, setActiveTab] = useState<'overview' | 'top-dynamics'>('overview');
  const [xMetric, setXMetric] = useState<ChartMetricKey>('share');
  const [yMetric, setYMetric] = useState<ChartMetricKey>('weightedPrice');
  const [sizeMetric, setSizeMetric] = useState<ChartMetricKey>('orders');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [request, setRequest] = useState(0);
  const [showHelp, setShowHelp] = useState(false);

  useEffect(() => {
    let active = true;
    queueMicrotask(() => {
      if (active) { setLoading(true); setError(''); }
    });
    loadV5CompetitorFilters().then(value => {
      if (!active) return;
      setFilters(value);
      setStart(current => current || value.funnel.minDate || '');
      setEnd(current => current || value.funnel.maxDate || '');
    }).catch(reason => active && setError(reason instanceof Error ? reason.message : 'Не удалось получить фильтры')).finally(() => active && setLoading(false));
    return () => { active = false; };
  }, [request]);

  useEffect(() => {
    if (!start || !end || !filters?.batchId) return;
    let active = true;
    queueMicrotask(() => {
      if (active) { setLoading(true); setError(''); }
    });
    Promise.all([
      loadV5CompetitorOverview({ start, end, brand: brand || null, search: appliedQuery || null }),
      loadV5CompetitorBrands({ start, end, brand: brand || null, search: appliedQuery || null, limit: 50, offset: brandOffset }),
      loadV5CompetitorArticles({ start, end, brand: brand || null, search: appliedQuery || null, limit: 15, offset: articleOffset }),
      loadV5CompetitorQueries({ start, end, limit: 6 }),
      loadV5CompetitorStock({ start, end }),
    ]).then(([nextOverview, nextBrands, nextArticles, nextQueries, nextStock]) => {
      if (!active) return;
      setOverview(nextOverview);
      setBrands(nextBrands);
      setArticles(nextArticles);
      setQueries(nextQueries);
      setStock(nextStock);
    }).catch(reason => active && setError(reason instanceof Error ? reason.message : 'Не удалось загрузить серверный срез')).finally(() => active && setLoading(false));
    return () => { active = false; };
  }, [start, end, brand, appliedQuery, brandOffset, articleOffset, filters?.batchId, request]);

  useEffect(() => {
    if (activeTab !== 'top-dynamics' || !start || !end || !filters?.batchId) return;
    let active = true;
    queueMicrotask(() => {
      if (active) { setLoading(true); setError(''); }
    });
    Promise.all([
      loadV5CompetitorTopSummary({ start, end, depth: topDepth }),
      loadV5CompetitorTopMovements({ start, end, depth: topDepth, status: topStatus, limit: 15, offset: topOffset }),
    ]).then(([nextTop, nextMovements]) => {
      if (!active) return;
      setTop(nextTop);
      setMovements(nextMovements);
    }).catch(reason => active && setError(reason instanceof Error ? reason.message : 'Не удалось загрузить TOP')).finally(() => active && setLoading(false));
    return () => { active = false; };
  }, [activeTab, start, end, topDepth, topStatus, topOffset, filters?.batchId, request]);

  const totals = useMemo(() => {
    const orderedAmount = overview.reduce((sum, row) => sum + row.orderedAmount, 0);
    const orders = overview.reduce((sum, row) => sum + row.orders, 0);
    const impressions = overview.reduce((sum, row) => sum + row.impressions, 0);
    const ownOrderedAmount = overview.reduce((sum, row) => sum + row.ownOrderedAmount, 0);
    const ownOrders = overview.reduce((sum, row) => sum + row.ownOrders, 0);
    const ownImpressions = overview.reduce((sum, row) => sum + row.ownImpressions, 0);
    return {
      orderedAmount, orders, impressions, ownOrderedAmount, ownOrders, ownImpressions,
      weightedPrice: orders ? overview.reduce((sum, row) => sum + row.weightedPrice * row.orders, 0) / orders : 0,
      ownWeightedPrice: ownOrders ? overview.reduce((sum, row) => sum + row.ownWeightedPrice * row.ownOrders, 0) / ownOrders : 0,
      orderConversion: impressions ? orders / impressions * 100 : 0,
      ownOrderConversion: ownImpressions ? ownOrders / ownImpressions * 100 : 0,
      buyoutRate: orders ? overview.reduce((sum, row) => sum + row.buyoutRate * row.orders, 0) / orders : 0,
      ownBuyoutRate: ownOrders ? overview.reduce((sum, row) => sum + row.ownBuyoutRate * row.ownOrders, 0) / ownOrders : 0,
    };
  }, [overview]);

  const ownBrand = brands.rows.find(row => row.isOwn);
  const kpis = [
    { label: 'Сумма заказов', main: money(totals.orderedAmount), own: totals.ownOrders ? money(totals.ownOrderedAmount) : '—', mainSeries: overview.map(row => row.orderedAmount), ownSeries: overview.map(row => row.ownOrderedAmount) },
    { label: 'Заказы, шт.', main: nf.format(totals.orders), own: totals.ownOrders ? nf.format(totals.ownOrders) : '—', mainSeries: overview.map(row => row.orders), ownSeries: overview.map(row => row.ownOrders) },
    { label: 'Средняя цена', main: money(totals.weightedPrice), own: totals.ownOrders ? money(totals.ownWeightedPrice) : '—', mainSeries: overview.map(row => row.weightedPrice), ownSeries: overview.map(row => row.ownWeightedPrice) },
    { label: 'Доля лидера среза', main: pct(brands.rows[0]?.share ?? 0), own: ownBrand ? pct(ownBrand.share) : '—', mainSeries: overview.map(row => row.leaderShare), ownSeries: overview.map(row => row.ownShare), points: true },
    { label: 'Показы', main: nf.format(totals.impressions), own: totals.ownImpressions ? nf.format(totals.ownImpressions) : '—', mainSeries: overview.map(row => row.impressions), ownSeries: overview.map(row => row.ownImpressions) },
    { label: 'CR показ → заказ', main: pct(totals.orderConversion), own: totals.ownImpressions ? pct(totals.ownOrderConversion) : '—', mainSeries: overview.map(row => row.orderConversion), ownSeries: overview.map(row => row.ownOrderConversion), points: true },
    { label: 'Выкуп', main: pct(totals.buyoutRate), own: totals.ownOrders ? pct(totals.ownBuyoutRate) : '—', mainSeries: overview.map(row => row.buyoutRate), ownSeries: overview.map(row => row.ownBuyoutRate), points: true },
  ];
  const bestCr = [...brands.rows].filter(row => row.impressions > 0).sort((a, b) => (b.orderConversion || 0) - (a.orderConversion || 0))[0];
  const lowestStock = [...articles.rows].filter(row => row.stockCoverage > 0).sort((a, b) => a.stockCoverage - b.stockCoverage).slice(0, 6);
  const xConfig = chartMetrics[xMetric];
  const yConfig = chartMetrics[yMetric];
  const maxBrandCount = Math.max(1, ...top.brandStructure.flatMap(row => row.counts));

  if (showHelp) return <AnalyticsHelp data={competitorsHelp} onClose={() => setShowHelp(false)} />;
  return <section className="competitors-page competitors-v2 overview-design-page analytics-page-shell ds-page">
    <AnalyticsPageHeader eyebrow="Аналитика › Конкуренты" title="Конкуренты" description="Серверный срез брендов, карточек, спроса, остатков и TOP без загрузки исходных массивов в браузер." meta={<span>V5 · Supabase{filters?.funnel.maxDate ? ` · данные по ${shortDate(filters.funnel.maxDate)}` : ''}</span>} actions={<button type="button" className="ds-button" onClick={() => setShowHelp(true)}>Справка</button>} />
    <nav className="competitor-page-tabs" aria-label="Разделы страницы конкурентов"><button type="button" className={activeTab === 'overview' ? 'active' : ''} onClick={() => setActiveTab('overview')}>Обзор конкурентов</button><button type="button" className={activeTab === 'top-dynamics' ? 'active' : ''} onClick={() => setActiveTab('top-dynamics')}>Динамика TOP‑50</button></nav>
    {loading && !overview.length ? <EmptyState title="Загрузка данных V5" description="Получаем ограниченные серверные агрегаты «Конкурентов»." /> : error ? <EmptyState title="Не удалось загрузить «Конкурентов» V5" description={error} action={<button type="button" className="ds-button" onClick={() => setRequest(value => value + 1)}>Повторить</button>} /> : !filters?.batchId ? <EmptyState title="Нет опубликованной партии конкурентов" description="Опубликуйте один Excel-файл с четырьмя листами на странице «Импорт»." /> : activeTab === 'top-dynamics' ? <>
      <section className="competitor-top-toolbar page-card"><label><span>Период</span><DateRangeFilter label="Период TOP" value={{ start, end }} onChange={period => { setStart(period.start); setEnd(period.end); setTopOffset(0); }} maxDate={filters.positions.maxDate || end} /></label><label><span>Глубина</span><select value={topDepth} onChange={event => { setTopDepth(Number(event.target.value)); setTopOffset(0); }}><option value={10}>TOP‑10</option><option value={20}>TOP‑20</option><option value={50}>TOP‑50</option></select></label></section>
      <section className="competitor-top-kpis"><article><span>СОХРАННОСТЬ СОСТАВА</span><strong>{pct(top.stabilityRate)}</strong><small>карточек базового дня осталось</small></article><article><span>НОВЫЕ В TOP</span><strong>{top.entrants}</strong><small>вошли в сравнительный день</small></article><article><span>ВЫШЛИ ИЗ TOP</span><strong>{top.exits}</strong><small>покинули выбранную глубину</small></article><article><span>СРЕДНЕЕ ДВИЖЕНИЕ</span><strong>{top.averageMovement == null ? '—' : nf.format(top.averageMovement)}</strong><small>мест по сохранившимся карточкам</small></article><article><span>БРЕНДЫ В ПОСЛЕДНЕМ TOP</span><strong>{top.brandsLatest}</strong><small>уникальных брендов</small></article></section>
      <section className="competitors-section competitor-top-chart"><header><div><span>РОТАЦИЯ ПО ДНЯМ</span><h2>Стабильность и смена состава</h2></div></header><ResponsiveContainer width="100%" height={290}><ComposedChart data={top.timeline}><CartesianGrid stroke="#E6ECF2" strokeDasharray="3 3" vertical={false} /><XAxis dataKey="date" tickFormatter={shortDate} /><YAxis yAxisId="count" /><YAxis yAxisId="rate" orientation="right" domain={[0, 100]} /><Tooltip labelFormatter={value => shortDate(String(value))} /><Bar yAxisId="count" dataKey="entrants" name="Вошли" fill="#42B58B" /><Bar yAxisId="count" dataKey="exits" name="Вышли" fill="#F08A96" /><Line yAxisId="rate" dataKey="retentionRate" name="Сохранность" stroke="#2563EB" strokeWidth={2} connectNulls /></ComposedChart></ResponsiveContainer></section>
      <section className="competitors-section competitor-top-matrix-section"><header><div><span>СТРУКТУРА БРЕНДОВ</span><h2>Присутствие брендов по дням</h2></div><small>{top.brandStructure.length} брендов</small></header><div className="competitor-top-matrix-wrap"><table><thead><tr><th>Бренд</th>{top.dates.map(date => <th key={date}>{shortDate(date)}</th>)}<th>Сейчас</th><th>Δ</th></tr></thead><tbody>{top.brandStructure.map(row => <tr key={row.key}><td><strong>{row.brand}</strong></td>{row.counts.map((count, index) => <td key={`${row.key}-${top.dates[index]}`} style={{ background: count ? `rgba(37, 99, 235, ${0.06 + count / maxBrandCount * 0.38})` : undefined }}>{count || '—'}</td>)}<td>{row.latest}</td><td className={row.delta > 0 ? 'positive' : row.delta < 0 ? 'negative' : ''}>{row.delta > 0 ? '+' : ''}{row.delta}</td></tr>)}</tbody></table></div></section>
      <section className="competitors-section competitor-top-movements"><header><div><span>ДВИЖЕНИЕ КАРТОЧЕК</span><h2>Кто изменил структуру TOP</h2></div><div className="competitor-top-status-filter">{(['all', 'new', 'exited', 'retained', 'intermittent'] as const).map(status => <button type="button" key={status} className={topStatus === status ? 'active' : ''} onClick={() => { setTopStatus(status); setTopOffset(0); }}>{status === 'all' ? 'Все' : topStatusLabels[status]}</button>)}</div></header><div className="competitor-top-movement-table"><table><thead><tr><th>Артикул</th><th>Бренд / продавец</th><th>База</th><th>Сравнение</th><th>Изменение</th><th>Лучшая</th><th>Худшая</th><th>Дней</th><th>Статус</th></tr></thead><tbody>{movements.rows.map(row => <tr key={row.wbArticle}><td><strong>{row.wbArticle}</strong></td><td><strong>{row.brand}</strong><small>{row.seller}</small></td><td>{row.baseline ?? '—'}</td><td>{row.comparison ?? '—'}</td><td>{row.positionDelta ?? '—'}</td><td>{row.best}</td><td>{row.worst}</td><td>{row.observedDays}</td><td><span className={`top-status top-status--${row.status}`}>{topStatusLabels[row.status]}</span></td></tr>)}</tbody></table></div>{movements.totalCount > 15 && <footer className="competitor-table-pagination"><span>{topOffset + 1}–{Math.min(topOffset + 15, movements.totalCount)} из {movements.totalCount}</span><div><button type="button" disabled={!topOffset} onClick={() => setTopOffset(Math.max(0, topOffset - 15))}>← Назад</button><button type="button" disabled={topOffset + 15 >= movements.totalCount} onClick={() => setTopOffset(topOffset + 15)}>Далее →</button></div></footer>}</section>
    </> : <>
      <AnalyticsToolbar className="competitors-toolbar"><DateRangeFilter label="Период" value={{ start, end }} onChange={period => { setStart(period.start); setEnd(period.end); setArticleOffset(0); setBrandOffset(0); }} maxDate={filters.funnel.maxDate || end} /><select value={brand} onChange={event => { setBrand(event.target.value); setArticleOffset(0); setBrandOffset(0); }}><option value="">Все бренды</option>{filters.brands.map(value => <option key={value}>{value}</option>)}</select><label><span>⌕</span><input value={query} onChange={event => setQuery(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') { setAppliedQuery(query); setArticleOffset(0); setBrandOffset(0); } }} placeholder="Бренд, продавец или артикул" /></label><button type="button" className="ds-button" onClick={() => { setAppliedQuery(query); setArticleOffset(0); setBrandOffset(0); }}>Найти</button><button type="button" className="ds-button" onClick={() => { setBrand(''); setQuery(''); setAppliedQuery(''); setStart(filters.funnel.minDate || ''); setEnd(filters.funnel.maxDate || ''); setArticleOffset(0); setBrandOffset(0); }}>Сбросить</button></AnalyticsToolbar>
      <section className="competitors-kpis ds-kpi-grid">{kpis.map(kpi => { const mainChange = change(kpi.mainSeries, kpi.points); const ownChange = change(kpi.ownSeries, kpi.points); return <KpiTile key={kpi.label} className="competitor-kpi" label={kpi.label} value={kpi.main} delta={mainChange.label} deltaSuffix="" comparison="срез" tone={mainChange.value > 0 ? 'positive' : mainChange.value < 0 ? 'negative' : 'neutral'} visual={kpi.mainSeries.length > 1 ? <Spark values={kpi.mainSeries} /> : undefined} details={<div className="competitor-kpi-own"><span>Мы</span><b>{kpi.own}</b><em className={ownChange.value > 0 ? 'positive' : ownChange.value < 0 ? 'negative' : ''}>{ownChange.label}</em>{kpi.ownSeries.length > 1 && <Spark values={kpi.ownSeries} tone="own" />}</div>} />; })}</section>
      <section className="competitors-section"><header><div><span>ЛИДЕРЫ СРЕЗА</span><h2>Конкуренты по сумме заказов</h2></div><small>{brands.totalCount} брендов · {articles.totalCount} карточек</small></header><div className="competitor-brand-grid">{brands.rows.slice(0, 6).map((row, index) => <article key={row.key} className={row.isOwn ? 'is-own' : ''}><div className="brand-head"><b>{brandOffset + index + 1}</b><div><strong>{row.brand}</strong><small>{row.isOwn ? 'Совпадение с import-driven WB ID' : row.seller}</small></div>{row.isOwn && <em>Мы</em>}</div><dl><div><dt>Артикулы</dt><dd>{nf.format(row.articles)}</dd></div><div><dt>Сумма заказов</dt><dd>{money(row.orderedAmount)}</dd></div><div><dt>Заказы</dt><dd>{nf.format(row.orders)}</dd></div><div><dt>Средняя цена</dt><dd>{money(row.weightedPrice)}</dd></div><div><dt>Доля среза</dt><dd>{pct(row.share)}</dd></div><div><dt>CR показ → заказ</dt><dd>{pct(row.orderConversion)}</dd></div></dl></article>)}</div></section>
      <section className="competitors-main-grid"><article className="competitors-section competitor-positioning"><header><div><span>ПОЗИЦИОНИРОВАНИЕ</span><h2>{yConfig.label} × {xConfig.label}</h2></div><div className="competitor-chart-controls"><label><span>Ось X</span><select value={xMetric} onChange={event => setXMetric(event.target.value as ChartMetricKey)}>{chartMetricKeys.map(key => <option key={key} value={key}>{chartMetrics[key].label}</option>)}</select></label><label><span>Ось Y</span><select value={yMetric} onChange={event => setYMetric(event.target.value as ChartMetricKey)}>{chartMetricKeys.map(key => <option key={key} value={key}>{chartMetrics[key].label}</option>)}</select></label><label><span>Размер</span><select value={sizeMetric} onChange={event => setSizeMetric(event.target.value as ChartMetricKey)}>{chartMetricKeys.map(key => <option key={key} value={key}>{chartMetrics[key].label}</option>)}</select></label></div></header><ResponsiveContainer width="100%" height={310}><ScatterChart><CartesianGrid stroke="#E5EAF1" strokeDasharray="3 3" /><XAxis type="number" dataKey={xMetric} tickFormatter={value => chartFormat(Number(value), xConfig.kind)} /><YAxis type="number" dataKey={yMetric} tickFormatter={value => chartFormat(Number(value), yConfig.kind)} /><ZAxis type="number" dataKey={sizeMetric} range={[70, 650]} /><Tooltip formatter={(value, name) => [chartFormat(Number(value), chartMetrics[name as ChartMetricKey]?.kind || 'count'), chartMetrics[name as ChartMetricKey]?.label || name]} /><Scatter data={brands.rows}>{brands.rows.map(row => <Cell key={row.key} fill={row.isOwn ? '#2563EB' : '#7A8DA8'} fillOpacity={.78} />)}</Scatter></ScatterChart></ResponsiveContainer></article><aside className="competitors-section competitor-insights"><header><div><span>ДИАГНОСТИКА</span><h2>Сигналы среза</h2></div></header><article className="green"><b>♜</b><div><strong>Лидер по доле</strong><p>{brands.rows[0]?.brand || '—'} · {pct(brands.rows[0]?.share ?? 0)}</p></div></article><article className="violet"><b>↗</b><div><strong>Серверный охват</strong><p>{overview.length} дней · {articles.totalCount} карточек</p></div></article><article className="orange"><b>◫</b><div><strong>Лучшая конверсия</strong><p>{bestCr?.brand || '—'} · {pct(bestCr?.orderConversion ?? 0)}</p></div></article></aside></section>
      <section className="competitors-section competitor-overview-trend"><header><div><span>ДИНАМИКА ПОКАЗАТЕЛЕЙ</span><h2>Срез и наш ассортимент во времени</h2></div></header><ResponsiveContainer width="100%" height={300}><LineChart data={overview}><CartesianGrid stroke="#E6ECF2" strokeDasharray="3 3" vertical={false} /><XAxis dataKey="date" tickFormatter={shortDate} /><YAxis tickFormatter={value => money(Number(value))} /><Tooltip labelFormatter={value => shortDate(String(value))} formatter={value => money(Number(value))} /><Line dataKey="orderedAmount" name="Срез" stroke="#7A8DA8" strokeWidth={2} dot={false} /><Line dataKey="ownOrderedAmount" name="Мы" stroke="#2563EB" strokeWidth={2} dot={false} /></LineChart></ResponsiveContainer></section>
      <section className="competitors-section competitor-brand-table-section"><header><div><span>АГРЕГАТ ПО БРЕНДАМ</span><h2>Таблица конкурентов</h2></div><small>{brands.totalCount} брендов</small></header><div className="competitor-brand-table"><table><thead><tr><th>Бренд</th><th>Артикулы</th><th>Сумма заказов</th><th>Заказы</th><th>Средняя цена</th><th>Медиана покупателя</th><th>Доля</th><th>Показы</th><th>Клики</th><th>CTR</th><th>Корзины</th><th>CR в корзину</th><th>CR в заказ</th><th>Выкупы</th><th>% выкупа</th><th>Ср. позиция</th></tr></thead><tbody>{brands.rows.map(row => <tr key={row.key} className={row.isOwn ? 'is-own' : ''}><td><strong>{row.brand}</strong><small>{row.isOwn ? 'Наш ассортимент' : row.seller}</small></td><td>{nf.format(row.articles)}</td><td>{money(row.orderedAmount)}</td><td>{nf.format(row.orders)}</td><td>{money(row.weightedPrice)}</td><td>{money(row.weightedBuyerMedianPrice)}</td><td>{pct(row.share)}</td><td>{nf.format(row.impressions)}</td><td>{nf.format(row.clicks)}</td><td>{pct(row.ctr)}</td><td>{nf.format(row.carts)}</td><td>{pct(row.cartConversion)}</td><td>{pct(row.orderConversion)}</td><td>{nf.format(row.buyouts)}</td><td>{pct(row.buyoutRate)}</td><td>{nf.format(row.avgSearchPosition)}</td></tr>)}</tbody></table></div>{brands.totalCount > 50 && <footer className="competitor-table-pagination"><button type="button" disabled={!brandOffset} onClick={() => setBrandOffset(Math.max(0, brandOffset - 50))}>← Назад</button><button type="button" disabled={brandOffset + 50 >= brands.totalCount} onClick={() => setBrandOffset(brandOffset + 50)}>Далее →</button></footer>}</section>
      <section className="competitors-section competitor-stock-section"><header><div><span>ОСТАТКИ ПО СКЛАДАМ</span><h2>Распределение запасов</h2></div></header><div className="competitor-stock-grid"><div className="competitor-stock-chart"><ResponsiveContainer width="100%" height={280}><PieChart><Pie data={stock.warehouses.slice(0, 8)} dataKey="stock" nameKey="warehouse" innerRadius={68} outerRadius={108}>{stock.warehouses.slice(0, 8).map((row, index) => <Cell key={row.key} fill={['#2563EB', '#10A778', '#F59E0B', '#8B5CF6', '#EF5B70', '#0EA5E9', '#84CC16', '#64748B'][index]} />)}</Pie><Tooltip /></PieChart></ResponsiveContainer></div><aside className="competitor-stock-summary"><article className="competitor-stock-total"><span>ИЗМЕНЕНИЕ ОБЩЕГО ОСТАТКА</span><strong>{stock.totalDelta > 0 ? '+' : ''}{nf.format(stock.totalDelta)} шт.</strong><small>{shortDate(stock.dateStart || '')}: {nf.format(stock.totalPrevious)} → {shortDate(stock.dateEnd || '')}: {nf.format(stock.totalCurrent)}</small></article><div className="competitor-stock-brand-list">{stock.brands.slice(0, 10).map(row => <div key={row.key}><span><strong>{row.brand}</strong><small>{nf.format(row.previous)} → {nf.format(row.current)} шт.</small></span><b>{row.delta > 0 ? '+' : ''}{nf.format(row.delta)}</b><em>{pct(row.deltaRate)}</em></div>)}</div></aside></div></section>
      <section className="competitors-section competitor-signals"><header><div><span>КАРТОЧКИ</span><h2>Детальная таблица артикулов</h2></div><small>{articles.totalCount} карточек</small></header><div className="competitor-table-wrap"><table><thead><tr><th>Артикул / товар</th><th>Бренд</th><th>Сумма заказов</th><th>Заказы</th><th>Цена</th><th>CR</th><th>Выкуп</th><th>Позиция</th><th>Остаток</th><th>Дней запаса</th><th>Главный запрос</th></tr></thead><tbody>{articles.rows.map(row => <tr key={row.wbArticle} className={row.isOwn ? 'is-own' : ''}><td><strong>{row.wbArticle}</strong><small>{row.productName || row.seller}</small></td><td>{row.brand}</td><td>{money(row.orderedAmount)}</td><td>{nf.format(row.orders)}</td><td>{money(row.weightedPrice)}</td><td>{pct(row.orderConversion)}</td><td>{pct(row.buyoutRate)}</td><td>{row.latestPosition ?? '—'}<small>{row.positionDelta ? `${row.positionDelta > 0 ? '↑' : '↓'} ${Math.abs(row.positionDelta)}` : ''}</small></td><td>{nf.format(row.stock)}</td><td><span className={row.stockCoverage > 0 && row.stockCoverage < 14 ? 'risk-pill' : 'ok-pill'}>{row.stockCoverage ? nf.format(row.stockCoverage) : '—'}</span></td><td><strong>{row.topQuery || '—'}</strong><small>{row.queryRequests ? `${nf.format(row.queryRequests)} запросов` : ''}</small></td></tr>)}</tbody></table></div>{articles.totalCount > 15 && <footer className="competitor-table-pagination"><span>{articleOffset + 1}–{Math.min(articleOffset + 15, articles.totalCount)} из {articles.totalCount}</span><div><button type="button" disabled={!articleOffset} onClick={() => setArticleOffset(Math.max(0, articleOffset - 15))}>← Назад</button><button type="button" disabled={articleOffset + 15 >= articles.totalCount} onClick={() => setArticleOffset(articleOffset + 15)}>Далее →</button></div></footer>}</section>
      <section className="competitors-secondary-grid"><article className="competitors-section"><header><div><span>ПОИСКОВЫЙ СПРОС</span><h2>Крупнейшие запросы</h2></div></header><div className="competitor-mini-list">{queries.map(row => <div key={row.query}><strong>{row.query}</strong><span>{row.articles} карточек</span><b>{nf.format(row.requests)}</b><small>{row.requestsPrevious ? `${row.requests >= row.requestsPrevious ? '+' : ''}${nf.format((row.requests - row.requestsPrevious) / row.requestsPrevious * 100)}%` : 'нет базы'}</small></div>)}</div></article><article className="competitors-section"><header><div><span>ОСТАТКИ</span><h2>Минимальное покрытие</h2></div></header><div className="competitor-mini-list">{lowestStock.map(row => <div key={row.wbArticle}><strong>{row.brand} · {row.wbArticle}</strong><span>{row.warehouseCount ? `${row.warehouseCount} складов` : 'агрегат маркетплейса'}</span><b>{nf.format(row.stockCoverage)} дн.</b><small>{nf.format(row.stock)} шт.</small></div>)}</div></article></section>
    </>}
  </section>;
}
