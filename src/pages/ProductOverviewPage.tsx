import { useMemo, useState, useSyncExternalStore } from 'react';
import { Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import DateRangeFilter from '../components/DateRangeFilter';
import { getBrands, getCabinets, getEntryPoints, getGeographyOrders, getGroups, getMemberships, getMetrics, getProducts, getProfitabilityRecords, getRelatedProductIds, getVersion, subscribe } from '../data/store';
import { getCabinetExtraExpense } from '../data/profitStore';
import { getReportNetProfit } from '../data/profitabilityCalculations';
import { getWbImageUrls } from '../data/images';
import type { DailyMetrics } from '../types';

const fmt = (value: number, digits = 0) => new Intl.NumberFormat('ru-RU', { maximumFractionDigits: digits }).format(value);
type ProductMetric = 'orderedAmount' | 'orders' | 'impressions' | 'clicks' | 'carts' | 'ctr' | 'profit' | 'profitability' | 'adSpend' | 'drr' | 'entryOrders' | 'entryCtr' | 'localShare' | 'delivery';
type FunnelTotals = Pick<DailyMetrics, 'impressions' | 'clicks' | 'carts' | 'orders' | 'ordered_amount'>;

const productMetricLabels: Record<ProductMetric, string> = {
  orderedAmount: 'Сумма заказов', orders: 'Заказы, шт', impressions: 'Показы', clicks: 'Клики', carts: 'Корзины', ctr: 'CTR',
  profit: 'Чистая прибыль', profitability: 'Рентабельность', adSpend: 'Реклама', drr: 'ДРР', entryOrders: 'Заказы точек входа',
  entryCtr: 'CTR точек входа', localShare: 'Локальность', delivery: 'СВД, ч',
};

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

function funnelWidth(value: number, maximum: number) {
  if (!maximum || !value) return '30%';
  return `${Math.min(100, 24 + Math.sqrt(value / maximum) * 76)}%`;
}

function FunnelSteps({ totals, productTotals }: { totals: FunnelTotals; productTotals?: FunnelTotals }) {
  const stages = [
    { label: 'Показы', value: totals.impressions, productValue: productTotals?.impressions ?? 0 },
    { label: 'Клики', value: totals.clicks, productValue: productTotals?.clicks ?? 0, conversion: totals.impressions ? totals.clicks / totals.impressions * 100 : 0, conversionLabel: 'CTR' },
    { label: 'Корзины', value: totals.carts, productValue: productTotals?.carts ?? 0, conversion: totals.clicks ? totals.carts / totals.clicks * 100 : 0, conversionLabel: 'CR в корзину' },
    { label: 'Заказы', value: totals.orders, productValue: productTotals?.orders ?? 0, conversion: totals.impressions ? totals.orders / totals.impressions * 100 : 0, conversionLabel: 'CR показ → заказ' },
  ];
  return <div className="product-funnel-steps">
    {stages.map((stage, index) => <div className="product-funnel-stage" key={stage.label}>
      {index > 0 && <i>{stage.conversionLabel} <b>{fmt(stage.conversion || 0, index === 3 ? 2 : 1)}%</b></i>}
      <div style={{ '--step-width': funnelWidth(stage.value, totals.impressions) } as React.CSSProperties}>
        <span>{stage.label}</span><strong>{fmt(stage.value)}</strong>
        {productTotals && <small>Доля товара: {fmt(stage.value ? stage.productValue / stage.value * 100 : 0, 1)}%</small>}
      </div>
    </div>)}
  </div>;
}

export default function ProductOverviewPage({ productId }: { productId: string; onBack: () => void }) {
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
  const maxDate = allMetrics.at(-1)?.date || new Date().toISOString().slice(0, 10);
  const [period, setPeriod] = useState(() => ({ start: `${maxDate.slice(0, 7)}-01`, end: maxDate }));
  const [primaryMetric, setPrimaryMetric] = useState<ProductMetric>('orderedAmount');
  const [secondaryMetric, setSecondaryMetric] = useState<ProductMetric>('profit');
  const [geoRegion, setGeoRegion] = useState('');
  const [entryPointFilter, setEntryPointFilter] = useState('');
  const metrics = useMemo(() => allMetrics.filter(row => row.date >= period.start && row.date <= period.end), [allMetrics, period]);
  const profitability = useMemo(() => profitabilityRows.filter(row => relatedIds.has(row.product_id) && row.period_start >= period.start && row.period_start <= period.end), [profitabilityRows, relatedIds, period]);
  const geography = useMemo(() => geographyRows.filter(row => relatedIds.has(row.product_id) && row.date >= period.start && row.date <= period.end), [geographyRows, relatedIds, period]);
  const entryPoints = useMemo(() => entryPointRows.filter(row => relatedIds.has(row.product_id) && row.date >= period.start && row.date <= period.end), [entryPointRows, relatedIds, period]);
  const groupMetrics = useMemo(() => metricRows.filter(row => groupProductIds.has(row.product_id) && row.date >= period.start && row.date <= period.end), [metricRows, groupProductIds, period]);
  const entryPointOptions = useMemo(() => [...new Set(entryPoints.map(row => `${row.section} · ${row.entry_point}`))].sort((left, right) => left.localeCompare(right, 'ru')), [entryPoints]);

  const totals = useMemo(() => {
    const funnel = sumFunnel(metrics);
    const revenue = metrics.reduce((sum, row) => sum + row.buyout_amount, 0);
    const adSpend = metrics.reduce((sum, row) => sum + row.ad_spend, 0);
    const netProfit = profitability.reduce((sum, row) => sum + getReportNetProfit(row, getCabinetExtraExpense(row.period_start.slice(0, 7), product?.cabinet_id || '')), 0);
    const profitRevenue = profitability.reduce((sum, row) => sum + row.profit_revenue, 0);
    return { ...funnel, revenue, adSpend, netProfit, profitability: profitRevenue ? netProfit / profitRevenue * 100 : 0, drr: funnel.ordered_amount ? adSpend / funnel.ordered_amount * 100 : 0 };
  }, [metrics, profitability, product]);
  const groupTotals = useMemo(() => sumFunnel(groupMetrics), [groupMetrics]);

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

  const trend = useMemo(() => {
    const metricsByDate = new Map<string, DailyMetrics[]>();
    metrics.forEach(row => { const rows = metricsByDate.get(row.date) || []; rows.push(row); metricsByDate.set(row.date, rows); });
    const profitsByDate = new Map<string, { profit: number; revenue: number }>();
    profitability.forEach(row => {
      const current = profitsByDate.get(row.period_start) || { profit: 0, revenue: 0 };
      current.profit += getReportNetProfit(row, getCabinetExtraExpense(row.period_start.slice(0, 7), product?.cabinet_id || ''));
      current.revenue += row.profit_revenue;
      profitsByDate.set(row.period_start, current);
    });
    const entriesByDate = new Map<string, { impressions: number; clicks: number; orders: number }>();
    entryPoints.filter(item => !entryPointFilter || `${item.section} · ${item.entry_point}` === entryPointFilter).forEach(item => {
      const current = entriesByDate.get(item.date) || { impressions: 0, clicks: 0, orders: 0 };
      current.impressions += item.impressions; current.clicks += item.clicks; current.orders += item.orders; entriesByDate.set(item.date, current);
    });
    const geoByDate = new Map<string, typeof geography>();
    geography.filter(item => !geoRegion || item.region === geoRegion).forEach(item => { const rows = geoByDate.get(item.date) || []; rows.push(item); geoByDate.set(item.date, rows); });
    return [...metricsByDate.keys()].sort().map(date => {
      const day = sumFunnel(metricsByDate.get(date) || []);
      const profit = profitsByDate.get(date) || { profit: 0, revenue: 0 };
      const entries = entriesByDate.get(date) || { impressions: 0, clicks: 0, orders: 0 };
      const geoRows = geoByDate.get(date) || [];
      const geoOrders = geoRows.reduce((sum, row) => sum + row.orders_total, 0);
      const geoLocal = geoRows.reduce((sum, row) => sum + row.product_local_orders, 0);
      const covered = geoRows.filter(row => row.delivery_hours !== null && row.orders_total > 0);
      const coveredOrders = covered.reduce((sum, row) => sum + row.orders_total, 0);
      const values: Record<ProductMetric, number> = {
        orderedAmount: day.ordered_amount, orders: day.orders, impressions: day.impressions, clicks: day.clicks, carts: day.carts,
        ctr: day.impressions ? day.clicks / day.impressions * 100 : 0, profit: profit.profit, profitability: profit.revenue ? profit.profit / profit.revenue * 100 : 0,
        adSpend: (metricsByDate.get(date) || []).reduce((sum, row) => sum + row.ad_spend, 0), drr: day.ordered_amount ? (metricsByDate.get(date) || []).reduce((sum, row) => sum + row.ad_spend, 0) / day.ordered_amount * 100 : 0,
        entryOrders: entries.orders, entryCtr: entries.impressions ? entries.clicks / entries.impressions * 100 : 0,
        localShare: geoOrders ? geoLocal / geoOrders * 100 : 0, delivery: coveredOrders ? covered.reduce((sum, row) => sum + (row.delivery_hours || 0) * row.orders_total, 0) / coveredOrders : 0,
      };
      return { date: date.slice(5), primary: values[primaryMetric], secondary: values[secondaryMetric] };
    });
  }, [metrics, profitability, product, entryPoints, geography, geoRegion, entryPointFilter, primaryMetric, secondaryMetric]);

  const topPoints = useMemo(() => {
    const map = new Map<string, { impressions: number; clicks: number; carts: number; orders: number }>();
    entryPoints.forEach(row => {
      const name = `${row.section} · ${row.entry_point}`;
      const current = map.get(name) || { impressions: 0, clicks: 0, carts: 0, orders: 0 };
      current.impressions += row.impressions; current.clicks += row.clicks; current.carts += row.carts; current.orders += row.orders; map.set(name, current);
    });
    return [...map.entries()].map(([name, value]) => ({ ...value, name, ctr: value.impressions ? value.clicks / value.impressions * 100 : 0, cr: value.impressions ? value.orders / value.impressions * 100 : 0 })).sort((a, b) => b.orders - a.orders);
  }, [entryPoints]);
  const geoTrend = useMemo(() => [...new Set(geography.filter(row => !geoRegion || row.region === geoRegion).map(row => row.date))].sort().map(date => {
    const rows = geography.filter(row => row.date === date && (!geoRegion || row.region === geoRegion));
    const orders = rows.reduce((sum, row) => sum + row.orders_total, 0), local = rows.reduce((sum, row) => sum + row.product_local_orders, 0);
    const covered = rows.filter(row => row.delivery_hours !== null && row.orders_total > 0), coveredOrders = covered.reduce((sum, row) => sum + row.orders_total, 0);
    return { date: date.slice(5), localShare: orders ? local / orders * 100 : 0, delivery: coveredOrders ? covered.reduce((sum, row) => sum + (row.delivery_hours || 0) * row.orders_total, 0) / coveredOrders : 0 };
  }), [geography, geoRegion]);
  const imageUrl = getWbImageUrls(product?.wb_sku || '')[0];

  if (!product) return <section className="product-overview-empty"><h2>Товар не найден</h2></section>;

  return <section className="product-overview-page">
    <header className="product-overview-header">
      <div className="product-overview-identity">{imageUrl ? <img src={imageUrl} alt="" /> : <span>Т</span>}<div><small>КАРТОЧКА ТОВАРА</small><h1>{product.name || product.sku}</h1><p><b>SKU {product.sku}</b>{product.wb_sku ? ` · WB ${product.wb_sku}` : ''}</p><div className="product-identity-tags"><span>{cabinet?.name || 'Без кабинета'}</span><span>{product.category || 'Без категории'}</span>{brand && <span>{brand.name}</span>}{productGroups.slice(0, 2).map(group => <span key={group.id}>{group.name}</span>)}</div></div></div>
      <div className="product-header-period"><span>Период</span><DateRangeFilter label="Период" value={period} onChange={setPeriod} maxDate={maxDate} /></div>
    </header>
    <div className="product-source-status"><strong>Покрытие данных</strong><span className={metrics.length ? 'ready' : ''}>Воронка · {metrics.at(-1)?.date || 'нет данных'}</span><span className={profitability.length ? 'ready' : ''}>Финансы · {profitability.at(-1)?.period_start || 'нет данных'}</span><span className={geography.length ? 'ready' : ''}>География · {geography.at(-1)?.date || 'нет данных'}</span><span className={entryPoints.length ? 'ready' : ''}>Точки входа · {entryPoints.at(-1)?.date || 'нет данных'}</span></div>
    <div className="product-kpis"><article><span>Сумма заказов</span><strong>{fmt(totals.ordered_amount)} ₽</strong><small>{fmt(totals.orders)} заказов</small></article><article><span>Выручка</span><strong>{fmt(totals.revenue)} ₽</strong><small>Средний чек {fmt(totals.orders ? totals.ordered_amount / totals.orders : 0)} ₽</small></article><article><span>Чистая прибыль</span><strong>{fmt(totals.netProfit)} ₽</strong><small>Рентабельность {fmt(totals.profitability, 1)}%</small></article><article><span>Реклама</span><strong>{fmt(totals.adSpend)} ₽</strong><small>ДРР {fmt(totals.drr, 1)}%</small></article></div>
    <div className="product-overview-grid"><article className="product-panel product-trend"><div className="product-panel-head"><div><span>ДИНАМИКА</span><h2>Сравнение метрик</h2></div><div className="product-metric-controls"><select value={primaryMetric} onChange={event => setPrimaryMetric(event.target.value as ProductMetric)}>{Object.entries(productMetricLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select><select value={secondaryMetric} onChange={event => setSecondaryMetric(event.target.value as ProductMetric)}>{Object.entries(productMetricLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select>{(primaryMetric === 'entryOrders' || primaryMetric === 'entryCtr' || secondaryMetric === 'entryOrders' || secondaryMetric === 'entryCtr') && <select className="product-source-filter" value={entryPointFilter} onChange={event => setEntryPointFilter(event.target.value)}><option value="">Все точки входа</option>{entryPointOptions.map(point => <option key={point}>{point}</option>)}</select>}{(primaryMetric === 'localShare' || primaryMetric === 'delivery' || secondaryMetric === 'localShare' || secondaryMetric === 'delivery') && <select className="product-source-filter" value={geoRegion} onChange={event => setGeoRegion(event.target.value)}><option value="">Все ФО</option>{geoSummary.regions.map(row => <option key={row.name}>{row.name}</option>)}</select>}</div></div><ResponsiveContainer width="100%" height={280}><LineChart data={trend}><CartesianGrid stroke="#e8eef5" strokeDasharray="3 3" /><XAxis dataKey="date" tick={{ fontSize: 9 }} /><YAxis yAxisId="a" tick={{ fontSize: 9 }} /><YAxis yAxisId="b" orientation="right" tick={{ fontSize: 9 }} /><Tooltip /><Line yAxisId="a" dataKey="primary" name={productMetricLabels[primaryMetric]} stroke="#3B82F6" strokeWidth={2.5} dot={false} /><Line yAxisId="b" dataKey="secondary" name={productMetricLabels[secondaryMetric]} stroke="#10B981" strokeWidth={2.3} dot={false} /></LineChart></ResponsiveContainer></article><article className="product-panel product-funnel"><div className="product-panel-head"><div><span>КОНВЕРСИЯ</span><h2>Воронка продаж</h2></div></div><section className="product-funnel-section"><h3>Товар</h3><FunnelSteps totals={totals} /></section><section className="product-funnel-section product-group-funnel"><h3>{productGroups[0]?.name || 'Склейка'} <small>и доля товара</small></h3><FunnelSteps totals={groupTotals} productTotals={totals} /><p>Товар: {fmt(totals.orders)} из {fmt(groupTotals.orders)} заказов ({fmt(groupTotals.orders ? totals.orders / groupTotals.orders * 100 : 0, 1)}%)</p></section></article></div>
    <article className="product-panel product-entry-panel"><div className="product-panel-head"><div><span>ИСТОЧНИКИ ТРАФИКА</span><h2>Точки входа</h2></div></div>{topPoints.length ? <div className="product-entry-layout"><ResponsiveContainer width="100%" height={220}><BarChart data={topPoints.slice(0, 7)} layout="vertical" margin={{ left: 72 }}><XAxis type="number" /><YAxis type="category" dataKey="name" width={135} tick={{ fontSize: 8 }} /><Tooltip /><Bar dataKey="orders" fill="#60A5FA" radius={[0, 4, 4, 0]} /></BarChart></ResponsiveContainer><div className="product-entry-table"><table><thead><tr><th>Точка входа</th><th>Показы</th><th>Клики</th><th>CTR</th><th>Корз.</th><th>Заказы</th><th>CR</th></tr></thead><tbody>{topPoints.map(row => <tr key={row.name}><td>{row.name}</td><td>{fmt(row.impressions)}</td><td>{fmt(row.clicks)}</td><td>{fmt(row.ctr, 1)}%</td><td>{fmt(row.carts)}</td><td>{fmt(row.orders)}</td><td>{fmt(row.cr, 2)}%</td></tr>)}</tbody></table></div></div> : <div className="product-empty-state">Нет точек входа в выбранном периоде.</div>}</article>
    <article className="product-panel product-geo-summary"><div className="product-panel-head"><div><span>ГЕОГРАФИЯ</span><h2>Локальность и доставка</h2></div><select value={geoRegion} onChange={event => setGeoRegion(event.target.value)}><option value="">Все ФО</option>{geoSummary.regions.map(row => <option key={row.name}>{row.name}</option>)}</select></div>{geoSummary.regions.length ? <div className="product-geo-layout"><div><div className="product-geo-kpis"><span>Локальность<strong>{fmt(geoSummary.localShare, 1)}%</strong></span><span>СВД<strong>{fmt(geoSummary.delivery, 1)} ч</strong></span><span>Заказы<strong>{fmt(geoSummary.orders)}</strong></span></div><div className="product-region-list">{geoSummary.regions.map(row => <div className="product-region-row" key={row.name}><span title={row.name}>{row.name}</span><b>{fmt(row.value)}</b></div>)}</div></div><ResponsiveContainer width="100%" height={260}><LineChart data={geoTrend}><CartesianGrid stroke="#e8eef5" strokeDasharray="3 3" /><XAxis dataKey="date" /><YAxis yAxisId="local" /><YAxis yAxisId="delivery" orientation="right" /><Tooltip /><Line yAxisId="local" dataKey="localShare" name="Локальность" stroke="#10B981" strokeWidth={2.3} dot={false} /><Line yAxisId="delivery" dataKey="delivery" name="СВД" stroke="#60A5FA" strokeWidth={2.3} dot={false} /></LineChart></ResponsiveContainer></div> : <div className="product-empty-state">Нет географических данных в выбранном периоде.</div>}</article>
  </section>;
}
