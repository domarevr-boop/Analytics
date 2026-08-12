import { useMemo, useState, useSyncExternalStore } from 'react';
import { CartesianGrid, Cell, ResponsiveContainer, Scatter, ScatterChart, Tooltip, XAxis, YAxis, ZAxis } from 'recharts';
import AnalyticsHelp from '../../components/AnalyticsHelp';
import DateRangeFilter from '../../components/DateRangeFilter';
import { aggregateCompetitorQueries, weightedBuyoutRate } from '../../data/competitorCalculations';
import { getCompetitorFunnel, getCompetitorPositions, getCompetitorSearch, getCompetitorStocks, getProducts, getVersion, subscribe } from '../../data/store';
import type { CompetitorFunnelRecord, CompetitorStockRecord } from '../../types';
import { competitorsHelp } from './analyticsHelpContent';

const nf = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 1 });
const money = (value: number) => `${new Intl.NumberFormat('ru-RU', { notation: value >= 1_000_000 ? 'compact' : 'standard', maximumFractionDigits: 1 }).format(value || 0)} ₽`;
const pct = (value: number) => `${nf.format(value || 0)}%`;
const normalize = (value: string) => value.trim().toLocaleLowerCase('ru-RU').replace(/ё/g, 'е').replace(/\s+/g, ' ');
const ratio = (numerator: number, denominator: number) => denominator ? numerator / denominator * 100 : 0;

interface BrandSummary {
  key: string; brand: string; seller: string; own: boolean; articles: number; amount: number; orders: number; impressions: number;
  buyouts: number; price: number; share: number; orderCr: number; buyoutRate: number; firstAmount: number; lastAmount: number;
}

type ChartMetricKey = 'share' | 'price' | 'orders' | 'amount' | 'impressions' | 'orderCr' | 'buyoutRate' | 'articles';
type ChartMetricKind = 'money' | 'percent' | 'count';
const chartMetrics: Record<ChartMetricKey, { label: string; kind: ChartMetricKind }> = {
  share: { label: 'Доля среза', kind: 'percent' }, price: { label: 'Средняя цена', kind: 'money' }, orders: { label: 'Заказы', kind: 'count' },
  amount: { label: 'Сумма заказов', kind: 'money' }, impressions: { label: 'Показы', kind: 'count' }, orderCr: { label: 'CR показ → заказ', kind: 'percent' },
  buyoutRate: { label: 'Выкуп', kind: 'percent' }, articles: { label: 'Артикулы', kind: 'count' },
};
const chartMetricKeys = Object.keys(chartMetrics) as ChartMetricKey[];
const chartFormat = (value: number, kind: ChartMetricKind) => kind === 'money' ? money(value) : kind === 'percent' ? pct(value) : nf.format(value);

function aggregateBrands(rows: CompetitorFunnelRecord[], ownArticles: Set<string>): BrandSummary[] {
  const dates = [...new Set(rows.map(row => row.date))].sort();
  const firstDate = dates[0];
  const lastDate = dates.at(-1);
  const groups = new Map<string, { rows: CompetitorFunnelRecord[]; articles: Set<string>; own: boolean }>();
  for (const row of rows) {
    const own = ownArticles.has(row.wb_article);
    const key = own ? '__own__' : normalize(row.brand || row.seller || 'Без бренда');
    const group = groups.get(key) || { rows: [], articles: new Set<string>(), own };
    group.rows.push(row); group.articles.add(row.wb_article); groups.set(key, group);
  }
  const total = rows.reduce((sum, row) => sum + row.ordered_amount, 0);
  return [...groups.entries()].map(([key, group]) => {
    const amount = group.rows.reduce((sum, row) => sum + row.ordered_amount, 0);
    const orders = group.rows.reduce((sum, row) => sum + row.orders, 0);
    const impressions = group.rows.reduce((sum, row) => sum + row.impressions, 0);
    const buyouts = group.rows.reduce((sum, row) => sum + row.buyouts, 0);
    const weightedPrice = group.rows.reduce((sum, row) => sum + row.discounted_price * Math.max(row.orders, 1), 0);
    const priceWeight = group.rows.reduce((sum, row) => sum + Math.max(row.orders, 1), 0);
    return { key, brand: group.own ? 'Наш ассортимент' : group.rows[0].brand || 'Без бренда', seller: group.rows[0].seller, own: group.own, articles: group.articles.size, amount, orders, impressions, buyouts, price: priceWeight ? weightedPrice / priceWeight : 0, share: ratio(amount, total), orderCr: ratio(orders, impressions), buyoutRate: weightedBuyoutRate(group.rows), firstAmount: group.rows.filter(row => row.date === firstDate).reduce((sum, row) => sum + row.ordered_amount, 0), lastAmount: group.rows.filter(row => row.date === lastDate).reduce((sum, row) => sum + row.ordered_amount, 0) };
  }).sort((a, b) => b.amount - a.amount);
}

function stockForArticle(rows: CompetitorStockRecord[], article: string) {
  const matching = rows.filter(row => row.wb_article === article);
  const latest = matching.map(row => row.date).sort().at(-1);
  const current = matching.filter(row => row.date === latest);
  const marketplace = current.filter(row => normalize(row.warehouse) === 'маркетплейс');
  const used = marketplace.length ? marketplace : current;
  return { stock: used.reduce((sum, row) => sum + row.stock, 0), daily: used.reduce((sum, row) => sum + row.avg_daily_orders, 0), warehouses: current.filter(row => normalize(row.warehouse) !== 'маркетплейс').length, subject: current[0]?.subject || '', name: current[0]?.name || '' };
}

function Spark({ values }: { values: number[] }) {
  const min = Math.min(...values, 0); const max = Math.max(...values, 1); const range = max - min || 1;
  const points = values.map((value, index) => `${values.length > 1 ? index / (values.length - 1) * 58 : 29},${18 - (value - min) / range * 16}`).join(' ');
  return <svg viewBox="0 0 58 20" aria-hidden="true"><polyline points={points} /></svg>;
}

export default function CompetitorsPage() {
  useSyncExternalStore(subscribe, getVersion);
  const funnel = getCompetitorFunnel(); const search = getCompetitorSearch(); const stocks = getCompetitorStocks(); const positions = getCompetitorPositions(); const products = getProducts();
  const dates = useMemo(() => [...new Set(funnel.map(row => row.date))].sort(), [funnel]);
  const [start, setStart] = useState(dates[0] || '2026-08-01'); const [end, setEnd] = useState(dates.at(-1) || '2026-08-31');
  const [brandFilter, setBrandFilter] = useState(''); const [query, setQuery] = useState(''); const [showHelp, setShowHelp] = useState(false);
  const [xMetric, setXMetric] = useState<ChartMetricKey>('share'); const [yMetric, setYMetric] = useState<ChartMetricKey>('price'); const [sizeMetric, setSizeMetric] = useState<ChartMetricKey>('orders');
  const [tablePage, setTablePage] = useState(0);
  const activeStart = dates.includes(start) ? start : dates[0] || start;
  const activeEnd = dates.includes(end) ? end : dates.at(-1) || end;
  const ownArticles = useMemo(() => new Set(products.map(product => product.wb_sku).filter(Boolean)), [products]);
  const brandOptions = useMemo(() => [...new Set(funnel.map(row => row.brand).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'ru')), [funnel]);
  const filtered = useMemo(() => funnel.filter(row => row.date >= activeStart && row.date <= activeEnd && (!brandFilter || row.brand === brandFilter) && (!query || `${row.wb_article} ${row.brand} ${row.seller}`.toLocaleLowerCase('ru-RU').includes(query.toLocaleLowerCase('ru-RU')))), [funnel, activeStart, activeEnd, brandFilter, query]);
  const brands = useMemo(() => aggregateBrands(filtered, ownArticles), [filtered, ownArticles]);
  const totalAmount = filtered.reduce((sum, row) => sum + row.ordered_amount, 0); const totalOrders = filtered.reduce((sum, row) => sum + row.orders, 0); const totalImpressions = filtered.reduce((sum, row) => sum + row.impressions, 0);
  const own = brands.find(row => row.own); const weightedPrice = totalOrders ? filtered.reduce((sum, row) => sum + row.discounted_price * row.orders, 0) / totalOrders : 0;
  const periodDates = dates.filter(date => date >= activeStart && date <= activeEnd);
  const rowsForDate = (date: string) => filtered.filter(row => row.date === date);
  const dateSeries = (field: keyof CompetitorFunnelRecord) => periodDates.map(date => rowsForDate(date).reduce((sum, row) => sum + Number(row[field] || 0), 0));
  const kpis = [
    ['Сумма заказов', money(totalAmount), dateSeries('ordered_amount')], ['Заказы, шт.', nf.format(totalOrders), dateSeries('orders')], ['Средняя цена', money(weightedPrice), periodDates.map(date => { const rows = rowsForDate(date); const orders = rows.reduce((sum, row) => sum + row.orders, 0); return orders ? rows.reduce((sum, row) => sum + row.discounted_price * row.orders, 0) / orders : 0; })],
    ['Наша доля среза', pct(own?.share || 0), periodDates.map(date => ratio(rowsForDate(date).filter(row => ownArticles.has(row.wb_article)).reduce((sum, row) => sum + row.ordered_amount, 0), rowsForDate(date).reduce((sum, row) => sum + row.ordered_amount, 0)))],
    ['Показы', nf.format(totalImpressions), dateSeries('impressions')], ['CR показ → заказ', pct(ratio(totalOrders, totalImpressions)), periodDates.map(date => { const rows = rowsForDate(date); return ratio(rows.reduce((sum, row) => sum + row.orders, 0), rows.reduce((sum, row) => sum + row.impressions, 0)); })], ['Выкуп', pct(weightedBuyoutRate(filtered)), periodDates.map(date => weightedBuyoutRate(rowsForDate(date)))],
  ] as const;
  const articleRows = useMemo(() => {
    const map = new Map<string, CompetitorFunnelRecord[]>(); filtered.forEach(row => map.set(row.wb_article, [...(map.get(row.wb_article) || []), row]));
    return [...map.entries()].map(([article, rows]) => {
      const amount = rows.reduce((sum, row) => sum + row.ordered_amount, 0); const orders = rows.reduce((sum, row) => sum + row.orders, 0); const impressions = rows.reduce((sum, row) => sum + row.impressions, 0); const stock = stockForArticle(stocks, article);
      const queryRows = search.filter(row => row.wb_article === article && row.date >= activeStart && row.date <= activeEnd).sort((a, b) => b.requests - a.requests);
      const rankRows = positions.filter(row => row.wb_article === article && row.date >= activeStart && row.date <= activeEnd).sort((a, b) => a.date.localeCompare(b.date));
      return { article, brand: rows[0].brand, seller: rows[0].seller, own: ownArticles.has(article), amount, orders, impressions, cr: ratio(orders, impressions), buyout: weightedBuyoutRate(rows), price: orders ? rows.reduce((sum, row) => sum + row.discounted_price * row.orders, 0) / orders : 0, stock: stock.stock, coverage: stock.daily ? stock.stock / stock.daily : 0, warehouses: stock.warehouses, name: stock.name, subject: stock.subject, topQuery: queryRows[0]?.query || '—', queryRequests: queryRows[0]?.requests || 0, rank: rankRows.at(-1)?.position || rows.at(-1)?.position || 0, rankDelta: rankRows.length > 1 ? rankRows[0].position - rankRows.at(-1)!.position : 0 };
    }).sort((a, b) => b.amount - a.amount);
  }, [filtered, stocks, search, positions, activeStart, activeEnd, ownArticles]);
  const fastest = periodDates.length > 1 ? [...brands].filter(row => row.firstAmount > 0).sort((a, b) => (b.lastAmount / b.firstAmount) - (a.lastAmount / a.firstAmount))[0] : undefined;
  const bestCr = [...brands].filter(row => row.impressions > 0).sort((a, b) => b.orderCr - a.orderCr)[0];
  const queryLeaders = useMemo(() => aggregateCompetitorQueries(search.filter(row => row.date >= activeStart && row.date <= activeEnd)).slice(0, 6), [search, activeStart, activeEnd]);
  const lowStock = [...articleRows].filter(row => row.coverage > 0).sort((a, b) => a.coverage - b.coverage).slice(0, 6);
  const tablePageSize = 15; const tablePageCount = Math.max(1, Math.ceil(articleRows.length / tablePageSize)); const activeTablePage = Math.min(tablePage, tablePageCount - 1); const visibleArticleRows = articleRows.slice(activeTablePage * tablePageSize, (activeTablePage + 1) * tablePageSize);
  const xConfig = chartMetrics[xMetric]; const yConfig = chartMetrics[yMetric]; const sizeConfig = chartMetrics[sizeMetric];

  if (showHelp) return <AnalyticsHelp data={competitorsHelp} onClose={() => setShowHelp(false)} />;
  return <section className="competitors-page competitors-v2">
    <header className="competitors-header"><div><span>АНАЛИТИКА · КОНКУРЕНТЫ</span><h1>Конкуренты</h1><p>Сравнение брендов, карточек, поискового спроса и обеспеченности остатками в загруженном конкурентном срезе.</p></div><button type="button" className="analytics-help-toggle" onClick={() => setShowHelp(true)}>Справка</button></header>
    {!funnel.length ? <article className="analytics-empty-card competitors-empty-card"><span>НЕТ ДАННЫХ</span><h2>Загрузите файл конкурентов</h2><p>На странице «Импорт» выберите один Excel-файл с четырьмя листами: воронка, запросы, склады и ежедневные позиции.</p></article> : <>
      <section className="competitors-toolbar page-card"><DateRangeFilter label="Период" value={{ start: activeStart, end: activeEnd }} onChange={period => { setStart(period.start); setEnd(period.end); setTablePage(0); }} maxDate={dates.at(-1) || activeEnd} /><select value={brandFilter} onChange={event => { setBrandFilter(event.target.value); setTablePage(0); }}><option value="">Все бренды</option>{brandOptions.map(brand => <option key={brand}>{brand}</option>)}</select><label><span>⌕</span><input value={query} onChange={event => { setQuery(event.target.value); setTablePage(0); }} placeholder="Бренд, продавец или артикул" /></label><button type="button" onClick={() => { setBrandFilter(''); setQuery(''); setStart(dates[0]); setEnd(dates.at(-1)!); setTablePage(0); }}>Сбросить</button></section>
      <section className="competitors-kpis">{kpis.map(([label, value, values]) => <article key={label}><span>{label}</span><div><strong>{value}</strong>{values.length > 1 && <Spark values={[...values]} />}</div><small>в выбранном срезе</small></article>)}</section>
      <section className="competitors-section"><header><div><span>ЛИДЕРЫ СРЕЗА</span><h2>Конкуренты по сумме заказов</h2></div><small>{brands.length} брендов · {articleRows.length} карточек</small></header><div className="competitor-brand-grid">{brands.slice(0, 6).map((brand, index) => <article key={brand.key} className={brand.own ? 'is-own' : ''}><div className="brand-head"><b>{index + 1}</b><div><strong>{brand.brand}</strong><small>{brand.own ? 'Совпадение со справочником WB ID' : brand.seller}</small></div>{brand.own && <em>Мы</em>}</div><dl><div><dt>Артикулы</dt><dd>{nf.format(brand.articles)}</dd></div><div><dt>Сумма заказов</dt><dd>{money(brand.amount)}</dd></div><div><dt>Заказы</dt><dd>{nf.format(brand.orders)}</dd></div><div><dt>Средняя цена</dt><dd>{money(brand.price)}</dd></div><div><dt>Доля среза</dt><dd>{pct(brand.share)}</dd></div><div><dt>CR показ → заказ</dt><dd>{pct(brand.orderCr)}</dd></div></dl></article>)}</div></section>
      <section className="competitors-main-grid"><article className="competitors-section competitor-positioning"><header><div><span>ПОЗИЦИОНИРОВАНИЕ</span><h2>{yConfig.label} × {xConfig.label}</h2><p>Цвет выделяет наш ассортимент; каждая ось настраивается независимо.</p></div><div className="competitor-chart-controls"><label><span>Ось X</span><select value={xMetric} onChange={event => setXMetric(event.target.value as ChartMetricKey)}>{chartMetricKeys.map(key => <option key={key} value={key}>{chartMetrics[key].label}</option>)}</select></label><label><span>Ось Y</span><select value={yMetric} onChange={event => setYMetric(event.target.value as ChartMetricKey)}>{chartMetricKeys.map(key => <option key={key} value={key}>{chartMetrics[key].label}</option>)}</select></label><label><span>Размер</span><select value={sizeMetric} onChange={event => setSizeMetric(event.target.value as ChartMetricKey)}>{chartMetricKeys.map(key => <option key={key} value={key}>{chartMetrics[key].label}</option>)}</select></label></div></header><ResponsiveContainer width="100%" height={310}><ScatterChart margin={{ top: 18, right: 24, bottom: 8, left: 6 }}><CartesianGrid stroke="#E5EAF1" strokeDasharray="3 3" /><XAxis type="number" dataKey={xMetric} name={xConfig.label} tickFormatter={value => chartFormat(Number(value), xConfig.kind)} tick={{ fontSize: 10 }} /><YAxis type="number" dataKey={yMetric} name={yConfig.label} width={78} tickFormatter={value => chartFormat(Number(value), yConfig.kind)} tick={{ fontSize: 10 }} /><ZAxis type="number" dataKey={sizeMetric} name={sizeConfig.label} range={[70, 650]} /><Tooltip cursor={{ strokeDasharray: '3 3' }} content={({ active, payload }) => { const row = payload?.[0]?.payload as BrandSummary | undefined; return active && row ? <div className="competitor-tooltip"><strong>{row.brand}</strong>{[xMetric, yMetric, sizeMetric].filter((key, index, keys) => keys.indexOf(key) === index).map(key => <span key={key}>{chartMetrics[key].label}: {chartFormat(row[key], chartMetrics[key].kind)}</span>)}</div> : null; }} /><Scatter data={brands}>{brands.map(row => <Cell key={row.key} fill={row.own ? '#2563EB' : '#7A8DA8'} fillOpacity={.78} />)}</Scatter></ScatterChart></ResponsiveContainer><div className="competitor-chart-legend"><span><i className="own" />Наш ассортимент</span><span><i />Конкуренты</span><small>Размер: {sizeConfig.label.toLocaleLowerCase('ru-RU')}</small></div></article><aside className="competitors-section competitor-insights"><header><div><span>ДИАГНОСТИКА</span><h2>Сигналы среза</h2></div></header><article className="green"><b>♜</b><div><strong>Лидер по доле</strong><p>{brands[0]?.brand || '—'} · {pct(brands[0]?.share || 0)}</p></div></article><article className="violet"><b>↗</b><div><strong>Быстрее растёт</strong><p>{fastest?.brand || 'Недостаточно дат'}{fastest?.firstAmount ? ` · ${pct((fastest.lastAmount - fastest.firstAmount) / fastest.firstAmount * 100)}` : ''}</p></div></article><article className="orange"><b>◫</b><div><strong>Лучшая конверсия</strong><p>{bestCr?.brand || '—'} · {pct(bestCr?.orderCr || 0)}</p></div></article></aside></section>
      <section className="competitors-section competitor-signals"><header><div><span>КАРТОЧКИ</span><h2>Детальная таблица артикулов</h2><p>Воронка за период; позиции и остатки — последнее доступное состояние.</p></div><small>{articleRows.length} карточек</small></header><div className="competitor-table-wrap"><table><thead><tr><th>Артикул / товар</th><th>Бренд</th><th>Сумма заказов</th><th>Заказы</th><th>Цена</th><th>CR</th><th>Выкуп</th><th>Позиция</th><th>Остаток</th><th>Дней запаса</th><th>Главный запрос</th></tr></thead><tbody>{visibleArticleRows.map(row => <tr key={row.article} className={row.own ? 'is-own' : ''}><td><strong>{row.article}</strong><small>{row.name || row.seller}</small></td><td>{row.brand}</td><td>{money(row.amount)}</td><td>{nf.format(row.orders)}</td><td>{money(row.price)}</td><td>{pct(row.cr)}</td><td>{pct(row.buyout)}</td><td><b>{row.rank || '—'}</b>{row.rankDelta !== 0 && <small className={row.rankDelta > 0 ? 'positive' : 'negative'}>{row.rankDelta > 0 ? '↑' : '↓'} {Math.abs(row.rankDelta)}</small>}</td><td>{nf.format(row.stock)}</td><td><span className={row.coverage && row.coverage < 14 ? 'risk-pill' : 'ok-pill'}>{row.coverage ? nf.format(row.coverage) : '—'}</span></td><td><strong>{row.topQuery}</strong><small>{row.queryRequests ? `${nf.format(row.queryRequests)} запросов` : ''}</small></td></tr>)}</tbody></table></div>{articleRows.length > tablePageSize && <footer className="competitor-table-pagination"><span>{activeTablePage * tablePageSize + 1}–{Math.min((activeTablePage + 1) * tablePageSize, articleRows.length)} из {articleRows.length}</span><div><button type="button" disabled={activeTablePage === 0} onClick={() => setTablePage(activeTablePage - 1)}>← Назад</button><b>{activeTablePage + 1} / {tablePageCount}</b><button type="button" disabled={activeTablePage >= tablePageCount - 1} onClick={() => setTablePage(activeTablePage + 1)}>Далее →</button></div></footer>}</section>
      <section className="competitors-secondary-grid"><article className="competitors-section"><header><div><span>ПОИСКОВЫЙ СПРОС</span><h2>Крупнейшие запросы</h2></div></header><div className="competitor-mini-list">{queryLeaders.map(row => <div key={row.query}><strong>{row.query}</strong><span>{row.articles} карточек</span><b>{nf.format(row.requests)}</b><small className={row.requests >= row.requestsPrevious ? 'positive' : 'negative'}>{row.requestsPrevious ? `${row.requests >= row.requestsPrevious ? '+' : ''}${nf.format((row.requests - row.requestsPrevious) / row.requestsPrevious * 100)}%` : 'нет базы'}</small></div>)}</div></article><article className="competitors-section"><header><div><span>ОСТАТКИ</span><h2>Минимальное покрытие</h2></div></header><div className="competitor-mini-list">{lowStock.map(row => <div key={row.article}><strong>{row.brand} · {row.article}</strong><span>{row.warehouses ? `${row.warehouses} складов` : 'агрегат маркетплейса'}</span><b>{nf.format(row.coverage)} дн.</b><small>{nf.format(row.stock)} шт.</small></div>)}</div></article></section>
    </>}
  </section>;
}
