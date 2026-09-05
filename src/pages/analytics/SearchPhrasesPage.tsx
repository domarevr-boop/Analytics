import { useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { CartesianGrid, Cell, Line, LineChart, ResponsiveContainer, Scatter, ScatterChart, Tooltip, XAxis, YAxis, ZAxis } from 'recharts';
import DateRangeFilter from '../../components/DateRangeFilter';
import AnalyticsHelp from '../../components/AnalyticsHelp';
import { AnalyticsPageHeader, AnalyticsToolbar, EmptyState, KpiTile } from '../../components/AnalyticsPrimitives';
import { getEntryPoints, getMarketDynamics, getProducts, getSearchQueries, getVersion, subscribe } from '../../data/store';
import { addDays, daysBetween } from '../../data/dateUtils';
import { getMarketAverageCheck } from '../../data/marketCalculations';
import type { SearchQueryRecord } from '../../types';
import { searchQueriesHelp } from './analyticsHelpContent';

type MetricKey = 'requests' | 'card_clicks' | 'carts' | 'orders' | 'order_amount' | 'products';
type SortKey = 'requests' | 'cardClicks' | 'carts' | 'orders' | 'orderAmount' | 'products' | 'growth' | 'cartCr' | 'orderCr' | 'opportunity';

const metrics: Record<MetricKey, string> = {
  requests: 'Запросы', card_clicks: 'Переходы', carts: 'Корзины', orders: 'Заказы, шт', order_amount: 'Сумма заказов', products: 'Товары',
};
const previousKey: Partial<Record<MetricKey, keyof SearchQueryRecord>> = {
  requests: 'requests_previous', card_clicks: 'card_clicks_previous', carts: 'carts_previous', orders: 'orders_previous', products: 'products_previous',
};
const fmt = (value: number) => new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(value || 0);
const pct = (value: number) => new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 1 }).format(value || 0);
const ratio = (value: number, base: number) => base > 0 ? value / base * 100 : 0;
const change = (current: number, previous: number) => previous > 0 ? (current - previous) / previous * 100 : current > 0 ? 100 : 0;
const competitionColors = { low: '#10B981', medium: '#F59E0B', high: '#EF5A67', none: '#94A3B8' };

interface Aggregate {
  query: string; category: string; requests: number; requestsPrevious: number; cardClicks: number; cardClicksPrevious: number;
  carts: number; cartsPrevious: number; orders: number; ordersPrevious: number; products: number; productsPrevious: number;
  orderAmount: number; orderAmountPrevious: number; avgCheck: number; cartCr: number; orderCr: number; growth: number; opportunity: number;
}

type RecommendationKey = 'scale' | 'promising' | 'threat' | 'overheated';
type EnrichedSearchRow = SearchQueryRecord & { order_amount: number; order_amount_previous: number; market_avg_check: number };

function competitionFor(products: number, thresholds: { low: number; high: number }) {
  return !products ? 'none' : products <= thresholds.low ? 'low' : products <= thresholds.high ? 'medium' : 'high';
}

function recommendationKeysFor(row: Aggregate, totals: { requests: number; orders: number }, count: number, thresholds: { low: number; high: number }): RecommendationKey[] {
  const highRequest = row.requests >= Math.max(100, totals.requests / Math.max(count, 1));
  const averageOrders = totals.orders / Math.max(count, 1);
  return [
    highRequest && competitionFor(row.products, thresholds) === 'low' && row.orderCr >= 5 ? 'scale' : null,
    row.growth > 20 && row.orders < averageOrders ? 'promising' : null,
    row.growth < -10 ? 'threat' : null,
    highRequest && competitionFor(row.products, thresholds) === 'high' && row.orderCr < 5 ? 'overheated' : null,
  ].filter((key): key is RecommendationKey => key !== null);
}

function aggregateRows(rows: EnrichedSearchRow[]): Aggregate[] {
  const map = new Map<string, Aggregate>();
  for (const row of rows) {
    const key = `${row.query}|${row.category}`;
    const item = map.get(key) || { query: row.query, category: row.category, requests: 0, requestsPrevious: 0, cardClicks: 0, cardClicksPrevious: 0, carts: 0, cartsPrevious: 0, orders: 0, ordersPrevious: 0, products: 0, productsPrevious: 0, orderAmount: 0, orderAmountPrevious: 0, avgCheck: 0, cartCr: 0, orderCr: 0, growth: 0, opportunity: 0 };
    item.requests += row.requests; item.requestsPrevious += row.requests_previous;
    item.cardClicks += row.card_clicks; item.cardClicksPrevious += row.card_clicks_previous;
    item.carts += row.carts; item.cartsPrevious += row.carts_previous;
    item.orders += row.orders; item.ordersPrevious += row.orders_previous;
    item.orderAmount += row.order_amount; item.orderAmountPrevious += row.order_amount_previous;
    item.products = Math.max(item.products, row.products); item.productsPrevious = Math.max(item.productsPrevious, row.products_previous);
    map.set(key, item);
  }
  for (const item of map.values()) {
    item.cartCr = ratio(item.carts, item.cardClicks);
    item.orderCr = ratio(item.orders, item.carts);
    item.avgCheck = item.orders ? item.orderAmount / item.orders : 0;
    item.growth = change(item.requests, item.requestsPrevious);
    item.opportunity = Math.log10(item.requests + 1) * (100 - Math.min(item.orderCr, 100)) / Math.log10(item.products + 10);
  }
  return [...map.values()];
}

function Sparkline({ values, color = '#2563EB' }: { values: number[]; color?: string }) {
  const max = Math.max(...values, 1);
  const min = Math.min(...values, 0);
  const span = max - min || 1;
  const points = values.map((value, index) => `${index / Math.max(values.length - 1, 1) * 68},${25 - (value - min) / span * 21}`).join(' ');
  return <svg className="search-sparkline" viewBox="0 0 68 27" aria-hidden="true"><polyline points={points} fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}

export default function SearchPhrasesPage() {
  useSyncExternalStore(subscribe, getVersion);
  const records = getSearchQueries();
  const marketRecords = getMarketDynamics();
  const entryPoints = getEntryPoints();
  const products = getProducts();
  const dates = useMemo(() => [...new Set(records.map(row => row.date))].sort(), [records]);
  const [start, setStart] = useState(() => dates.at(0) || '2026-07-01');
  const [end, setEnd] = useState(() => dates.at(-1) || '2026-07-31');
  const [category, setCategory] = useState('');
  const [search, setSearch] = useState('');
  const [selectedQuery, setSelectedQuery] = useState('');
  const [metric, setMetric] = useState<MetricKey>('requests');
  const [sortKey, setSortKey] = useState<SortKey>('requests');
  const [page, setPage] = useState(0);
  const [showHelp, setShowHelp] = useState(false);
  const [recommendationFilter, setRecommendationFilter] = useState<RecommendationKey | null>(null);
  const tableRef = useRef<HTMLElement>(null);

  const categories = useMemo(() => [...new Set(records.map(row => row.category))].sort((a, b) => a.localeCompare(b, 'ru')), [records]);
  const marketCheckByDate = useMemo(() => new Map(marketRecords.map(row => [row.date, getMarketAverageCheck(row) || 0])), [marketRecords]);
  const periodLength = daysBetween(start, end);
  const filtered = useMemo<EnrichedSearchRow[]>(() => records.filter(row => row.date >= start && row.date <= end && (!category || row.category === category) && (!search || row.query.includes(search.trim().toLocaleLowerCase('ru-RU')))).map(row => {
    const avgCheck = marketCheckByDate.get(row.date) || 0;
    const previousAvgCheck = marketCheckByDate.get(addDays(row.date, -periodLength)) || 0;
    return { ...row, market_avg_check: avgCheck, order_amount: row.orders * avgCheck, order_amount_previous: row.orders_previous * previousAvgCheck };
  }), [records, start, end, category, search, marketCheckByDate, periodLength]);
  const aggregated = useMemo(() => aggregateRows(filtered), [filtered]);
  const queryOptions = useMemo(() => [...aggregated].sort((a, b) => b.requests - a.requests).slice(0, 1000), [aggregated]);
  const activeQuery = selectedQuery || queryOptions[0]?.query || '';
  const totals = useMemo(() => aggregated.reduce((sum, row) => ({
    requests: sum.requests + row.requests, requestsPrevious: sum.requestsPrevious + row.requestsPrevious,
    cardClicks: sum.cardClicks + row.cardClicks, cardClicksPrevious: sum.cardClicksPrevious + row.cardClicksPrevious,
    carts: sum.carts + row.carts, cartsPrevious: sum.cartsPrevious + row.cartsPrevious,
    orders: sum.orders + row.orders, ordersPrevious: sum.ordersPrevious + row.ordersPrevious,
    orderAmount: sum.orderAmount + row.orderAmount, orderAmountPrevious: sum.orderAmountPrevious + row.orderAmountPrevious,
  }), { requests: 0, requestsPrevious: 0, cardClicks: 0, cardClicksPrevious: 0, carts: 0, cartsPrevious: 0, orders: 0, ordersPrevious: 0, orderAmount: 0, orderAmountPrevious: 0 }), [aggregated]);
  const ownSearch = useMemo(() => {
    if (search.trim()) return null;
    const productById = new Map(products.map(product => [product.id, product]));
    return entryPoints.filter(row => row.date >= start && row.date <= end && row.section.toLocaleLowerCase('ru-RU').includes('поиск') && (!category || productById.get(row.product_id)?.category === category)).reduce((sum, row) => {
      const attributedAmount = row.product_orders_total && row.product_ordered_amount
        ? row.product_ordered_amount * row.orders / row.product_orders_total
        : 0;
      return { orders: sum.orders + row.orders, amount: sum.amount + attributedAmount };
    }, { orders: 0, amount: 0 });
  }, [entryPoints, products, start, end, category, search]);
  const ownAmountShare = ownSearch && totals.orderAmount > 0 ? ownSearch.amount / totals.orderAmount * 100 : null;
  const ownOrdersShare = ownSearch && totals.orders > 0 ? ownSearch.orders / totals.orders * 100 : null;
  const categoryTrend = useMemo(() => dates.filter(date => date >= start && date <= end).map(date => {
    const day = filtered.filter(row => row.date === date);
    const previousField = previousKey[metric];
    return { date, current: day.reduce((sum, row) => sum + Number(row[metric] || 0), 0), previous: day.reduce((sum, row) => sum + Number(metric === 'order_amount' ? row.order_amount_previous : previousField ? row[previousField] : 0), 0) };
  }), [dates, filtered, start, end, metric]);
  const queryTrend = useMemo(() => dates.filter(date => date >= start && date <= end).map(date => {
    const day = filtered.filter(row => row.date === date && row.query === activeQuery);
    const previousField = previousKey[metric];
    return { date, current: day.reduce((sum, row) => sum + Number(row[metric] || 0), 0), previous: day.reduce((sum, row) => sum + Number(metric === 'order_amount' ? row.order_amount_previous : previousField ? row[previousField] : 0), 0) };
  }), [dates, filtered, start, end, activeQuery, metric]);

  const pageSize = 50;
  const competitionThresholds = useMemo(() => {
    const values = aggregated.map(row => row.products).filter(Boolean).sort((a, b) => a - b);
    return { low: values[Math.floor(values.length * .34)] || 0, high: values[Math.floor(values.length * .67)] || 0 };
  }, [aggregated]);
  const opportunities = useMemo(() => [...aggregated].filter(row => row.requests >= 100).sort((a, b) => b.opportunity - a.opportunity).slice(0, 5), [aggregated]);
  const growing = useMemo(() => [...aggregated].filter(row => row.requestsPrevious >= 50).sort((a, b) => b.growth - a.growth).slice(0, 5), [aggregated]);
  const scatter = useMemo(() => [...aggregated].sort((a, b) => b.requests - a.requests).slice(0, 250).map(row => ({ ...row, x: row.requests, y: row.orderCr, z: Math.max(row.orderAmount, 2), competition: competitionFor(row.products, competitionThresholds) })), [aggregated, competitionThresholds]);
  const queryDaily = useMemo(() => {
    const map = new Map<string, number[]>();
    const periodDates = dates.filter(date => date >= start && date <= end);
    aggregated.forEach(row => map.set(`${row.query}|${row.category}`, periodDates.map(date => filtered.filter(item => item.date === date && item.query === row.query && item.category === row.category).reduce((sum, item) => sum + item.requests, 0))));
    return map;
  }, [aggregated, dates, filtered, start, end]);
  const recommendationGroups = useMemo(() => {
    const count = (key: RecommendationKey) => aggregated.filter(row => recommendationKeysFor(row, totals, aggregated.length, competitionThresholds).includes(key)).length;
    return [
      { key: 'scale' as const, tone: 'green', title: 'Масштабировать', text: 'Высокий спрос, высокая конверсия, низкая конкуренция', count: count('scale') },
      { key: 'promising' as const, tone: 'blue', title: 'Перспективные', text: 'Быстрый рост, пока мало заказов', count: count('promising') },
      { key: 'threat' as const, tone: 'orange', title: 'Под угрозой', text: 'Падение спроса или ухудшение конверсии', count: count('threat') },
      { key: 'overheated' as const, tone: 'red', title: 'Перегретые', text: 'Высокая конкуренция при низкой отдаче', count: count('overheated') },
    ];
  }, [aggregated, totals, competitionThresholds]);
  const recommendationLabel: Record<RecommendationKey, string> = { scale: 'Масштабировать', promising: 'Перспективные', threat: 'Под угрозой', overheated: 'Перегретые' };
  const sorted = useMemo(() => aggregated.filter(row => !recommendationFilter || recommendationKeysFor(row, totals, aggregated.length, competitionThresholds).includes(recommendationFilter)).sort((a, b) => Number(b[sortKey]) - Number(a[sortKey])), [aggregated, sortKey, recommendationFilter, totals, competitionThresholds]);
  const pageCount = Math.max(1, Math.ceil(sorted.length / pageSize));
  const rows = sorted.slice(page * pageSize, page * pageSize + pageSize);

  const setPeriod = (period: { start: string; end: string }) => { setStart(period.start); setEnd(period.end); setPage(0); };
  const metricFormat = (value: number) => metric === 'order_amount' ? `${fmt(value)} ₽` : fmt(value);
  const kpiDaily = useMemo(() => dates.filter(date => date >= start && date <= end).map(date => {
    const day = filtered.filter(row => row.date === date);
    return {
      requests: day.reduce((sum, row) => sum + row.requests, 0),
      uniqueKeys: new Set(day.map(row => `${row.query}|${row.category}`)).size,
      cardClicks: day.reduce((sum, row) => sum + row.card_clicks, 0),
      carts: day.reduce((sum, row) => sum + row.carts, 0),
      orderAmount: day.reduce((sum, row) => sum + row.order_amount, 0),
    };
  }), [dates, filtered, start, end]);
  const requestsDelta = change(totals.requests, totals.requestsPrevious);
  const cardClicksDelta = change(totals.cardClicks, totals.cardClicksPrevious);
  const cartsDelta = change(totals.carts, totals.cartsPrevious);
  const orderAmountDelta = change(totals.orderAmount, totals.orderAmountPrevious);
  const trendChart = (data: { date: string; current: number; previous: number }[]) => <ResponsiveContainer width="100%" height={210}><LineChart data={data} margin={{ top: 10, right: 12, left: 0, bottom: 0 }}><CartesianGrid stroke="#E7EDF5" strokeDasharray="3 3" /><XAxis dataKey="date" tickFormatter={value => String(value).slice(5)} tick={{ fontSize: 9 }} tickLine={false} /><YAxis tickFormatter={metricFormat} tick={{ fontSize: 9 }} tickLine={false} width={56} /><Tooltip formatter={(value, name) => [metricFormat(Number(value)), name === 'current' ? 'Текущий период' : 'Предыдущий период']} /><Line type="monotone" dataKey="current" stroke="#2563EB" strokeWidth={2.3} dot={data.length <= 14 ? { r: 2 } : false} /><Line type="monotone" dataKey="previous" stroke="#94A3B8" strokeDasharray="5 4" strokeWidth={1.7} dot={false} /></LineChart></ResponsiveContainer>;

  if (showHelp) return <section className="search-analytics-page search-analytics-v2"><AnalyticsHelp data={searchQueriesHelp} onClose={() => setShowHelp(false)} /></section>;

  return <section className="search-analytics-page search-analytics-v2 analytical-design-page analytics-page-shell ds-page">
    <AnalyticsPageHeader eyebrow="Аналитика › Трафик" title="Поисковые запросы" description="Спрос, динамика ключей, конкуренция и возможности роста в поиске Wildberries." actions={<button type="button" className="ds-button" onClick={() => setShowHelp(true)}>Справка</button>} />
    <AnalyticsToolbar className="search-toolbar"><DateRangeFilter label="Период" value={{ start, end }} onChange={setPeriod} maxDate={dates.at(-1) || end} /><select aria-label="Предмет" value={category} onChange={event => { setCategory(event.target.value); setPage(0); }}><option value="">Все предметы</option>{categories.map(item => <option key={item}>{item}</option>)}</select><input aria-label="Поиск по запросу" value={search} onChange={event => { setSearch(event.target.value.toLocaleLowerCase('ru-RU')); setPage(0); }} placeholder="Поиск по запросу" /><label>Метрика<select value={metric} onChange={event => setMetric(event.target.value as MetricKey)}>{Object.entries(metrics).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label></AnalyticsToolbar>

    {!records.length ? <EmptyState title="Нет данных поисковых запросов" description="Загрузите отчёт «Поисковые запросы ВБ» на странице импорта. Даты вида 19.07 будут дополнены выбранным годом отчёта." /> : <>
      <div className="search-kpis ds-kpi-grid">
        <KpiTile className="search-kpi" label="Поисковые запросы" value={fmt(totals.requests)} delta={`${requestsDelta >= 0 ? '+' : ''}${pct(requestsDelta)}%`} deltaSuffix="" tone={requestsDelta >= 0 ? 'positive' : 'negative'} visual={<Sparkline values={kpiDaily.map(row => row.requests)} color="#10A778" />} />
        <KpiTile className="search-kpi" label="Уникальные ключи" value={fmt(aggregated.length)} visual={<Sparkline values={kpiDaily.map(row => row.uniqueKeys)} color="#2563EB" />} details={`${fmt(categories.length)} предметов в базе`} />
        <KpiTile className="search-kpi" label="Переходы в карточку" value={fmt(totals.cardClicks)} delta={`${cardClicksDelta >= 0 ? '+' : ''}${pct(cardClicksDelta)}%`} deltaSuffix="" tone={cardClicksDelta >= 0 ? 'positive' : 'negative'} visual={<Sparkline values={kpiDaily.map(row => row.cardClicks)} color="#2563EB" />} />
        <KpiTile className="search-kpi" label="Добавили в корзину" value={fmt(totals.carts)} delta={`${cartsDelta >= 0 ? '+' : ''}${pct(cartsDelta)}%`} deltaSuffix="" tone={cartsDelta >= 0 ? 'positive' : 'negative'} visual={<Sparkline values={kpiDaily.map(row => row.carts)} color="#10A778" />} details={`CR ${pct(ratio(totals.carts, totals.cardClicks))}%`} />
        <KpiTile className="search-kpi" label="Сумма заказов" value={totals.orderAmount ? `${fmt(totals.orderAmount)} ₽` : '—'} delta={totals.orderAmount ? `${orderAmountDelta >= 0 ? '+' : ''}${pct(orderAmountDelta)}%` : '—'} deltaSuffix="" comparison={totals.orderAmount ? 'к прошлому периоду' : 'нет данных отчёта «Рынок»'} tone={!totals.orderAmount ? 'neutral' : orderAmountDelta >= 0 ? 'positive' : 'negative'} visual={<Sparkline values={kpiDaily.map(row => row.orderAmount)} color="#8B5CF6" />} details={<><span>{fmt(totals.orders)} шт. · чек {totals.orders && totals.orderAmount ? `${fmt(totals.orderAmount / totals.orders)} ₽` : '—'}</span><span>Наша доля: сумма {ownAmountShare === null ? '—' : `${pct(ownAmountShare)}%`} · шт. {ownOrdersShare === null ? '—' : `${pct(ownOrdersShare)}%`}</span></>} />
      </div>

      <div className="search-demand-grid">
        <article className="search-card search-demand-card"><div className="search-card-head"><div><h2>Динамика спроса</h2></div></div><div className="search-demand-charts"><section><h3>Весь поиск · {category || 'рынок'}</h3><div className="search-mini-legend"><span>Текущий период</span><span className="previous">Прошлый период</span></div>{trendChart(categoryTrend)}</section><section><div className="search-query-chart-head"><h3>Выбранный запрос</h3><select value={activeQuery} onChange={event => setSelectedQuery(event.target.value)}>{queryOptions.map(item => <option key={`${item.query}-${item.category}`} value={item.query}>{item.query}</option>)}</select></div><div className="search-mini-legend"><span>Текущий период</span><span className="previous">Прошлый период</span></div>{trendChart(queryTrend)}</section></div></article>
        <article className="search-card search-scatter"><div className="search-card-head"><div><h2>Карта возможностей</h2><p>Частотность × CR заказа · размер круга — сумма заказов.</p></div></div><ResponsiveContainer width="100%" height={270}><ScatterChart margin={{ top: 10, right: 18, bottom: 8, left: 4 }}><CartesianGrid stroke="#E7EDF5" strokeDasharray="3 3" /><XAxis type="number" scale="log" domain={['auto', 'auto']} dataKey="x" name="Частотность" tickFormatter={fmt} tick={{ fontSize: 9 }} /><YAxis type="number" dataKey="y" name="CR заказа" unit="%" tickFormatter={pct} tick={{ fontSize: 9 }} width={48} /><ZAxis type="number" dataKey="z" range={[28, 520]} name="Сумма заказов" /><Tooltip cursor={{ strokeDasharray: '3 3' }} content={({ active, payload }) => active && payload?.[0] ? <div className="search-tooltip"><strong>{payload[0].payload.query}</strong><span>{payload[0].payload.category}</span><span>Запросы: {fmt(payload[0].payload.requests)}</span><span>CR заказа: {pct(payload[0].payload.orderCr)}%</span><span>Сумма заказов: {fmt(payload[0].payload.orderAmount)} ₽</span><span>Товаров: {fmt(payload[0].payload.products)}</span></div> : null} /><Scatter data={scatter} fillOpacity={0.78}>{scatter.map(row => <Cell key={`${row.query}-${row.category}`} fill={competitionColors[row.competition as keyof typeof competitionColors]} />)}</Scatter></ScatterChart></ResponsiveContainer><div className="search-competition-legend"><span><i className="low" />Низкая</span><span><i className="medium" />Средняя</span><span><i className="high" />Высокая</span><span><i className="none" />Нет данных</span></div></article>
      </div>

      <div className="search-opportunity-grid">
        <article className="search-card search-recommendations"><div className="search-card-head"><div><h2>Рекомендации</h2><p>Нажмите на группу, чтобы открыть соответствующие запросы в таблице.</p></div></div><div className="search-recommendation-grid">{recommendationGroups.map(item => <button type="button" key={item.title} className={`${item.tone} ${recommendationFilter === item.key ? 'active' : ''}`} aria-pressed={recommendationFilter === item.key} onClick={() => { setRecommendationFilter(current => current === item.key ? null : item.key); setPage(0); requestAnimationFrame(() => tableRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })); }}><i /><strong>{item.title}</strong><p>{item.text}</p><b>{fmt(item.count)}</b><small>ключей</small></button>)}</div></article>
        <div className="search-rank-stack"><article className="search-card search-ranking"><h2>Растущие запросы</h2>{growing.map(row => <button key={`${row.query}-${row.category}`} onClick={() => setSelectedQuery(row.query)}><span><strong>{row.query}</strong><small>{row.category}</small></span><em>+{pct(row.growth)}%</em><b>{pct(row.orderCr)}%</b></button>)}</article><article className="search-card search-ranking"><h2>Возможности</h2>{opportunities.map(row => <button key={`${row.query}-${row.category}`} onClick={() => setSelectedQuery(row.query)}><span><strong>{row.query}</strong><small>{fmt(row.requests)} запросов</small></span><em>{'●'.repeat(Math.max(1, Math.min(5, Math.round(row.opportunity / Math.max(opportunities[0]?.opportunity || 1, 1) * 5))))}</em><b>{pct(row.orderCr)}%</b></button>)}</article></div>
      </div>

      <article ref={tableRef} className="search-card search-table-card"><div className="search-card-head"><div><h2>Ключевые запросы</h2><p>{fmt(sorted.length)} строк после агрегации · сумма заказов рассчитана по среднему чеку отчёта «Рынок»{recommendationFilter ? ` · фильтр: ${recommendationLabel[recommendationFilter]}` : ''}</p></div><div className="search-table-actions">{recommendationFilter && <button type="button" onClick={() => { setRecommendationFilter(null); setPage(0); }}>Сбросить группу</button>}<select value={sortKey} onChange={event => { setSortKey(event.target.value as SortKey); setPage(0); }}><option value="requests">По запросам</option><option value="growth">По росту</option><option value="orderAmount">По сумме заказов</option><option value="orders">По заказам, шт.</option><option value="cartCr">По CR корзины</option><option value="orderCr">По CR заказа</option><option value="opportunity">По потенциалу</option><option value="products">По конкуренции</option></select></div></div><div className="search-table-wrap"><table><thead><tr><th>Запрос / предмет</th><th>Группа рекомендации</th><th>Динамика</th><th>Запросы</th><th>Δ</th><th>Переходы</th><th>Корзины</th><th>CR корзины</th><th>Сумма заказов</th><th>Заказы, шт.</th><th>Средний чек</th><th>CR заказа</th><th>Конкуренция</th><th>Потенциал</th></tr></thead><tbody>{rows.map(row => { const competition = competitionFor(row.products, competitionThresholds); const groups = recommendationKeysFor(row, totals, aggregated.length, competitionThresholds); const stars = Math.max(1, Math.min(5, Math.round(row.opportunity / Math.max(opportunities[0]?.opportunity || 1, 1) * 5))); return <tr key={`${row.query}-${row.category}`} onClick={() => setSelectedQuery(row.query)}><td><strong>{row.query}</strong><small>{row.category}</small></td><td><div className="search-recommendation-badges">{groups.length ? groups.map(group => <span key={group}>{recommendationLabel[group]}</span>) : '—'}</div></td><td className="search-table-trend"><Sparkline values={queryDaily.get(`${row.query}|${row.category}`) || []} /></td><td>{fmt(row.requests)}</td><td className={row.growth >= 0 ? 'positive' : 'negative'}>{row.growth >= 0 ? '+' : ''}{pct(row.growth)}%</td><td>{fmt(row.cardClicks)}</td><td>{fmt(row.carts)}</td><td>{pct(row.cartCr)}%</td><td><strong>{row.orderAmount ? `${fmt(row.orderAmount)} ₽` : '—'}</strong></td><td>{fmt(row.orders)}</td><td>{row.avgCheck ? `${fmt(row.avgCheck)} ₽` : '—'}</td><td>{pct(row.orderCr)}%</td><td><span className={`search-competition-badge ${competition}`}>{competition === 'low' ? 'Низкая' : competition === 'medium' ? 'Средняя' : competition === 'high' ? 'Высокая' : 'Нет данных'}</span></td><td><span className="search-potential-stars">{'★'.repeat(stars)}<i>{'★'.repeat(5 - stars)}</i></span></td></tr>; })}</tbody></table></div><footer><button disabled={page === 0} onClick={() => setPage(value => Math.max(0, value - 1))}>←</button><span>{page + 1} / {pageCount}</span><button disabled={page + 1 >= pageCount} onClick={() => setPage(value => Math.min(pageCount - 1, value + 1))}>→</button></footer></article>
    </>}
  </section>;
}
