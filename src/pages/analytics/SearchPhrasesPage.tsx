import { useMemo, useState, useSyncExternalStore } from 'react';
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Scatter, ScatterChart, Tooltip, XAxis, YAxis, ZAxis } from 'recharts';
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
  const checkCoverage = useMemo(() => ({ matched: filtered.filter(row => row.niche_avg_check > 0).length, total: filtered.length }), [filtered]);

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
  const opportunities = useMemo(() => [...aggregated].filter(row => row.requests >= 100).sort((a, b) => b.opportunity - a.opportunity).slice(0, 8), [aggregated]);
  const growing = useMemo(() => [...aggregated].filter(row => row.requestsPrevious >= 50).sort((a, b) => b.growth - a.growth).slice(0, 8), [aggregated]);
  const scatter = useMemo(() => [...aggregated].sort((a, b) => b.requests - a.requests).slice(0, 250).map(row => ({ ...row, x: row.products, y: row.requests, z: Math.max(row.orderAmount, 2) })), [aggregated]);

  const setPeriod = (period: { start: string; end: string }) => { setStart(period.start); setEnd(period.end); setPage(0); };
  const metricFormat = (value: number) => metric === 'order_amount' ? `${fmt(value)} ₽` : fmt(value);
  const trendChart = (data: { date: string; current: number; previous: number }[]) => <ResponsiveContainer width="100%" height={250}><LineChart data={data} margin={{ top: 10, right: 18, left: 0, bottom: 0 }}><CartesianGrid stroke="#E7EDF5" strokeDasharray="3 3" /><XAxis dataKey="date" tickFormatter={value => String(value).slice(5)} tick={{ fontSize: 10 }} tickLine={false} /><YAxis tickFormatter={metricFormat} tick={{ fontSize: 10 }} tickLine={false} width={62} /><Tooltip formatter={(value, name) => [metricFormat(Number(value)), name === 'current' ? 'Текущий период' : 'Предыдущий период']} /><Legend formatter={value => value === 'current' ? 'Текущий период' : 'Предыдущий период'} /><Line type="monotone" dataKey="current" stroke="#2563EB" strokeWidth={2.4} dot={data.length <= 14 ? { r: 2 } : false} /><Line type="monotone" dataKey="previous" stroke="#94A3B8" strokeDasharray="5 4" strokeWidth={1.8} dot={false} /></LineChart></ResponsiveContainer>;

  return <section className="search-analytics-page">
    <header className="analytics-page-title"><span>АНАЛИТИКА</span><h1>Поисковые запросы</h1><p>Спрос, динамика ключей, конверсии и конкурентность выдачи Wildberries.</p></header>
    <div className="search-toolbar page-card"><DateRangeFilter label="Период" value={{ start, end }} onChange={setPeriod} maxDate={dates.at(-1) || end} /><select value={category} onChange={event => { setCategory(event.target.value); setPage(0); }}><option value="">Все предметы</option>{categories.map(item => <option key={item}>{item}</option>)}</select><input value={search} onChange={event => { setSearch(event.target.value.toLocaleLowerCase('ru-RU')); setPage(0); }} placeholder="Поиск по запросу" /><label>Метрика<select value={metric} onChange={event => setMetric(event.target.value as MetricKey)}>{Object.entries(metrics).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label></div>

    {!records.length ? <div className="search-empty page-card"><strong>Нет данных поисковых запросов</strong><span>Загрузите отчёт «Поисковые запросы ВБ» на странице импорта. Даты вида 19.07 будут дополнены выбранным годом отчёта.</span></div> : <>
      <div className="search-kpis">
        <article><span>Поисковые запросы</span><strong>{fmt(totals.requests)}</strong><small className={change(totals.requests, totals.requestsPrevious) >= 0 ? 'positive' : 'negative'}>{change(totals.requests, totals.requestsPrevious) >= 0 ? '+' : ''}{pct(change(totals.requests, totals.requestsPrevious))}% к прошлому периоду</small></article>
        <article><span>Уникальные ключи</span><strong>{fmt(aggregated.length)}</strong><small>{fmt(categories.length)} предметов в базе</small></article>
        <article><span>Переходы в карточку</span><strong>{fmt(totals.cardClicks)}</strong><small>{pct(ratio(totals.cardClicks, totals.requests))}% на один запрос</small></article>
        <article><span>Добавили в корзину</span><strong>{fmt(totals.carts)}</strong><small>CR {pct(ratio(totals.carts, totals.cardClicks))}%</small></article>
        <article><span>Сумма заказов</span><strong>{fmt(totals.orderAmount)} ₽</strong><small>{fmt(totals.orders)} шт. · чек ниши сопоставлен {checkCoverage.total ? pct(checkCoverage.matched / checkCoverage.total * 100) : '0'}%</small></article>
      </div>

      <div className="search-chart-grid">
        <article className="search-card"><div className="search-card-head"><div><h2>Динамика категории</h2><p>{category || 'Все предметы'} · {metrics[metric]}</p></div></div>{trendChart(categoryTrend)}</article>
        <article className="search-card"><div className="search-card-head"><div><h2>Динамика отдельного ключа</h2><p>Текущий и предыдущий период</p></div><select value={activeQuery} onChange={event => setSelectedQuery(event.target.value)}>{queryOptions.map(item => <option key={`${item.query}-${item.category}`} value={item.query}>{item.query}</option>)}</select></div>{trendChart(queryTrend)}</article>
      </div>

      <div className="search-opportunity-grid">
        <article className="search-card search-scatter"><div className="search-card-head"><div><h2>Карта спроса и конкуренции</h2><p>X — количество товаров, Y — запросы, размер — сумма заказов. Показаны 250 крупнейших ключей.</p></div></div><ResponsiveContainer width="100%" height={300}><ScatterChart margin={{ top: 10, right: 18, bottom: 8, left: 4 }}><CartesianGrid stroke="#E7EDF5" strokeDasharray="3 3" /><XAxis type="number" dataKey="x" name="Товаров" tickFormatter={fmt} tick={{ fontSize: 10 }} /><YAxis type="number" dataKey="y" name="Запросов" tickFormatter={fmt} tick={{ fontSize: 10 }} width={58} /><ZAxis type="number" dataKey="z" range={[30, 460]} name="Сумма заказов" /><Tooltip cursor={{ strokeDasharray: '3 3' }} formatter={(value, name) => [fmt(Number(value)), String(name)]} content={({ active, payload }) => active && payload?.[0] ? <div className="search-tooltip"><strong>{payload[0].payload.query}</strong><span>{payload[0].payload.category}</span><span>Запросы: {fmt(payload[0].payload.requests)}</span><span>Сумма заказов: {fmt(payload[0].payload.orderAmount)} ₽</span><span>Заказы: {fmt(payload[0].payload.orders)} шт.</span><span>Средний чек ниши: {fmt(payload[0].payload.avgCheck)} ₽</span><span>Товаров: {fmt(payload[0].payload.products)}</span></div> : null} /><Scatter data={scatter} fill="#4F8EF7" fillOpacity={0.68} /></ScatterChart></ResponsiveContainer></article>
        <div className="search-rank-stack"><article className="search-card search-ranking"><h2>Растущие запросы</h2>{growing.map((row, index) => <button key={`${row.query}-${row.category}`} onClick={() => setSelectedQuery(row.query)}><b>{index + 1}</b><span><strong>{row.query}</strong><small>{row.category}</small></span><em>+{pct(row.growth)}%</em></button>)}</article><article className="search-card search-ranking"><h2>Возможности</h2>{opportunities.map((row, index) => <button key={`${row.query}-${row.category}`} onClick={() => setSelectedQuery(row.query)}><b>{index + 1}</b><span><strong>{row.query}</strong><small>{fmt(row.requests)} запросов · {fmt(row.products)} товаров</small></span><em>{pct(row.orderCr)}% CR</em></button>)}</article></div>
      </div>

      <article className="search-card search-table-card"><div className="search-card-head"><div><h2>Ключевые запросы</h2><p>{fmt(sorted.length)} строк после агрегации · сумма заказов рассчитана по среднему чеку предмета</p></div><select value={sortKey} onChange={event => { setSortKey(event.target.value as SortKey); setPage(0); }}><option value="requests">По запросам</option><option value="growth">По росту</option><option value="orderAmount">По сумме заказов</option><option value="orders">По заказам, шт.</option><option value="cartCr">По CR корзины</option><option value="orderCr">По CR заказа</option><option value="opportunity">По потенциалу</option><option value="products">По конкуренции</option></select></div><div className="search-table-wrap"><table><thead><tr><th>Запрос / предмет</th><th>Запросы</th><th>Δ</th><th>Переходы</th><th>Корзины</th><th>CR корзины</th><th>Сумма заказов</th><th>Заказы, шт.</th><th>Средний чек</th><th>CR заказа</th><th>Товаров</th></tr></thead><tbody>{rows.map(row => <tr key={`${row.query}-${row.category}`} onClick={() => setSelectedQuery(row.query)}><td><strong>{row.query}</strong><small>{row.category}</small></td><td>{fmt(row.requests)}</td><td className={row.growth >= 0 ? 'positive' : 'negative'}>{row.growth >= 0 ? '+' : ''}{pct(row.growth)}%</td><td>{fmt(row.cardClicks)}</td><td>{fmt(row.carts)}</td><td>{pct(row.cartCr)}%</td><td><strong>{fmt(row.orderAmount)} ₽</strong></td><td>{fmt(row.orders)}</td><td>{row.avgCheck ? `${fmt(row.avgCheck)} ₽` : '—'}</td><td>{pct(row.orderCr)}%</td><td>{fmt(row.products)}</td></tr>)}</tbody></table></div><footer><button disabled={page === 0} onClick={() => setPage(value => Math.max(0, value - 1))}>←</button><span>{page + 1} / {pageCount}</span><button disabled={page + 1 >= pageCount} onClick={() => setPage(value => Math.min(pageCount - 1, value + 1))}>→</button></footer></article>
    </>}
  </section>;
}
