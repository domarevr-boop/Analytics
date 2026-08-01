import { useMemo, useState, useSyncExternalStore } from 'react';
import { CartesianGrid, Cell, Line, LineChart, ResponsiveContainer, Scatter, ScatterChart, Tooltip, XAxis, YAxis, ZAxis } from 'recharts';
import DateRangeFilter from '../../components/DateRangeFilter';
import { getNicheDynamics, getSearchQueries, getVersion, subscribe } from '../../data/store';
import type { SearchQueryRecord } from '../../types';

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

type EnrichedSearchRow = SearchQueryRecord & { order_amount: number; order_amount_previous: number; niche_avg_check: number };

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
  const nicheRecords = getNicheDynamics();
  const dates = useMemo(() => [...new Set(records.map(row => row.date))].sort(), [records]);
  const [start, setStart] = useState(() => dates.at(0) || '2026-07-01');
  const [end, setEnd] = useState(() => dates.at(-1) || '2026-07-31');
  const [category, setCategory] = useState('');
  const [search, setSearch] = useState('');
  const [selectedQuery, setSelectedQuery] = useState('');
  const [metric, setMetric] = useState<MetricKey>('requests');
  const [sortKey, setSortKey] = useState<SortKey>('requests');
  const [page, setPage] = useState(0);

  const categories = useMemo(() => [...new Set(records.map(row => row.category))].sort((a, b) => a.localeCompare(b, 'ru')), [records]);
  const nicheCheckByMonthSubject = useMemo(() => {
    const map = new Map<string, { date: string; value: number; previous: number }>();
    for (const row of nicheRecords) {
      const key = `${row.date.slice(0, 7)}|${row.subject.trim().toLocaleLowerCase('ru-RU')}`;
      const existing = map.get(key);
      if (!existing || row.date > existing.date) map.set(key, { date: row.date, value: row.avg_check, previous: row.avg_check_previous });
    }
    return map;
  }, [nicheRecords]);
  const filtered = useMemo<EnrichedSearchRow[]>(() => records.filter(row => row.date >= start && row.date <= end && (!category || row.category === category) && (!search || row.query.includes(search.trim().toLocaleLowerCase('ru-RU')))).map(row => {
    const nicheCheck = nicheCheckByMonthSubject.get(`${row.date.slice(0, 7)}|${row.category.trim().toLocaleLowerCase('ru-RU')}`);
    const avgCheck = nicheCheck?.value || 0;
    return { ...row, niche_avg_check: avgCheck, order_amount: row.orders * avgCheck, order_amount_previous: row.orders_previous * (nicheCheck?.previous || avgCheck) };
  }), [records, start, end, category, search, nicheCheckByMonthSubject]);
  const aggregated = useMemo(() => aggregateRows(filtered), [filtered]);
  const queryOptions = useMemo(() => [...aggregated].sort((a, b) => b.requests - a.requests).slice(0, 1000), [aggregated]);
  const activeQuery = selectedQuery || queryOptions[0]?.query || '';
  const totals = useMemo(() => aggregated.reduce((sum, row) => ({ requests: sum.requests + row.requests, requestsPrevious: sum.requestsPrevious + row.requestsPrevious, cardClicks: sum.cardClicks + row.cardClicks, carts: sum.carts + row.carts, orders: sum.orders + row.orders, orderAmount: sum.orderAmount + row.orderAmount, orderAmountPrevious: sum.orderAmountPrevious + row.orderAmountPrevious }), { requests: 0, requestsPrevious: 0, cardClicks: 0, carts: 0, orders: 0, orderAmount: 0, orderAmountPrevious: 0 }), [aggregated]);
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

  const sorted = useMemo(() => [...aggregated].sort((a, b) => Number(b[sortKey]) - Number(a[sortKey])), [aggregated, sortKey]);
  const pageSize = 50;
  const pageCount = Math.max(1, Math.ceil(sorted.length / pageSize));
  const rows = sorted.slice(page * pageSize, page * pageSize + pageSize);
  const competitionThresholds = useMemo(() => {
    const values = aggregated.map(row => row.products).filter(Boolean).sort((a, b) => a - b);
    return { low: values[Math.floor(values.length * .34)] || 0, high: values[Math.floor(values.length * .67)] || 0 };
  }, [aggregated]);
  const competitionOf = (products: number) => !products ? 'none' : products <= competitionThresholds.low ? 'low' : products <= competitionThresholds.high ? 'medium' : 'high';
  const opportunities = useMemo(() => [...aggregated].filter(row => row.requests >= 100).sort((a, b) => b.opportunity - a.opportunity).slice(0, 5), [aggregated]);
  const growing = useMemo(() => [...aggregated].filter(row => row.requestsPrevious >= 50).sort((a, b) => b.growth - a.growth).slice(0, 5), [aggregated]);
  const scatter = useMemo(() => [...aggregated].sort((a, b) => b.requests - a.requests).slice(0, 250).map(row => ({ ...row, x: row.requests, y: row.orderCr, z: Math.max(row.orderAmount, 2), competition: competitionOf(row.products) })), [aggregated, competitionThresholds]);
  const queryDaily = useMemo(() => {
    const map = new Map<string, number[]>();
    const periodDates = dates.filter(date => date >= start && date <= end);
    aggregated.forEach(row => map.set(`${row.query}|${row.category}`, periodDates.map(date => filtered.filter(item => item.date === date && item.query === row.query && item.category === row.category).reduce((sum, item) => sum + item.requests, 0))));
    return map;
  }, [aggregated, dates, filtered, start, end]);
  const recommendationGroups = useMemo(() => {
    const highRequests = aggregated.filter(row => row.requests >= Math.max(100, totals.requests / Math.max(aggregated.length, 1)));
    return [
      { tone: 'green', title: 'Масштабировать', text: 'Высокий спрос, высокая конверсия, низкая конкуренция', count: highRequests.filter(row => competitionOf(row.products) === 'low' && row.orderCr >= 5).length },
      { tone: 'blue', title: 'Перспективные', text: 'Быстрый рост, пока мало заказов', count: aggregated.filter(row => row.growth > 20 && row.orders < totals.orders / Math.max(aggregated.length, 1)).length },
      { tone: 'orange', title: 'Под угрозой', text: 'Падение спроса или ухудшение конверсии', count: aggregated.filter(row => row.growth < -10).length },
      { tone: 'red', title: 'Перегретые', text: 'Высокая конкуренция при низкой отдаче', count: highRequests.filter(row => competitionOf(row.products) === 'high' && row.orderCr < 5).length },
    ];
  }, [aggregated, totals, competitionThresholds]);

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
  const trendChart = (data: { date: string; current: number; previous: number }[]) => <ResponsiveContainer width="100%" height={210}><LineChart data={data} margin={{ top: 10, right: 12, left: 0, bottom: 0 }}><CartesianGrid stroke="#E7EDF5" strokeDasharray="3 3" /><XAxis dataKey="date" tickFormatter={value => String(value).slice(5)} tick={{ fontSize: 9 }} tickLine={false} /><YAxis tickFormatter={metricFormat} tick={{ fontSize: 9 }} tickLine={false} width={56} /><Tooltip formatter={(value, name) => [metricFormat(Number(value)), name === 'current' ? 'Текущий период' : 'Предыдущий период']} /><Line type="monotone" dataKey="current" stroke="#2563EB" strokeWidth={2.3} dot={data.length <= 14 ? { r: 2 } : false} /><Line type="monotone" dataKey="previous" stroke="#94A3B8" strokeDasharray="5 4" strokeWidth={1.7} dot={false} /></LineChart></ResponsiveContainer>;

  return <section className="search-analytics-page search-analytics-v2">
    <header className="analytics-page-title"><span>АНАЛИТИКА · ПОИСКОВЫЕ ЗАПРОСЫ</span><h1>Поисковые запросы</h1><p>Спрос, динамика ключей, конкуренция и возможности роста в поиске Wildberries.</p></header>
    <div className="search-toolbar page-card"><DateRangeFilter label="Период" value={{ start, end }} onChange={setPeriod} maxDate={dates.at(-1) || end} /><select value={category} onChange={event => { setCategory(event.target.value); setPage(0); }}><option value="">Все предметы</option>{categories.map(item => <option key={item}>{item}</option>)}</select><input value={search} onChange={event => { setSearch(event.target.value.toLocaleLowerCase('ru-RU')); setPage(0); }} placeholder="Поиск по запросу" /><label>Метрика<select value={metric} onChange={event => setMetric(event.target.value as MetricKey)}>{Object.entries(metrics).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label></div>

    {!records.length ? <div className="search-empty page-card"><strong>Нет данных поисковых запросов</strong><span>Загрузите отчёт «Поисковые запросы ВБ» на странице импорта. Даты вида 19.07 будут дополнены выбранным годом отчёта.</span></div> : <>
      <div className="search-kpis">
        <article><div><span>Поисковые запросы</span><strong>{fmt(totals.requests)}</strong><small className={change(totals.requests, totals.requestsPrevious) >= 0 ? 'positive' : 'negative'}>{change(totals.requests, totals.requestsPrevious) >= 0 ? '+' : ''}{pct(change(totals.requests, totals.requestsPrevious))}% к прошлому периоду</small></div><Sparkline values={kpiDaily.map(row => row.requests)} color="#10A778" /></article>
        <article><div><span>Уникальные ключи</span><strong>{fmt(aggregated.length)}</strong><small>{fmt(categories.length)} предметов в базе</small></div><Sparkline values={kpiDaily.map(row => row.uniqueKeys)} color="#2563EB" /></article>
        <article><div><span>Переходы в карточку</span><strong>{fmt(totals.cardClicks)}</strong><small>CTR {pct(ratio(totals.cardClicks, totals.requests))}%</small></div><Sparkline values={kpiDaily.map(row => row.cardClicks)} color="#2563EB" /></article>
        <article><div><span>Добавили в корзину</span><strong>{fmt(totals.carts)}</strong><small>CR {pct(ratio(totals.carts, totals.cardClicks))}%</small></div><Sparkline values={kpiDaily.map(row => row.carts)} color="#10A778" /></article>
        <article><div><span>Сумма заказов</span><strong>{fmt(totals.orderAmount)} ₽</strong><small>{fmt(totals.orders)} шт. · средний чек {fmt(totals.orders ? totals.orderAmount / totals.orders : 0)} ₽</small></div><Sparkline values={kpiDaily.map(row => row.orderAmount)} color="#8B5CF6" /></article>
      </div>

      <div className="search-demand-grid">
        <article className="search-card search-demand-card"><div className="search-card-head"><div><h2>Динамика спроса</h2></div></div><div className="search-demand-charts"><section><h3>Весь поиск · {category || 'рынок'}</h3><div className="search-mini-legend"><span>Текущий период</span><span className="previous">Прошлый период</span></div>{trendChart(categoryTrend)}</section><section><div className="search-query-chart-head"><h3>Выбранный запрос</h3><select value={activeQuery} onChange={event => setSelectedQuery(event.target.value)}>{queryOptions.map(item => <option key={`${item.query}-${item.category}`} value={item.query}>{item.query}</option>)}</select></div><div className="search-mini-legend"><span>Текущий период</span><span className="previous">Прошлый период</span></div>{trendChart(queryTrend)}</section></div></article>
        <article className="search-card search-scatter"><div className="search-card-head"><div><h2>Карта возможностей</h2><p>Частотность × CR заказа · размер круга — сумма заказов.</p></div></div><ResponsiveContainer width="100%" height={270}><ScatterChart margin={{ top: 10, right: 18, bottom: 8, left: 4 }}><CartesianGrid stroke="#E7EDF5" strokeDasharray="3 3" /><XAxis type="number" scale="log" domain={['auto', 'auto']} dataKey="x" name="Частотность" tickFormatter={fmt} tick={{ fontSize: 9 }} /><YAxis type="number" dataKey="y" name="CR заказа" unit="%" tickFormatter={pct} tick={{ fontSize: 9 }} width={48} /><ZAxis type="number" dataKey="z" range={[28, 520]} name="Сумма заказов" /><Tooltip cursor={{ strokeDasharray: '3 3' }} content={({ active, payload }) => active && payload?.[0] ? <div className="search-tooltip"><strong>{payload[0].payload.query}</strong><span>{payload[0].payload.category}</span><span>Запросы: {fmt(payload[0].payload.requests)}</span><span>CR заказа: {pct(payload[0].payload.orderCr)}%</span><span>Сумма заказов: {fmt(payload[0].payload.orderAmount)} ₽</span><span>Товаров: {fmt(payload[0].payload.products)}</span></div> : null} /><Scatter data={scatter} fillOpacity={0.78}>{scatter.map(row => <Cell key={`${row.query}-${row.category}`} fill={competitionColors[row.competition as keyof typeof competitionColors]} />)}</Scatter></ScatterChart></ResponsiveContainer><div className="search-competition-legend"><span><i className="low" />Низкая</span><span><i className="medium" />Средняя</span><span><i className="high" />Высокая</span><span><i className="none" />Нет данных</span></div></article>
      </div>

      <div className="search-opportunity-grid">
        <article className="search-card search-recommendations"><div className="search-card-head"><div><h2>Рекомендации</h2></div></div><div className="search-recommendation-grid">{recommendationGroups.map(item => <section key={item.title} className={item.tone}><i /><strong>{item.title}</strong><p>{item.text}</p><b>{fmt(item.count)}</b><small>ключей</small></section>)}</div></article>
        <div className="search-rank-stack"><article className="search-card search-ranking"><h2>Растущие запросы</h2>{growing.map(row => <button key={`${row.query}-${row.category}`} onClick={() => setSelectedQuery(row.query)}><span><strong>{row.query}</strong><small>{row.category}</small></span><em>+{pct(row.growth)}%</em><b>{pct(row.orderCr)}%</b></button>)}</article><article className="search-card search-ranking"><h2>Возможности</h2>{opportunities.map(row => <button key={`${row.query}-${row.category}`} onClick={() => setSelectedQuery(row.query)}><span><strong>{row.query}</strong><small>{fmt(row.requests)} запросов</small></span><em>{'●'.repeat(Math.max(1, Math.min(5, Math.round(row.opportunity / Math.max(opportunities[0]?.opportunity || 1, 1) * 5))))}</em><b>{pct(row.orderCr)}%</b></button>)}</article></div>
      </div>

      <article className="search-card search-table-card"><div className="search-card-head"><div><h2>Ключевые запросы</h2><p>{fmt(sorted.length)} строк после агрегации · сумма заказов рассчитана по среднему чеку предмета</p></div><select value={sortKey} onChange={event => { setSortKey(event.target.value as SortKey); setPage(0); }}><option value="requests">По запросам</option><option value="growth">По росту</option><option value="orderAmount">По сумме заказов</option><option value="orders">По заказам, шт.</option><option value="cartCr">По CR корзины</option><option value="orderCr">По CR заказа</option><option value="opportunity">По потенциалу</option><option value="products">По конкуренции</option></select></div><div className="search-table-wrap"><table><thead><tr><th>Запрос / предмет</th><th>Динамика</th><th>Запросы</th><th>Δ</th><th>Переходы</th><th>Корзины</th><th>CR корзины</th><th>Сумма заказов</th><th>Заказы, шт.</th><th>Средний чек</th><th>CR заказа</th><th>Конкуренция</th><th>Потенциал</th></tr></thead><tbody>{rows.map(row => { const competition = competitionOf(row.products); const stars = Math.max(1, Math.min(5, Math.round(row.opportunity / Math.max(opportunities[0]?.opportunity || 1, 1) * 5))); return <tr key={`${row.query}-${row.category}`} onClick={() => setSelectedQuery(row.query)}><td><strong>{row.query}</strong><small>{row.category}</small></td><td className="search-table-trend"><Sparkline values={queryDaily.get(`${row.query}|${row.category}`) || []} /></td><td>{fmt(row.requests)}</td><td className={row.growth >= 0 ? 'positive' : 'negative'}>{row.growth >= 0 ? '+' : ''}{pct(row.growth)}%</td><td>{fmt(row.cardClicks)}</td><td>{fmt(row.carts)}</td><td>{pct(row.cartCr)}%</td><td><strong>{fmt(row.orderAmount)} ₽</strong></td><td>{fmt(row.orders)}</td><td>{row.avgCheck ? `${fmt(row.avgCheck)} ₽` : '—'}</td><td>{pct(row.orderCr)}%</td><td><span className={`search-competition-badge ${competition}`}>{competition === 'low' ? 'Низкая' : competition === 'medium' ? 'Средняя' : competition === 'high' ? 'Высокая' : 'Нет данных'}</span></td><td><span className="search-potential-stars">{'★'.repeat(stars)}<i>{'★'.repeat(5 - stars)}</i></span></td></tr>; })}</tbody></table></div><footer><button disabled={page === 0} onClick={() => setPage(value => Math.max(0, value - 1))}>←</button><span>{page + 1} / {pageCount}</span><button disabled={page + 1 >= pageCount} onClick={() => setPage(value => Math.min(pageCount - 1, value + 1))}>→</button></footer></article>
    </>}
  </section>;
}
