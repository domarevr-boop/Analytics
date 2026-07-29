import { Fragment, useMemo, useState, useSyncExternalStore } from 'react';
import { CartesianGrid, Cell, Legend, Line, LineChart, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import DateRangeFilter from '../../components/DateRangeFilter';
import FilterBar from '../../components/FilterBar';
import { getGeographyOrders, getGeographyPlans, getMemberships, getMetrics, getProducts, getProfitabilityRecords, getVersion, subscribe, upsertGeographyPlan } from '../../data/store';
import { getFilteredProductIds } from '../../data/productFilters';
import { getCabinetExtraExpense } from '../../data/profitStore';
import { getReportNetProfit } from '../../data/profitabilityCalculations';
import { appendToMap } from '../../data/collectionUtils';
import type { GeographyOrderRecord } from '../../types';

type ChartMetric = 'orders' | 'localOrders' | 'nonlocalOrders' | 'localShare' | 'deliveryHours' | 'stock';
type FunnelMetric = 'orderedAmount' | 'impressions' | 'clicks' | 'carts' | 'orders' | 'ctr' | 'cartCr' | 'impressionOrderCr';

const metricLabels: Record<ChartMetric, string> = {
  orders: 'Заказы, шт', localOrders: 'Локальные заказы, шт', nonlocalOrders: 'Не локальные заказы, шт',
  localShare: '% локальных заказов', deliveryHours: 'Среднее время доставки, ч', stock: 'Остатки, шт',
};
const funnelMetricLabels: Record<FunnelMetric, string> = {
  orderedAmount: 'Сумма заказов, ₽', impressions: 'Показы', clicks: 'Клики', carts: 'Корзины', orders: 'Заказы, шт', ctr: 'CTR', cartCr: 'CR корзины', impressionOrderCr: 'CR показ → заказ',
};
const regionColors = ['#2563EB', '#38BDF8', '#10B981', '#34D399', '#8B5CF6', '#F59E0B', '#F97316'];
type FinanceGeoRow = { region: string; area: string; city: string; orders: number; orderedAmount: number; netProfit: number; profitRevenue: number; profitability: number };

function sumFinance(rows: FinanceGeoRow[]) {
  const result = rows.reduce((sum, row) => ({ orders: sum.orders + row.orders, orderedAmount: sum.orderedAmount + row.orderedAmount, netProfit: sum.netProfit + row.netProfit, profitRevenue: sum.profitRevenue + row.profitRevenue }), { orders: 0, orderedAmount: 0, netProfit: 0, profitRevenue: 0 });
  return { ...result, profitability: result.profitRevenue ? result.netProfit / result.profitRevenue * 100 : 0 };
}

function formatNumber(value: number) { return new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 1 }).format(value); }
function formatHours(hours: number | null) {
  if (hours === null) return '—';
  const days = Math.floor(hours / 24);
  const rest = Math.round(hours % 24);
  return days > 0 ? `${days}д ${rest}ч` : `${rest}ч`;
}

function aggregate(records: GeographyOrderRecord[]) {
  const total = records.reduce((sum, record) => sum + record.orders_total, 0);
  const local = records.reduce((sum, record) => sum + record.product_local_orders, 0);
  const nonlocal = records.reduce((sum, record) => sum + record.product_nonlocal_orders, 0);
  const withDelivery = records.filter(record => record.delivery_hours !== null && record.orders_total > 0);
  const coveredOrders = withDelivery.reduce((sum, record) => sum + record.orders_total, 0);
  const deliveryHours = coveredOrders > 0
    ? withDelivery.reduce((sum, record) => sum + (record.delivery_hours || 0) * record.orders_total, 0) / coveredOrders
    : null;
  const stock = records.reduce((sum, record) => sum + record.stock_wb + record.stock_marketplace, 0);
  return { total, local, nonlocal, localShare: total ? local / total * 100 : 0, deliveryHours, coveredOrders, stock };
}

export default function GeographyPage() {
  useSyncExternalStore(subscribe, getVersion);
  const records = getGeographyOrders();
  const products = getProducts();
  const memberships = getMemberships();
  const dates = records.map(record => record.date).sort();
  const [start, setStart] = useState(() => dates[0] || '');
  const [end, setEnd] = useState(() => dates[dates.length - 1] || '');
  const [region, setRegion] = useState('');
  const [cabinetId, setCabinetId] = useState('');
  const [category, setCategory] = useState('');
  const [brandId, setBrandId] = useState('');
  const [groupId, setGroupId] = useState('');
  const [query, setQuery] = useState('');
  const [metric, setMetric] = useState<ChartMetric>('orders');
  const [comparisonMetric, setComparisonMetric] = useState<FunnelMetric>('orderedAmount');
  const [expandedRegions, setExpandedRegions] = useState<Set<string>>(() => new Set());
  const [expandedAreas, setExpandedAreas] = useState<Set<string>>(() => new Set());
  const [selectedGeo, setSelectedGeo] = useState<{ level: 'district' | 'area' | 'city'; district: string; area?: string; city?: string } | null>(null);

  const productById = useMemo(() => new Map(products.map(product => [product.id, product])), [products]);
  const allowedProductIds = useMemo(() => getFilteredProductIds(products, memberships, { cabinetFilter: cabinetId, categoryFilter: category, brandFilter: brandId, groupFilter: groupId, skuFilter: query }), [products, memberships, cabinetId, category, brandId, groupId, query]);
  const regions = useMemo(() => [...new Set(records.map(record => record.region))].sort(), [records]);
  const filtered = useMemo(() => records.filter(record => {
    if (start && record.date < start) return false;
    if (end && record.date > end) return false;
    if (region && record.region !== region) return false;
    return allowedProductIds.has(record.product_id);
  }), [records, productById, allowedProductIds, start, end, region]);
  const totals = useMemo(() => aggregate(filtered), [filtered]);
  const month = (end || start).slice(0, 7);
  const plan = getGeographyPlans().find(record => record.month === month);

  const chartData = useMemo(() => {
    const byDate = new Map<string, GeographyOrderRecord[]>();
    filtered.forEach(record => appendToMap(byDate, record.date, record));
    return [...byDate.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([date, rows]) => {
      const values = aggregate(rows);
      return { date: date.slice(5), value: metric === 'orders' ? values.total : metric === 'localOrders' ? values.local : metric === 'nonlocalOrders' ? values.nonlocal : metric === 'localShare' ? values.localShare : metric === 'deliveryHours' ? values.deliveryHours || 0 : values.stock };
    });
  }, [filtered, metric]);

  const regionRows = useMemo(() => regions.map(name => ({ region: name, ...aggregate(filtered.filter(record => record.region === name)) }))
    .filter(row => row.total > 0).sort((a, b) => b.nonlocal - a.nonlocal), [filtered, regions]);
  const financeLeaves = useMemo(() => {
    const dailyMetrics = getMetrics();
    const profitability = getProfitabilityRecords();
    const geographyTotals = new Map<string, number>();
    records.forEach(record => {
      const key = `${record.date}|${record.product_id}`;
      geographyTotals.set(key, (geographyTotals.get(key) || 0) + record.orders_total);
    });
    const amountByKey = new Map(dailyMetrics.map(record => [`${record.date}|${record.product_id}`, record.ordered_amount || 0]));
    const profitabilityByKey = new Map(profitability.map(record => [`${record.period_start}|${record.product_id}`, record]));
    const byLocation = new Map<string, Omit<FinanceGeoRow, 'profitability'>>();
    filtered.forEach(record => {
      const key = `${record.date}|${record.product_id}`;
      const denominator = geographyTotals.get(key) || 0;
      if (!denominator || !record.orders_total) return;
      const share = record.orders_total / denominator;
      const product = productById.get(record.product_id);
      const profitRecord = profitabilityByKey.get(key);
      const extraExpense = getCabinetExtraExpense(record.date.slice(0, 7), product?.cabinet_id || '');
      const locationKey = `${record.region}|${record.area || 'Без региона'}|${record.city || 'Без населённого пункта'}`;
      const current = byLocation.get(locationKey) || { region: record.region, area: record.area || 'Без региона', city: record.city || 'Без населённого пункта', orders: 0, orderedAmount: 0, netProfit: 0, profitRevenue: 0 };
      current.orders += record.orders_total;
      current.orderedAmount += (amountByKey.get(key) || 0) * share;
      if (profitRecord) {
        current.netProfit += getReportNetProfit(profitRecord, extraExpense) * share;
        current.profitRevenue += profitRecord.profit_revenue * share;
      }
      byLocation.set(locationKey, current);
    });
    return [...byLocation.values()].map(row => ({ ...row, profitability: row.profitRevenue ? row.netProfit / row.profitRevenue * 100 : 0 })).sort((left, right) => right.orderedAmount - left.orderedAmount);
  }, [filtered, records, productById]);
  const financeHierarchy = useMemo(() => {
    const districts = [...new Set(financeLeaves.map(row => row.region))].map(regionName => {
      const districtLeaves = financeLeaves.filter(row => row.region === regionName);
      const areas = [...new Set(districtLeaves.map(row => row.area))].map(areaName => {
        const areaLeaves = districtLeaves.filter(row => row.area === areaName);
        return { name: areaName, ...sumFinance(areaLeaves), cities: areaLeaves.map(row => ({ name: row.city, ...row })).sort((left, right) => right.orderedAmount - left.orderedAmount) };
      }).sort((left, right) => right.orderedAmount - left.orderedAmount);
      return { name: regionName, ...sumFinance(districtLeaves), areas };
    }).sort((left, right) => right.orderedAmount - left.orderedAmount);
    return districts;
  }, [financeLeaves]);
  const comparisonData = useMemo(() => {
    const funnelByKey = new Map(getMetrics().map(row => [`${row.date}|${row.product_id}`, row]));
    const allGeoTotals = new Map<string, number>();
    records.forEach(row => { const key = `${row.date}|${row.product_id}`; allGeoTotals.set(key, (allGeoTotals.get(key) || 0) + row.orders_total); });
    const byDate = new Map<string, GeographyOrderRecord[]>();
    filtered.forEach(record => appendToMap(byDate, record.date, record));
    return [...byDate.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([date, rows]) => {
      const delivery = aggregate(rows).deliveryHours || 0;
      const sums = rows.reduce((result, row) => {
        const key = `${row.date}|${row.product_id}`;
        const funnel = funnelByKey.get(key);
        const denominator = allGeoTotals.get(key) || 0;
        const share = denominator ? row.orders_total / denominator : 0;
        if (!funnel || !share) return result;
        result.orderedAmount += funnel.ordered_amount * share;
        result.impressions += funnel.impressions * share;
        result.clicks += funnel.clicks * share;
        result.carts += funnel.carts * share;
        result.orders += funnel.orders * share;
        return result;
      }, { orderedAmount: 0, impressions: 0, clicks: 0, carts: 0, orders: 0 });
      const rates = { ctr: sums.impressions ? sums.clicks / sums.impressions * 100 : 0, cartCr: sums.clicks ? sums.carts / sums.clicks * 100 : 0, impressionOrderCr: sums.impressions ? sums.orders / sums.impressions * 100 : 0 };
      return { date: date.slice(5), deliveryHours: delivery, comparison: comparisonMetric in sums ? sums[comparisonMetric as keyof typeof sums] : rates[comparisonMetric as keyof typeof rates] };
    });
  }, [filtered, records, comparisonMetric]);
  const topRegions = useMemo(() => financeHierarchy.slice(0, 7).map(row => ({ name: row.name, value: row.orderedAmount })), [financeHierarchy]);
  const topAreas = useMemo(() => {
    const byName = new Map<string, FinanceGeoRow[]>();
    financeLeaves.forEach(row => appendToMap(byName, row.area, row));
    return [...byName.entries()].map(([name, rows]) => ({ name, value: sumFinance(rows).orderedAmount })).sort((left, right) => right.value - left.value).slice(0, 5);
  }, [financeLeaves]);
  const topCities = useMemo(() => {
    const byName = new Map<string, FinanceGeoRow[]>();
    financeLeaves.forEach(row => appendToMap(byName, row.city, row));
    return [...byName.entries()].map(([name, rows]) => ({ name, value: sumFinance(rows).orderedAmount })).sort((left, right) => right.value - left.value).slice(0, 5);
  }, [financeLeaves]);
  const selectedGeoRecords = useMemo(() => selectedGeo ? filtered.filter(row => row.region === selectedGeo.district && (!selectedGeo.area || row.area === selectedGeo.area) && (!selectedGeo.city || row.city === selectedGeo.city)) : [], [filtered, selectedGeo]);
  const selectedGeoSummary = useMemo(() => aggregate(selectedGeoRecords), [selectedGeoRecords]);
  const selectedGeoFinance = useMemo(() => selectedGeo ? sumFinance(financeLeaves.filter(row => row.region === selectedGeo.district && (!selectedGeo.area || row.area === selectedGeo.area) && (!selectedGeo.city || row.city === selectedGeo.city))) : null, [financeLeaves, selectedGeo]);
  const selectedGeoProducts = useMemo(() => {
    const byProduct = new Map<string, GeographyOrderRecord[]>();
    selectedGeoRecords.forEach(row => appendToMap(byProduct, row.product_id, row));
    return [...byProduct.entries()].map(([productId, rows]) => ({ product: productById.get(productId), ...aggregate(rows) })).sort((left, right) => right.total - left.total);
  }, [selectedGeoRecords, productById]);
  const selectedGeoTrend = useMemo(() => {
    const byDate = new Map<string, GeographyOrderRecord[]>();
    selectedGeoRecords.forEach(row => appendToMap(byDate, row.date, row));
    return [...byDate.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([date, rows]) => { const values = aggregate(rows); return { date: date.slice(5), delivery: values.deliveryHours || 0, localShare: values.localShare }; });
  }, [selectedGeoRecords]);
  const potential = Math.min(totals.nonlocal, totals.stock);

  if (!records.length) return <section className="geo-page analytics-empty-page">
    <header className="geo-header"><div><span className="geo-eyebrow">АНАЛИТИКА</span><h1>География заказов</h1><p>Локальность, скорость доставки и потенциал распределения запасов.</p></div></header>
    <article className="analytics-empty-card"><span>ДАННЫЕ НЕ ЗАГРУЖЕНЫ</span><h2>География пока недоступна</h2><p>Импортируйте отчёт «География заказов», чтобы увидеть показатели по округам, регионам и населённым пунктам.</p></article>
  </section>;

  return <section className="geo-page">
    <header className="geo-header"><div><span className="geo-eyebrow">АНАЛИТИКА</span><h1>География заказов</h1><p>Локальность, скорость доставки и потенциал распределения запасов.</p></div></header>
    <div className="geo-toolbar table-toolbar entry-analytics-toolbar page-card"><div className="date-filters"><DateRangeFilter label="Период" value={{ start, end }} onChange={period => { setStart(period.start); setEnd(period.end); }} maxDate={dates.at(-1) || end} /></div><FilterBar cabinetFilter={cabinetId} categoryFilter={category} brandFilter={brandId} groupFilter={groupId} skuFilter={query} onCabinetChange={setCabinetId} onCategoryChange={setCategory} onBrandChange={setBrandId} onGroupChange={setGroupId} onSkuChange={setQuery} variant="dashboard" afterControls={<select className="entry-context-select" value={region} onChange={event => setRegion(event.target.value)}><option value="">Все регионы</option>{regions.map(item => <option key={item} value={item}>{item}</option>)}</select>} /></div>
    <div className="geo-kpis">
      <article className="geo-kpi"><span>Локальные заказы</span><strong>{formatNumber(totals.localShare)}%</strong><small>{formatNumber(totals.local)} из {formatNumber(totals.total)} шт · план {plan?.local_share_target ?? '—'}%</small></article>
      <article className="geo-kpi"><span>Среднее время доставки</span><strong>{formatHours(totals.deliveryHours)}</strong><small>Покрытие времени: {totals.total ? formatNumber(totals.coveredOrders / totals.total * 100) : 0}% · план {plan?.delivery_hours_target ? formatHours(plan.delivery_hours_target) : '—'}</small></article>
      <article className="geo-kpi"><span>Не локальные заказы</span><strong>{formatNumber(totals.nonlocal)}</strong><small>{formatNumber(totals.total ? totals.nonlocal / totals.total * 100 : 0)}% от всех заказов</small></article>
      <article className="geo-kpi geo-kpi-accent"><span>Потенциал локализации</span><strong>{formatNumber(potential)}</strong><small>Максимум не локальных заказов, который может покрыть доступный остаток</small></article>
    </div>
    <div className="geo-content-grid">
      <article className="geo-card geo-chart-card"><div className="geo-card-head"><div><h2>Динамика</h2><p>Метрика по дням выбранного среза</p></div><select value={metric} onChange={event => setMetric(event.target.value as ChartMetric)}>{Object.entries(metricLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></div>
        <div className="geo-chart"><ResponsiveContainer width="100%" height={290}><LineChart data={chartData}><CartesianGrid stroke="#E8EEF5" strokeDasharray="3 3" /><XAxis dataKey="date" tickLine={false} axisLine={false}/><YAxis tickLine={false} axisLine={false}/><Tooltip formatter={value => formatNumber(Number(value || 0))} /><Line dataKey="value" stroke="#60A5FA" strokeWidth={2.5} dot={false} /></LineChart></ResponsiveContainer></div>
      </article>
      <article className="geo-card geo-plan-card"><h2>План месяца</h2><p>{month || 'Выберите период, чтобы задать целевые показатели.'}</p><label>% локальных заказов<input type="number" min="0" max="100" value={plan?.local_share_target ?? ''} onChange={event => upsertGeographyPlan(month, event.target.value === '' ? null : Number(event.target.value), plan?.delivery_hours_target ?? null)} /></label><label>Среднее время, ч<input type="number" min="0" value={plan?.delivery_hours_target ?? ''} onChange={event => upsertGeographyPlan(month, plan?.local_share_target ?? null, event.target.value === '' ? null : Number(event.target.value))} /></label><small>Цели сохраняются отдельно для каждого месяца.</small></article>
    </div>
    <article className="geo-card geo-table-card"><div className="geo-card-head"><div><h2>Регионы</h2><p>Отсортировано по объёму не локальных заказов.</p></div></div><div className="geo-table-wrap"><table className="geo-table"><thead><tr><th>Регион</th><th>Заказы</th><th>Локально</th><th>Ср. доставка</th><th>Покрытие СВД</th><th>Не локально</th><th>Остатки</th><th>Потенциал</th></tr></thead><tbody>{regionRows.map(row => <tr key={row.region} className="geo-clickable-row" onClick={() => setSelectedGeo({ level: 'district', district: row.region })}><td>{row.region}</td><td>{formatNumber(row.total)}</td><td>{formatNumber(row.localShare)}%</td><td>{formatHours(row.deliveryHours)}</td><td>{formatNumber(row.total ? row.coveredOrders / row.total * 100 : 0)}%</td><td>{formatNumber(row.nonlocal)}</td><td>{formatNumber(row.stock)}</td><td>{formatNumber(Math.min(row.nonlocal, row.stock))}</td></tr>)}</tbody></table></div></article>
    <div className="geo-finance-grid"><article className="geo-card geo-finance-card"><div className="geo-card-head"><div><h2>Финансовые метрики по географии</h2><p>ФО → регион → населённый пункт.</p></div></div><div className="geo-table-wrap"><table className="geo-table geo-finance-table geo-hierarchy-table"><thead><tr><th>География</th><th>Сумма заказов</th><th>Чистая прибыль</th><th>Рентабельность</th></tr></thead><tbody>{financeHierarchy.map(district => <Fragment key={district.name}><tr className="geo-level-district" onClick={() => { setSelectedGeo({ level: 'district', district: district.name }); setExpandedRegions(current => { const next = new Set(current); if (next.has(district.name)) next.delete(district.name); else next.add(district.name); return next; }); }}><td><button type="button">{expandedRegions.has(district.name) ? '−' : '+'}</button><strong>{district.name}</strong></td><td>{formatNumber(district.orderedAmount)} ₽</td><td className={district.netProfit >= 0 ? 'geo-positive' : 'geo-negative'}>{formatNumber(district.netProfit)} ₽</td><td className={district.profitability >= 0 ? 'geo-positive' : 'geo-negative'}>{formatNumber(district.profitability)}%</td></tr>{expandedRegions.has(district.name) && district.areas.map(area => { const areaKey = `${district.name}|${area.name}`; return <Fragment key={areaKey}><tr className="geo-level-area" onClick={() => { setSelectedGeo({ level: 'area', district: district.name, area: area.name }); setExpandedAreas(current => { const next = new Set(current); if (next.has(areaKey)) next.delete(areaKey); else next.add(areaKey); return next; }); }}><td><button type="button">{expandedAreas.has(areaKey) ? '−' : '+'}</button><span>{area.name}</span></td><td>{formatNumber(area.orderedAmount)} ₽</td><td className={area.netProfit >= 0 ? 'geo-positive' : 'geo-negative'}>{formatNumber(area.netProfit)} ₽</td><td className={area.profitability >= 0 ? 'geo-positive' : 'geo-negative'}>{formatNumber(area.profitability)}%</td></tr>{expandedAreas.has(areaKey) && area.cities.map(city => <tr className="geo-level-city" key={`${areaKey}|${city.name}`} onClick={() => setSelectedGeo({ level: 'city', district: district.name, area: area.name, city: city.name })}><td><span>{city.name}</span></td><td>{formatNumber(city.orderedAmount)} ₽</td><td className={city.netProfit >= 0 ? 'geo-positive' : 'geo-negative'}>{formatNumber(city.netProfit)} ₽</td><td className={city.profitability >= 0 ? 'geo-positive' : 'geo-negative'}>{formatNumber(city.profitability)}%</td></tr>)}</Fragment>; })}</Fragment>)}</tbody></table></div></article><article className="geo-card geo-region-pie"><div className="geo-card-head"><div><h2>Top-7 федеральных округов</h2><p>Доля в сумме заказов выбранного среза.</p></div></div><ResponsiveContainer width="100%" height={300}><PieChart><Pie data={topRegions} dataKey="value" nameKey="name" innerRadius={62} outerRadius={102} paddingAngle={2}>{topRegions.map((item, index) => <Cell key={item.name} fill={regionColors[index % regionColors.length]} />)}</Pie><Tooltip formatter={value => [`${formatNumber(Number(value || 0))} ₽`, 'Сумма заказов']} /><Legend layout="vertical" align="right" verticalAlign="middle" formatter={value => String(value).length > 24 ? `${String(value).slice(0, 22)}…` : value} /></PieChart></ResponsiveContainer></article></div>
    <article className="geo-card geo-comparison-card"><div className="geo-card-head"><div><h2>Скорость доставки и воронка</h2><p>Среднее время доставки и выбранная метрика воронки по дням.</p></div><label>Сравнить с<select value={comparisonMetric} onChange={event => setComparisonMetric(event.target.value as FunnelMetric)}>{Object.entries(funnelMetricLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label></div><div className="geo-chart geo-comparison-chart"><ResponsiveContainer width="100%" height={330}><LineChart data={comparisonData} margin={{ top: 14, right: 18, left: 6, bottom: 4 }}><CartesianGrid stroke="#E8EEF5" strokeDasharray="3 3" /><XAxis dataKey="date" tickLine={false} axisLine={false} /><YAxis yAxisId="delivery" tickLine={false} axisLine={false} tickFormatter={value => `${formatNumber(Number(value))}ч`} /><YAxis yAxisId="metric" orientation="right" tickLine={false} axisLine={false} /><Tooltip formatter={(value, name) => name === 'deliveryHours' ? [`${formatNumber(Number(value || 0))} ч`, 'Среднее время доставки'] : [formatNumber(Number(value || 0)), funnelMetricLabels[comparisonMetric]]} /><Line yAxisId="delivery" type="monotone" dataKey="deliveryHours" name="deliveryHours" stroke="#60A5FA" strokeWidth={2.6} dot={false} /><Line yAxisId="metric" type="monotone" dataKey="comparison" name="comparison" stroke="#34D399" strokeWidth={2.4} dot={false} /></LineChart></ResponsiveContainer></div></article>
    <div className="geo-bottom-rankings"><article className="geo-card geo-region-pie"><div className="geo-card-head"><div><h2>Top-5 регионов</h2><p>По сумме заказов.</p></div></div><ResponsiveContainer width="100%" height={300}><PieChart><Pie data={topAreas} dataKey="value" nameKey="name" innerRadius={58} outerRadius={100} paddingAngle={2}>{topAreas.map((item, index) => <Cell key={item.name} fill={regionColors[index % regionColors.length]} />)}</Pie><Tooltip formatter={value => [`${formatNumber(Number(value || 0))} ₽`, 'Сумма заказов']} /><Legend layout="vertical" align="right" verticalAlign="middle" /></PieChart></ResponsiveContainer></article><article className="geo-card geo-region-pie"><div className="geo-card-head"><div><h2>Top-5 населённых пунктов</h2><p>По сумме заказов.</p></div></div><ResponsiveContainer width="100%" height={300}><PieChart><Pie data={topCities} dataKey="value" nameKey="name" innerRadius={58} outerRadius={100} paddingAngle={2}>{topCities.map((item, index) => <Cell key={item.name} fill={regionColors[index % regionColors.length]} />)}</Pie><Tooltip formatter={value => [`${formatNumber(Number(value || 0))} ₽`, 'Сумма заказов']} /><Legend layout="vertical" align="right" verticalAlign="middle" /></PieChart></ResponsiveContainer></article></div>
    {selectedGeo && <><button type="button" className="geo-drawer-backdrop" aria-label="Закрыть карточку географии" onClick={() => setSelectedGeo(null)} /><aside className="geo-detail-drawer"><header><div><span>{selectedGeo.level === 'district' ? 'ФЕДЕРАЛЬНЫЙ ОКРУГ' : selectedGeo.level === 'area' ? 'РЕГИОН' : 'НАСЕЛЁННЫЙ ПУНКТ'}</span><h2>{selectedGeo.city || selectedGeo.area || selectedGeo.district}</h2><p>{[selectedGeo.district, selectedGeo.area, selectedGeo.city].filter(Boolean).join(' → ')}</p></div><button type="button" onClick={() => setSelectedGeo(null)}>×</button></header><div className="geo-drawer-kpis"><article><span>Заказы</span><strong>{formatNumber(selectedGeoSummary.total)}</strong></article><article><span>Локальность</span><strong>{formatNumber(selectedGeoSummary.localShare)}%</strong></article><article><span>СВД</span><strong>{formatHours(selectedGeoSummary.deliveryHours)}</strong></article><article><span>Сумма заказов</span><strong>{formatNumber(selectedGeoFinance?.orderedAmount || 0)} ₽</strong></article><article><span>Чистая прибыль</span><strong>{formatNumber(selectedGeoFinance?.netProfit || 0)} ₽</strong></article><article><span>Рентабельность</span><strong>{formatNumber(selectedGeoFinance?.profitability || 0)}%</strong></article></div><section className="geo-drawer-section"><h3>Динамика</h3><ResponsiveContainer width="100%" height={190}><LineChart data={selectedGeoTrend}><CartesianGrid stroke="#e8eef5" strokeDasharray="3 3" /><XAxis dataKey="date" tick={{ fontSize: 9 }} /><YAxis yAxisId="delivery" tick={{ fontSize: 9 }} /><YAxis yAxisId="local" orientation="right" tick={{ fontSize: 9 }} /><Tooltip /><Line yAxisId="delivery" dataKey="delivery" stroke="#60A5FA" strokeWidth={2.2} dot={false} /><Line yAxisId="local" dataKey="localShare" stroke="#34D399" strokeWidth={2.2} dot={false} /></LineChart></ResponsiveContainer></section><section className="geo-drawer-section"><h3>Лидирующие товары</h3><div className="geo-drawer-products">{selectedGeoProducts.slice(0, 5).map(row => <div key={row.product?.id}><strong>{row.product?.sku || 'Без артикула'}</strong><span>{row.product?.name || 'Без названия'}</span><b>{formatNumber(row.total)} заказов</b></div>)}</div></section><section className="geo-drawer-section"><h3>Проблемные SKU</h3><div className="geo-drawer-products">{[...selectedGeoProducts].sort((left, right) => right.nonlocal - left.nonlocal || (right.deliveryHours || 0) - (left.deliveryHours || 0)).slice(0, 5).map(row => <div key={row.product?.id}><strong>{row.product?.sku || 'Без артикула'}</strong><span>{formatNumber(row.nonlocal)} нелок. · {formatHours(row.deliveryHours)}</span><b>{formatNumber(row.localShare)}% лок.</b></div>)}</div></section></aside></>}
  </section>;
}
