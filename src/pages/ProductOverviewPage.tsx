import { useMemo, useState, useSyncExternalStore } from 'react';
import { Bar, BarChart, CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import DateRangeFilter from '../components/DateRangeFilter';
import { getBrands, getCabinets, getEntryPoints, getGeographyOrders, getGroups, getMemberships, getMetrics, getProducts, getProfitabilityRecords, getRelatedProductIds, getVersion, subscribe } from '../data/store';
import { getCabinetExtraExpense } from '../data/profitStore';
import { getReportNetProfit } from '../data/profitabilityCalculations';
import { getWbImageUrls } from '../data/images';
import type { DailyMetrics, EntryPointRecord, GeographyOrderRecord, ProfitabilityRecord } from '../types';

const fmt = (value: number, digits = 0) => new Intl.NumberFormat('ru-RU', { maximumFractionDigits: digits }).format(value);
const money = (value: number) => `${fmt(value)} ₽`;
type DatePeriod = { start: string; end: string };
type ProductMetric = 'orderedAmount' | 'revenue' | 'orders' | 'impressions' | 'clicks' | 'carts' | 'ctr' | 'profit' | 'profitability' | 'adSpend' | 'drr' | 'entryOrders' | 'entryCtr' | 'localShare' | 'delivery';
type FunnelTotals = Pick<DailyMetrics, 'impressions' | 'clicks' | 'carts' | 'orders' | 'ordered_amount'>;
type DayValues = Record<ProductMetric, number> & { date: string };
type TrafficMetric = 'orders' | 'orderedAmount' | 'impressions';

const productMetricLabels: Record<ProductMetric, string> = {
  orderedAmount: 'Сумма заказов', revenue: 'Выручка', orders: 'Заказы, шт', impressions: 'Показы', clicks: 'Клики', carts: 'Корзины', ctr: 'CTR',
  profit: 'Чистая прибыль', profitability: 'Рентабельность', adSpend: 'Реклама', drr: 'ДРР', entryOrders: 'Заказы точек входа',
  entryCtr: 'CTR точек входа', localShare: 'Локальность', delivery: 'СВД, ч',
};
const percentageMetrics = new Set<ProductMetric>(['ctr', 'profitability', 'drr', 'entryCtr', 'localShare']);

function parseDate(value: string) {
  return new Date(`${value}T00:00:00Z`);
}

function isoDate(value: Date) {
  return value.toISOString().slice(0, 10);
}

function shiftDate(value: string, days: number) {
  const date = parseDate(value);
  date.setUTCDate(date.getUTCDate() + days);
  return isoDate(date);
}

function previousPeriod(period: DatePeriod): DatePeriod {
  const days = Math.round((parseDate(period.end).getTime() - parseDate(period.start).getTime()) / 86_400_000) + 1;
  const end = shiftDate(period.start, -1);
  return { start: shiftDate(end, -(days - 1)), end };
}

function displayDate(value: string) {
  return new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'short' }).format(parseDate(value)).replace('.', '');
}

function emptyFunnel(): FunnelTotals {
  return { impressions: 0, clicks: 0, carts: 0, orders: 0, ordered_amount: 0 };
}

function sumFunnel(rows: DailyMetrics[]): FunnelTotals {
  return rows.reduce((sum, row) => ({
    impressions: sum.impressions + row.impressions,
    clicks: sum.clicks + row.clicks,
    carts: sum.carts + row.carts,
    orders: sum.orders + row.orders,
    ordered_amount: sum.ordered_amount + row.ordered_amount,
  }), emptyFunnel());
}

function summarizePeriod(rows: DailyMetrics[], profitability: ProfitabilityRecord[], cabinetId: string) {
  const funnel = sumFunnel(rows);
  const revenue = rows.reduce((sum, row) => sum + row.buyout_amount, 0);
  const adSpend = rows.reduce((sum, row) => sum + row.ad_spend, 0);
  const netProfit = profitability.reduce((sum, row) => sum + getReportNetProfit(row, getCabinetExtraExpense(row.period_start.slice(0, 7), cabinetId)), 0);
  const profitRevenue = profitability.reduce((sum, row) => sum + row.profit_revenue, 0);
  return {
    ...funnel,
    revenue,
    adSpend,
    netProfit,
    profitability: profitRevenue ? netProfit / profitRevenue * 100 : 0,
    drr: funnel.ordered_amount ? adSpend / funnel.ordered_amount * 100 : 0,
    orderCr: funnel.impressions ? funnel.orders / funnel.impressions * 100 : 0,
  };
}

function funnelWidth(value: number, maximum: number) {
  if (!maximum || !value) return '42%';
  return `${Math.min(100, 36 + Math.sqrt(value / maximum) * 64)}%`;
}

function FunnelSteps({ totals, productTotals }: { totals: FunnelTotals; productTotals?: FunnelTotals }) {
  const stages = [
    { label: 'Показы', value: totals.impressions, productValue: productTotals?.impressions ?? 0 },
    { label: 'Клики', value: totals.clicks, productValue: productTotals?.clicks ?? 0, conversion: totals.impressions ? totals.clicks / totals.impressions * 100 : 0, conversionLabel: 'CTR' },
    { label: 'Корзины', value: totals.carts, productValue: productTotals?.carts ?? 0, conversion: totals.clicks ? totals.carts / totals.clicks * 100 : 0, conversionLabel: 'CR корзины' },
    { label: 'Заказы', value: totals.orders, productValue: productTotals?.orders ?? 0, conversion: totals.carts ? totals.orders / totals.carts * 100 : 0, conversionLabel: 'CR заказа' },
  ];
  return <div className="product-funnel-steps">
    {stages.map((stage, index) => <div className="product-funnel-stage" key={stage.label}>
      <strong className="product-funnel-label">{stage.label}</strong>
      <div className="product-funnel-shape" style={{ '--step-width': funnelWidth(stage.value, totals.impressions) } as React.CSSProperties}>
        <strong>{fmt(stage.value)}</strong>
        {productTotals && <small>товар: {fmt(stage.value ? stage.productValue / stage.value * 100 : 0, 1)}%</small>}
      </div>
      <i className="product-funnel-conversion">{index > 0 ? <><span>{stage.conversionLabel}</span><b>{fmt(stage.conversion || 0, 1)}%</b></> : <span>Абсолют</span>}</i>
      {index < stages.length - 1 && <em aria-hidden="true">↓</em>}
    </div>)}
  </div>;
}

function Sparkline({ values, color }: { values: number[]; color: string }) {
  if (!values.length) return <span className="product-kpi-spark-empty" />;
  const min = Math.min(...values), max = Math.max(...values), range = max - min || 1;
  const points = values.map((value, index) => `${values.length === 1 ? 50 : index / (values.length - 1) * 100},${30 - (value - min) / range * 24}`).join(' ');
  return <svg className="product-kpi-spark" viewBox="0 0 100 34" preserveAspectRatio="none" aria-hidden="true"><polyline points={points} style={{ stroke: color }} /></svg>;
}

function deltaInfo(current: number, previous: number, rate = false, inverse = false) {
  const delta = rate ? current - previous : previous ? (current / previous - 1) * 100 : 0;
  const positive = inverse ? delta <= 0 : delta >= 0;
  const sign = delta > 0 ? '+' : '';
  return { text: `${sign}${fmt(delta, rate ? 2 : 1)}${rate ? ' п.п.' : '%'}`, positive };
}

function KpiCard({ label, value, current, previous, rate, inverse, spark, color }: { label: string; value: string; current: number; previous: number; rate?: boolean; inverse?: boolean; spark: number[]; color: string }) {
  const delta = deltaInfo(current, previous, rate, inverse);
  return <article className="product-kpi-card"><div><span>{label}</span><strong>{value}</strong><small className={delta.positive ? 'positive' : 'negative'}>{delta.text}</small><small>к прошлому периоду</small></div><Sparkline values={spark} color={color} /></article>;
}

function buildDailyValues(args: {
  period: DatePeriod;
  metricRows: DailyMetrics[];
  profitabilityRows: ProfitabilityRecord[];
  entryPointRows: EntryPointRecord[];
  geographyRows: GeographyOrderRecord[];
  cabinetId: string;
  entryPointFilter: string;
  geoRegion: string;
}): DayValues[] {
  const { period, metricRows, profitabilityRows, entryPointRows, geographyRows, cabinetId, entryPointFilter, geoRegion } = args;
  const rows = metricRows.filter(row => row.date >= period.start && row.date <= period.end);
  const metricsByDate = new Map<string, DailyMetrics[]>();
  rows.forEach(row => { const current = metricsByDate.get(row.date) || []; current.push(row); metricsByDate.set(row.date, current); });
  const profitsByDate = new Map<string, { profit: number; revenue: number }>();
  profitabilityRows.filter(row => row.period_start >= period.start && row.period_start <= period.end).forEach(row => {
    const current = profitsByDate.get(row.period_start) || { profit: 0, revenue: 0 };
    current.profit += getReportNetProfit(row, getCabinetExtraExpense(row.period_start.slice(0, 7), cabinetId));
    current.revenue += row.profit_revenue;
    profitsByDate.set(row.period_start, current);
  });
  const entriesByDate = new Map<string, { impressions: number; clicks: number; orders: number }>();
  entryPointRows.filter(row => row.date >= period.start && row.date <= period.end && (!entryPointFilter || `${row.section} · ${row.entry_point}` === entryPointFilter)).forEach(row => {
    const current = entriesByDate.get(row.date) || { impressions: 0, clicks: 0, orders: 0 };
    current.impressions += row.impressions; current.clicks += row.clicks; current.orders += row.orders; entriesByDate.set(row.date, current);
  });
  const geoByDate = new Map<string, GeographyOrderRecord[]>();
  geographyRows.filter(row => row.date >= period.start && row.date <= period.end && (!geoRegion || row.region === geoRegion)).forEach(row => {
    const current = geoByDate.get(row.date) || []; current.push(row); geoByDate.set(row.date, current);
  });
  return [...metricsByDate.keys()].sort().map(date => {
    const dayRows = metricsByDate.get(date) || [];
    const day = sumFunnel(dayRows);
    const report = profitsByDate.get(date);
    const metricProfit = dayRows.reduce((sum, row) => sum + row.actual_profit, 0);
    const metricProfitRevenue = dayRows.reduce((sum, row) => sum + row.profit_revenue, 0);
    const profit = report?.profit ?? metricProfit;
    const profitRevenue = report?.revenue ?? metricProfitRevenue;
    const entries = entriesByDate.get(date) || { impressions: 0, clicks: 0, orders: 0 };
    const geoRows = geoByDate.get(date) || [];
    const geoOrders = geoRows.reduce((sum, row) => sum + row.orders_total, 0);
    const geoLocal = geoRows.reduce((sum, row) => sum + row.product_local_orders, 0);
    const covered = geoRows.filter(row => row.delivery_hours !== null && row.orders_total > 0);
    const coveredOrders = covered.reduce((sum, row) => sum + row.orders_total, 0);
    const revenue = dayRows.reduce((sum, row) => sum + row.buyout_amount, 0);
    const adSpend = dayRows.reduce((sum, row) => sum + row.ad_spend, 0);
    return {
      date,
      orderedAmount: day.ordered_amount,
      revenue,
      orders: day.orders,
      impressions: day.impressions,
      clicks: day.clicks,
      carts: day.carts,
      ctr: day.impressions ? day.clicks / day.impressions * 100 : 0,
      profit,
      profitability: profitRevenue ? profit / profitRevenue * 100 : 0,
      adSpend,
      drr: day.ordered_amount ? adSpend / day.ordered_amount * 100 : 0,
      entryOrders: entries.orders,
      entryCtr: entries.impressions ? entries.clicks / entries.impressions * 100 : 0,
      localShare: geoOrders ? geoLocal / geoOrders * 100 : 0,
      delivery: coveredOrders ? covered.reduce((sum, row) => sum + (row.delivery_hours || 0) * row.orders_total, 0) / coveredOrders : 0,
    };
  });
}

function aggregateSeries(rows: DayValues[], granularity: 'day' | 'week') {
  if (granularity === 'day') return rows;
  const result: DayValues[] = [];
  for (let index = 0; index < rows.length; index += 7) {
    const chunk = rows.slice(index, index + 7);
    const point = { date: chunk.at(-1)?.date || '' } as DayValues;
    for (const metric of Object.keys(productMetricLabels) as ProductMetric[]) {
      point[metric] = percentageMetrics.has(metric)
        ? chunk.reduce((sum, row) => sum + row[metric], 0) / Math.max(1, chunk.length)
        : chunk.reduce((sum, row) => sum + row[metric], 0);
    }
    result.push(point);
  }
  return result;
}

export default function ProductOverviewPage({ productId, onBack }: { productId: string; onBack: () => void }) {
  useSyncExternalStore(subscribe, getVersion);
  const products = getProducts();
  const metricRows = getMetrics();
  const profitabilityRows = getProfitabilityRecords();
  const geographyRows = getGeographyOrders();
  const entryPointRows = getEntryPoints();
  const product = products.find(item => item.id === productId);
  const relatedIds = useMemo(() => new Set(getRelatedProductIds(productId)), [productId, products]);
  const cabinet = getCabinets().find(item => item.id === product?.cabinet_id);
  const brand = getBrands().find(item => item.id === product?.brand_id);
  const groupIds = getMemberships().filter(item => relatedIds.has(item.product_id)).map(item => item.group_id);
  const productGroups = getGroups().filter(item => groupIds.includes(item.id));
  const groupProductIds = useMemo(() => new Set(getMemberships().filter(item => groupIds.includes(item.group_id)).map(item => item.product_id)), [groupIds, products]);
  const allMetrics = useMemo(() => metricRows.filter(row => relatedIds.has(row.product_id)).sort((a, b) => a.date.localeCompare(b.date)), [metricRows, relatedIds]);
  const allProfitability = useMemo(() => profitabilityRows.filter(row => relatedIds.has(row.product_id)), [profitabilityRows, relatedIds]);
  const allGeography = useMemo(() => geographyRows.filter(row => relatedIds.has(row.product_id)), [geographyRows, relatedIds]);
  const allEntryPoints = useMemo(() => entryPointRows.filter(row => relatedIds.has(row.product_id)), [entryPointRows, relatedIds]);
  const maxDate = allMetrics.at(-1)?.date || new Date().toISOString().slice(0, 10);
  const initialPeriod = useMemo<DatePeriod>(() => ({ start: `${maxDate.slice(0, 7)}-01`, end: maxDate }), [maxDate]);
  const [period, setPeriod] = useState<DatePeriod>(initialPeriod);
  const [comparison, setComparison] = useState<DatePeriod>(() => previousPeriod(initialPeriod));
  const changePeriod = (nextPeriod: DatePeriod) => {
    setPeriod(nextPeriod);
    setComparison(previousPeriod(nextPeriod));
  };
  const [primaryMetric, setPrimaryMetric] = useState<ProductMetric>('revenue');
  const [secondaryMetric, setSecondaryMetric] = useState<ProductMetric>('profit');
  const [granularity, setGranularity] = useState<'day' | 'week'>('day');
  const [geoRegion, setGeoRegion] = useState('');
  const [entryPointFilter, setEntryPointFilter] = useState('');
  const [trafficMetric, setTrafficMetric] = useState<TrafficMetric>('orders');
  const [showAllTraffic, setShowAllTraffic] = useState(false);
  const [funnelMode, setFunnelMode] = useState<'product' | 'group'>('product');
  const metrics = useMemo(() => allMetrics.filter(row => row.date >= period.start && row.date <= period.end), [allMetrics, period]);
  const previousMetrics = useMemo(() => allMetrics.filter(row => row.date >= comparison.start && row.date <= comparison.end), [allMetrics, comparison]);
  const profitability = useMemo(() => allProfitability.filter(row => row.period_start >= period.start && row.period_start <= period.end), [allProfitability, period]);
  const previousProfitability = useMemo(() => allProfitability.filter(row => row.period_start >= comparison.start && row.period_start <= comparison.end), [allProfitability, comparison]);
  const geography = useMemo(() => allGeography.filter(row => row.date >= period.start && row.date <= period.end), [allGeography, period]);
  const entryPoints = useMemo(() => allEntryPoints.filter(row => row.date >= period.start && row.date <= period.end), [allEntryPoints, period]);
  const groupMetrics = useMemo(() => metricRows.filter(row => groupProductIds.has(row.product_id) && row.date >= period.start && row.date <= period.end), [metricRows, groupProductIds, period]);
  const entryPointOptions = useMemo(() => [...new Set(entryPoints.map(row => `${row.section} · ${row.entry_point}`))].sort((left, right) => left.localeCompare(right, 'ru')), [entryPoints]);
  const totals = useMemo(() => summarizePeriod(metrics, profitability, product?.cabinet_id || ''), [metrics, profitability, product]);
  const previousTotals = useMemo(() => summarizePeriod(previousMetrics, previousProfitability, product?.cabinet_id || ''), [previousMetrics, previousProfitability, product]);
  const groupTotals = useMemo(() => sumFunnel(groupMetrics), [groupMetrics]);

  const currentDaily = useMemo(() => buildDailyValues({ period, metricRows: allMetrics, profitabilityRows: allProfitability, entryPointRows: allEntryPoints, geographyRows: allGeography, cabinetId: product?.cabinet_id || '', entryPointFilter, geoRegion }), [period, allMetrics, allProfitability, allEntryPoints, allGeography, product, entryPointFilter, geoRegion]);
  const previousDaily = useMemo(() => buildDailyValues({ period: comparison, metricRows: allMetrics, profitabilityRows: allProfitability, entryPointRows: allEntryPoints, geographyRows: allGeography, cabinetId: product?.cabinet_id || '', entryPointFilter, geoRegion }), [comparison, allMetrics, allProfitability, allEntryPoints, allGeography, product, entryPointFilter, geoRegion]);
  const trend = useMemo(() => {
    const current = aggregateSeries(currentDaily, granularity);
    const previous = aggregateSeries(previousDaily, granularity);
    return current.map((row, index) => ({
      date: displayDate(row.date),
      primary: row[primaryMetric], secondary: row[secondaryMetric],
      primaryPrevious: previous[index]?.[primaryMetric] || 0,
      secondaryPrevious: previous[index]?.[secondaryMetric] || 0,
    }));
  }, [currentDaily, previousDaily, granularity, primaryMetric, secondaryMetric]);

  const geoSummary = useMemo(() => {
    const orders = geography.reduce((sum, row) => sum + row.orders_total, 0);
    const local = geography.reduce((sum, row) => sum + row.product_local_orders, 0);
    const covered = geography.filter(row => row.delivery_hours !== null && row.orders_total > 0);
    const coveredOrders = covered.reduce((sum, row) => sum + row.orders_total, 0);
    const delivery = coveredOrders ? covered.reduce((sum, row) => sum + (row.delivery_hours || 0) * row.orders_total, 0) / coveredOrders : 0;
    const byRegion = new Map<string, number>();
    geography.forEach(row => byRegion.set(row.region, (byRegion.get(row.region) || 0) + row.orders_total));
    return { orders, localShare: orders ? local / orders * 100 : 0, delivery, regions: [...byRegion.entries()].map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value) };
  }, [geography]);

  const topPoints = useMemo(() => {
    const map = new Map<string, { impressions: number; clicks: number; carts: number; orders: number; orderedAmount: number }>();
    entryPoints.forEach(row => {
      const name = `${row.section} · ${row.entry_point}`;
      const current = map.get(name) || { impressions: 0, clicks: 0, carts: 0, orders: 0, orderedAmount: 0 };
      current.impressions += row.impressions; current.clicks += row.clicks; current.carts += row.carts; current.orders += row.orders;
      current.orderedAmount += row.product_orders_total ? (row.product_ordered_amount || 0) * row.orders / row.product_orders_total : 0;
      map.set(name, current);
    });
    return [...map.entries()].map(([name, value]) => ({ ...value, name, ctr: value.impressions ? value.clicks / value.impressions * 100 : 0, cr: value.impressions ? value.orders / value.impressions * 100 : 0 })).sort((a, b) => b[trafficMetric] - a[trafficMetric]);
  }, [entryPoints, trafficMetric]);

  const geoTrend = useMemo(() => {
    const amountByDate = new Map(metrics.map(row => [row.date, { amount: 0, orders: 0 }]));
    metrics.forEach(row => { const current = amountByDate.get(row.date) || { amount: 0, orders: 0 }; current.amount += row.ordered_amount; current.orders += row.orders; amountByDate.set(row.date, current); });
    return [...new Set(geography.filter(row => !geoRegion || row.region === geoRegion).map(row => row.date))].sort().map(date => {
      const rows = geography.filter(row => row.date === date && (!geoRegion || row.region === geoRegion));
      const orders = rows.reduce((sum, row) => sum + row.orders_total, 0);
      const dayMetric = amountByDate.get(date) || { amount: 0, orders: 0 };
      return { date: displayDate(date), orders, orderedAmount: dayMetric.orders ? dayMetric.amount * orders / dayMetric.orders : 0 };
    });
  }, [geography, geoRegion, metrics]);

  const imageUrl = getWbImageUrls(product?.wb_sku || '')[0];
  if (!product) return <section className="product-overview-empty"><h2>Товар не найден</h2></section>;
  const productName = product.name && product.name !== product.sku ? product.name : `Товар ${product.sku}`;
  const activeFunnel = funnelMode === 'group' && groupTotals.impressions ? groupTotals : totals;
  const trafficRows = showAllTraffic ? topPoints : topPoints.slice(0, 6);
  const kpis = [
    { label: 'Заказы', value: fmt(totals.orders), current: totals.orders, previous: previousTotals.orders, spark: currentDaily.map(row => row.orders), color: '#3B82F6' },
    { label: 'Выручка', value: money(totals.revenue), current: totals.revenue, previous: previousTotals.revenue, spark: currentDaily.map(row => row.revenue), color: '#3B82F6' },
    { label: 'Чистая прибыль', value: money(totals.netProfit), current: totals.netProfit, previous: previousTotals.netProfit, spark: currentDaily.map(row => row.profit), color: '#10B981' },
    { label: 'Рентабельность', value: `${fmt(totals.profitability, 1)}%`, current: totals.profitability, previous: previousTotals.profitability, spark: currentDaily.map(row => row.profitability), color: '#10B981', rate: true },
    { label: 'ДРР', value: `${fmt(totals.drr, 1)}%`, current: totals.drr, previous: previousTotals.drr, spark: currentDaily.map(row => row.drr), color: '#F5A300', rate: true, inverse: true },
    { label: 'Конверсия в заказ', value: `${fmt(totals.orderCr, 2)}%`, current: totals.orderCr, previous: previousTotals.orderCr, spark: currentDaily.map(row => row.impressions ? row.orders / row.impressions * 100 : 0), color: '#3B82F6', rate: true },
  ];

  return <section className="product-overview-page product-overview-v2">
    <nav className="product-breadcrumbs" aria-label="Навигация по товару"><button type="button" onClick={onBack}>Главная</button><span>›</span><span>{productGroups[0]?.name || product.category || 'Товары'}</span><span>›</span><b>{product.sku}</b></nav>
    <header className="product-overview-header">
      <div className="product-overview-identity">{imageUrl ? <img src={imageUrl} alt={productName} /> : <span>Т</span>}<div><div className="product-title-line"><h1>{productName}</h1><span aria-hidden="true">☆</span></div><p>SKU: {product.sku}{product.wb_sku ? ` · WB ID: ${product.wb_sku}` : ''}</p><div className="product-identity-meta"><div className="product-identity-tags"><span>{cabinet?.name || 'Без кабинета'}</span>{productGroups[0] && <span>{productGroups[0].name}</span>}{brand && <span>{brand.name}</span>}<span>{product.category || 'Без категории'}</span></div><div className="date-filters product-header-periods"><DateRangeFilter label="Период" value={period} onChange={changePeriod} maxDate={maxDate} /><DateRangeFilter label="Сравнение" value={comparison} onChange={setComparison} maxDate={maxDate} /></div></div></div></div>
    </header>

    <div className="product-kpis">{kpis.map(card => <KpiCard key={card.label} {...card} />)}</div>

    <div className="product-overview-grid product-overview-main-row">
      <article className="product-panel product-trend"><div className="product-panel-head"><h2>Динамика метрик</h2><div className="product-granularity"><button className={granularity === 'day' ? 'active' : ''} onClick={() => setGranularity('day')}>День</button><button className={granularity === 'week' ? 'active' : ''} onClick={() => setGranularity('week')}>Неделя</button></div></div><div className="product-chart-toolbar"><label className="product-metric-chip primary"><i /><select value={primaryMetric} onChange={event => setPrimaryMetric(event.target.value as ProductMetric)}>{Object.entries(productMetricLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label><label className="product-metric-chip secondary"><i /><select value={secondaryMetric} onChange={event => setSecondaryMetric(event.target.value as ProductMetric)}>{Object.entries(productMetricLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>{(primaryMetric === 'entryOrders' || primaryMetric === 'entryCtr' || secondaryMetric === 'entryOrders' || secondaryMetric === 'entryCtr') && <select className="product-source-filter" value={entryPointFilter} onChange={event => setEntryPointFilter(event.target.value)}><option value="">Все точки входа</option>{entryPointOptions.map(point => <option key={point}>{point}</option>)}</select>}{(primaryMetric === 'localShare' || primaryMetric === 'delivery' || secondaryMetric === 'localShare' || secondaryMetric === 'delivery') && <select className="product-source-filter" value={geoRegion} onChange={event => setGeoRegion(event.target.value)}><option value="">Все ФО</option>{geoSummary.regions.map(row => <option key={row.name}>{row.name}</option>)}</select>}</div><ResponsiveContainer width="100%" height={250}><LineChart data={trend} margin={{ top: 8, right: 4, left: -12, bottom: 0 }}><CartesianGrid stroke="#e8eef5" strokeDasharray="3 3" /><XAxis dataKey="date" tick={{ fontSize: 9 }} /><YAxis yAxisId="a" tick={{ fontSize: 9 }} /><YAxis yAxisId="b" orientation="right" tick={{ fontSize: 9 }} /><Tooltip /><Legend wrapperStyle={{ fontSize: 9 }} /><Line yAxisId="a" dataKey="primary" name={productMetricLabels[primaryMetric]} stroke="#3B82F6" strokeWidth={2.2} dot={{ r: 2 }} /><Line yAxisId="a" dataKey="primaryPrevious" name={`${productMetricLabels[primaryMetric]} (пред.)`} stroke="#8DB8FF" strokeWidth={1.5} strokeDasharray="4 4" dot={false} /><Line yAxisId="b" dataKey="secondary" name={productMetricLabels[secondaryMetric]} stroke="#10B981" strokeWidth={2.1} dot={{ r: 2 }} /><Line yAxisId="b" dataKey="secondaryPrevious" name={`${productMetricLabels[secondaryMetric]} (пред.)`} stroke="#80D8B9" strokeWidth={1.5} strokeDasharray="4 4" dot={false} /></LineChart></ResponsiveContainer></article>
      <article className="product-panel product-funnel"><div className="product-panel-head"><h2>Воронка продаж</h2>{groupTotals.impressions > 0 && <div className="product-funnel-toggle"><button className={funnelMode === 'product' ? 'active' : ''} onClick={() => setFunnelMode('product')}>Товар</button><button className={funnelMode === 'group' ? 'active' : ''} onClick={() => setFunnelMode('group')}>Склейка</button></div>}</div><FunnelSteps totals={activeFunnel} productTotals={funnelMode === 'group' ? totals : undefined} />{funnelMode === 'group' && <p className="product-funnel-share">Доля товара в заказах склейки: <b>{fmt(groupTotals.orders ? totals.orders / groupTotals.orders * 100 : 0, 1)}%</b></p>}</article>
    </div>

    <div className="product-overview-grid product-overview-secondary-row">
      <article className="product-panel product-entry-panel"><div className="product-panel-head"><h2>Источники трафика</h2></div>{topPoints.length ? <><div className="product-entry-layout"><div className="product-entry-chart"><div className="product-traffic-tabs"><button className={trafficMetric === 'orders' ? 'active' : ''} onClick={() => setTrafficMetric('orders')}>Заказы</button><button className={trafficMetric === 'orderedAmount' ? 'active' : ''} onClick={() => setTrafficMetric('orderedAmount')}>Сумма заказов</button><button className={trafficMetric === 'impressions' ? 'active' : ''} onClick={() => setTrafficMetric('impressions')}>Показы</button></div><ResponsiveContainer width="100%" height={210}><BarChart data={trafficRows} layout="vertical" margin={{ left: 6, right: 18 }}><XAxis type="number" tick={{ fontSize: 8 }} /><YAxis type="category" dataKey="name" width={138} tick={{ fontSize: 8 }} /><Tooltip formatter={(value) => trafficMetric === 'orderedAmount' ? money(Number(value)) : fmt(Number(value))} /><Bar dataKey={trafficMetric} fill="#4F8FF7" radius={[0, 4, 4, 0]} /></BarChart></ResponsiveContainer></div><div className="product-entry-table"><table><thead><tr><th>Источник</th><th>Показы</th><th>Клики</th><th>CTR</th><th>Корзины</th><th>Заказы</th><th>CR заказа</th></tr></thead><tbody>{trafficRows.map(row => <tr key={row.name}><td title={row.name}>{row.name}</td><td>{fmt(row.impressions)}</td><td>{fmt(row.clicks)}</td><td>{fmt(row.ctr, 1)}%</td><td>{fmt(row.carts)}</td><td>{fmt(row.orders)}</td><td>{fmt(row.cr, 2)}%</td></tr>)}</tbody></table></div></div>{topPoints.length > 6 && <button className="product-show-all" type="button" onClick={() => setShowAllTraffic(value => !value)}>{showAllTraffic ? 'Свернуть' : 'Показать все источники'}</button>}</> : <div className="product-empty-state">Нет точек входа в выбранном периоде.</div>}</article>
      <article className="product-panel product-geo-summary"><div className="product-panel-head"><h2>География и доставка</h2></div>{geoSummary.regions.length ? <><div className="product-geo-kpis"><span>Локальность<strong>{fmt(geoSummary.localShare, 1)}%</strong></span><span>Среднее время<strong>{fmt(geoSummary.delivery, 1)} ч</strong></span><span>Заказы<strong>{fmt(geoSummary.orders)}</strong></span></div><div className="product-geo-layout"><div className="product-region-list">{geoSummary.regions.slice(0, 8).map(row => <div className="product-region-row" key={row.name}><span title={row.name}>{row.name}</span><b>{fmt(row.value)}</b></div>)}</div><ResponsiveContainer width="100%" height={190}><LineChart data={geoTrend} margin={{ top: 8, right: 4, left: -16, bottom: 0 }}><CartesianGrid stroke="#e8eef5" strokeDasharray="3 3" /><XAxis dataKey="date" tick={{ fontSize: 8 }} /><YAxis yAxisId="orders" tick={{ fontSize: 8 }} /><YAxis yAxisId="amount" orientation="right" tick={{ fontSize: 8 }} /><Tooltip /><Legend wrapperStyle={{ fontSize: 8 }} /><Line yAxisId="orders" dataKey="orders" name="Заказы" stroke="#3B82F6" strokeWidth={2} dot={false} /><Line yAxisId="amount" dataKey="orderedAmount" name="Сумма заказов" stroke="#10B981" strokeWidth={2} dot={false} /></LineChart></ResponsiveContainer></div><select className="product-geo-filter" value={geoRegion} onChange={event => setGeoRegion(event.target.value)}><option value="">Все ФО</option>{geoSummary.regions.map(row => <option key={row.name}>{row.name}</option>)}</select></> : <div className="product-empty-state">Нет географических данных в выбранном периоде.</div>}</article>
    </div>
  </section>;
}
