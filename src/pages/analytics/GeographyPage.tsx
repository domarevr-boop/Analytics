import { Fragment, useMemo, useState, useSyncExternalStore } from 'react';
import { CartesianGrid, Cell, Legend, Line, LineChart, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import DateRangeFilter from '../../components/DateRangeFilter';
import FilterBar from '../../components/FilterBar';
import { getGeographyOrders, getMemberships, getMetrics, getProducts, getProfitabilityRecords, getVersion, subscribe } from '../../data/store';
import { getFilteredProductIds } from '../../data/productFilters';
import { getCabinetExtraExpense } from '../../data/profitStore';
import { getReportNetProfit } from '../../data/profitabilityCalculations';
import { appendToMap } from '../../data/collectionUtils';
import { orderShare } from './geographyCalculations';
import { hasKnownGeoArea, hasKnownGeoCity, normalizeGeoArea, normalizeGeoCity, selectDetailedGeographyRows } from '../../data/geographyHierarchy';
import type { GeographyOrderRecord } from '../../types';

type ChartMetric = 'orders' | 'localOrders' | 'nonlocalOrders' | 'localShare' | 'deliveryHours' | 'stock';
type FunnelMetric = 'orderedAmount' | 'impressions' | 'clicks' | 'carts' | 'orders' | 'ctr' | 'cartCr' | 'impressionOrderCr';
type DetailSort = 'orders' | 'orderedAmount' | 'share' | 'localShare' | 'deliveryHours';
type DetailMetricRow = { orders: number; orderedAmount: number; share: number; localShare: number; deliveryHours: number | null };
const DETAIL_PAGE_SIZE = 8;

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

function detailSortValue(row: DetailMetricRow, sort: DetailSort) {
  if (sort === 'orders') return row.orders;
  if (sort === 'orderedAmount') return row.orderedAmount;
  if (sort === 'share') return row.share;
  if (sort === 'localShare') return row.localShare;
  return row.deliveryHours ?? Number.NEGATIVE_INFINITY;
}

function formatNumber(value: number) { return new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 1 }).format(value); }
function formatHours(hours: number | null) {
  if (hours === null) return '—';
  const days = Math.floor(hours / 24);
  const rest = Math.round(hours % 24);
  return days > 0 ? `${days}д ${rest}ч` : `${rest}ч`;
}

function parseDate(value: string) { return new Date(`${value}T00:00:00Z`); }
function isoDate(value: Date) { return value.toISOString().slice(0, 10); }
function shiftDate(value: string, days: number) { const date = parseDate(value); date.setUTCDate(date.getUTCDate() + days); return isoDate(date); }
function previousPeriod(start: string, end: string) {
  if (!start || !end) return { start: '', end: '' };
  const days = Math.round((parseDate(end).getTime() - parseDate(start).getTime()) / 86_400_000) + 1;
  const previousEnd = shiftDate(start, -1);
  return { start: shiftDate(previousEnd, -(days - 1)), end: previousEnd };
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
  const geographyRecords = getGeographyOrders();
  const records = useMemo(() => selectDetailedGeographyRows(geographyRecords), [geographyRecords]);
  const products = getProducts();
  const memberships = getMemberships();
  const dates = records.map(record => record.date).sort();
  const [start, setStart] = useState(() => dates[0] || '');
  const [end, setEnd] = useState(() => dates[dates.length - 1] || '');
  const [region, setRegion] = useState('');
  const [area, setArea] = useState('');
  const [city, setCity] = useState('');
  const [cabinetId, setCabinetId] = useState('');
  const [category, setCategory] = useState('');
  const [brandId, setBrandId] = useState('');
  const [groupId, setGroupId] = useState('');
  const [query, setQuery] = useState('');
  const [metric, setMetric] = useState<ChartMetric>('orders');
  const [granularity, setGranularity] = useState<'day' | 'week'>('day');
  const [showAllRegions, setShowAllRegions] = useState(false);
  const [comparisonMetric, setComparisonMetric] = useState<FunnelMetric>('orderedAmount');
  const [expandedRegions, setExpandedRegions] = useState<Set<string>>(() => new Set());
  const [expandedAreas, setExpandedAreas] = useState<Set<string>>(() => new Set());
  const [expandedDetailAreas, setExpandedDetailAreas] = useState<Set<string>>(() => new Set());
  const [detailSort, setDetailSort] = useState<DetailSort>('orders');
  const [detailPage, setDetailPage] = useState(0);
  const [selectedGeo, setSelectedGeo] = useState<{ level: 'district' | 'area' | 'city'; district: string; area?: string; city?: string } | null>(null);

  const productById = useMemo(() => new Map(products.map(product => [product.id, product])), [products]);
  const allowedProductIds = useMemo(() => getFilteredProductIds(products, memberships, { cabinetFilter: cabinetId, categoryFilter: category, brandFilter: brandId, groupFilter: groupId, skuFilter: query }), [products, memberships, cabinetId, category, brandId, groupId, query]);
  const baseFiltered = useMemo(() => records.filter(record => {
    if (start && record.date < start) return false;
    if (end && record.date > end) return false;
    return allowedProductIds.has(record.product_id);
  }), [records, allowedProductIds, start, end]);
  const regions = useMemo(() => [...new Set(baseFiltered.map(record => record.region))].sort(), [baseFiltered]);
  const areas = useMemo(() => [...new Set(baseFiltered.filter(record => (!region || record.region === region) && hasKnownGeoArea(record.area)).map(record => normalizeGeoArea(record.area)))].sort(), [baseFiltered, region]);
  const cities = useMemo(() => [...new Set(baseFiltered.filter(record => (!region || record.region === region) && (!area || normalizeGeoArea(record.area) === area) && hasKnownGeoCity(record.city)).map(record => normalizeGeoCity(record.city)))].sort(), [baseFiltered, region, area]);
  const filtered = useMemo(() => baseFiltered.filter(record => {
    if (region && record.region !== region) return false;
    if (area && record.area !== area) return false;
    if (city && record.city !== city) return false;
    return true;
  }), [baseFiltered, region, area, city]);
  const baseTotals = useMemo(() => aggregate(baseFiltered), [baseFiltered]);
  const totals = useMemo(() => aggregate(filtered), [filtered]);
  const comparisonPeriod = useMemo(() => previousPeriod(start, end), [start, end]);
  const previousFiltered = useMemo(() => records.filter(record => {
    if (comparisonPeriod.start && record.date < comparisonPeriod.start) return false;
    if (comparisonPeriod.end && record.date > comparisonPeriod.end) return false;
    if (region && record.region !== region) return false;
    if (area && record.area !== area) return false;
    if (city && record.city !== city) return false;
    return allowedProductIds.has(record.product_id);
  }), [records, allowedProductIds, comparisonPeriod, region, area, city]);
  const previousTotals = useMemo(() => aggregate(previousFiltered), [previousFiltered]);

  const chartData = useMemo(() => {
    const byDate = new Map<string, GeographyOrderRecord[]>();
    filtered.forEach(record => {
      const bucket = granularity === 'day' || !start ? record.date : shiftDate(start, Math.floor((parseDate(record.date).getTime() - parseDate(start).getTime()) / 86_400_000 / 7) * 7);
      appendToMap(byDate, bucket, record);
    });
    return [...byDate.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([date, rows]) => {
      const values = aggregate(rows);
      return { date: date.slice(5), orders: values.total, localOrders: values.local, value: metric === 'orders' ? values.total : metric === 'localOrders' ? values.local : metric === 'nonlocalOrders' ? values.nonlocal : metric === 'localShare' ? values.localShare : metric === 'deliveryHours' ? values.deliveryHours || 0 : values.stock };
    });
  }, [filtered, metric, granularity, start]);

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
      const normalizedArea = normalizeGeoArea(record.area);
      const normalizedCity = normalizeGeoCity(record.city);
      const locationKey = `${record.region}|${normalizedArea}|${normalizedCity}`;
      const current = byLocation.get(locationKey) || { region: record.region, area: normalizedArea, city: normalizedCity, orders: 0, orderedAmount: 0, netProfit: 0, profitRevenue: 0 };
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
  const detailAreas = useMemo(() => {
    const recordsByArea = new Map<string, { district: string; area: string; rows: GeographyOrderRecord[] }>();
    const financeByArea = new Map<string, FinanceGeoRow[]>();
    const financeByCity = new Map<string, FinanceGeoRow[]>();
    filtered.filter(record => hasKnownGeoArea(record.area)).forEach(record => {
      const normalizedArea = normalizeGeoArea(record.area);
      const key = `${record.region}|${normalizedArea}`;
      const entry = recordsByArea.get(key) || { district: record.region, area: normalizedArea, rows: [] };
      entry.rows.push(record);
      recordsByArea.set(key, entry);
    });
    financeLeaves.forEach(row => {
      appendToMap(financeByArea, `${row.region}|${row.area}`, row);
      appendToMap(financeByCity, `${row.region}|${row.area}|${row.city}`, row);
    });
    const rows = [...recordsByArea.entries()].map(([areaKey, entry]) => {
      const summary = aggregate(entry.rows);
      const finance = sumFinance(financeByArea.get(areaKey) || []);
      const recordsByCity = new Map<string, GeographyOrderRecord[]>();
      entry.rows.filter(record => hasKnownGeoCity(record.city)).forEach(record => appendToMap(recordsByCity, normalizeGeoCity(record.city), record));
      const citiesForArea = [...recordsByCity.entries()].map(([cityName, cityRecords]) => {
        const citySummary = aggregate(cityRecords);
        const cityFinance = sumFinance(financeByCity.get(`${areaKey}|${cityName}`) || []);
        return { name: cityName, orders: citySummary.total, localShare: citySummary.localShare, deliveryHours: citySummary.deliveryHours, orderedAmount: cityFinance.orderedAmount, profitability: cityFinance.profitability, share: orderShare(citySummary.total, baseTotals.total) };
      }).sort((left, right) => detailSortValue(right, detailSort) - detailSortValue(left, detailSort));
      return { key: areaKey, district: entry.district, name: entry.area, orders: summary.total, localShare: summary.localShare, deliveryHours: summary.deliveryHours, orderedAmount: finance.orderedAmount, profitability: finance.profitability, share: orderShare(summary.total, baseTotals.total), cities: citiesForArea };
    });
    return rows.sort((left, right) => detailSortValue(right, detailSort) - detailSortValue(left, detailSort));
  }, [filtered, financeLeaves, baseTotals.total, detailSort]);
  const detailPageCount = Math.max(1, Math.ceil(detailAreas.length / DETAIL_PAGE_SIZE));
  const currentDetailPage = Math.min(detailPage, detailPageCount - 1);
  const visibleDetailAreas = detailAreas.slice(currentDetailPage * DETAIL_PAGE_SIZE, (currentDetailPage + 1) * DETAIL_PAGE_SIZE);
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
  const visibleRegionRows = showAllRegions ? regionRows : regionRows.slice(0, 8);
  const filteredProductCount = new Set(filtered.map(record => record.product_id)).size;
  const deliveryDelta = totals.deliveryHours !== null && previousTotals.deliveryHours !== null ? totals.deliveryHours - previousTotals.deliveryHours : 0;
  const growthRegion = regionRows[0];
  const totalRegionAmount = topRegions.reduce((sum, item) => sum + item.value, 0);

  if (!records.length) return <section className="geo-page analytics-empty-page">
    <header className="geo-header"><div><span className="geo-eyebrow">АНАЛИТИКА</span><h1>География заказов</h1><p>Локальность, скорость доставки и потенциал распределения запасов.</p></div></header>
    <article className="analytics-empty-card"><span>ДАННЫЕ НЕ ЗАГРУЖЕНЫ</span><h2>География пока недоступна</h2><p>Импортируйте отчёт «География заказов», чтобы увидеть показатели по округам, регионам и населённым пунктам.</p></article>
  </section>;

  return <section className="geo-page geo-page-v2">
    <header className="geo-header"><div><span className="geo-eyebrow">АНАЛИТИКА</span><h1>География заказов</h1><p>Локальность, скорость доставки и потенциал распределения запасов.</p></div><small>Найдено товаров: <b>{formatNumber(filteredProductCount)}</b></small></header>
    <div className="geo-toolbar table-toolbar entry-analytics-toolbar page-card"><div className="date-filters"><DateRangeFilter label="Период" value={{ start, end }} onChange={period => { setStart(period.start); setEnd(period.end); setDetailPage(0); }} maxDate={dates.at(-1) || end} /></div><FilterBar cabinetFilter={cabinetId} categoryFilter={category} brandFilter={brandId} groupFilter={groupId} skuFilter={query} onCabinetChange={setCabinetId} onCategoryChange={setCategory} onBrandChange={setBrandId} onGroupChange={setGroupId} onSkuChange={setQuery} variant="dashboard" afterControls={<div className="geo-location-filters"><select className="entry-context-select" aria-label="Федеральный округ" value={region} onChange={event => { setRegion(event.target.value); setArea(''); setCity(''); setDetailPage(0); }}><option value="">Все ФО</option>{regions.map(item => <option key={item} value={item}>{item}</option>)}</select><select className="entry-context-select" aria-label="Регион" value={area} onChange={event => { setArea(event.target.value); setCity(''); setDetailPage(0); }}><option value="">Все регионы</option>{areas.map(item => <option key={item} value={item}>{item}</option>)}</select><select className="entry-context-select" aria-label="Населённый пункт" value={city} onChange={event => { setCity(event.target.value); setDetailPage(0); }}><option value="">Все города</option>{cities.map(item => <option key={item} value={item}>{item}</option>)}</select></div>} /></div>
    <div className="geo-kpis">
      <article className="geo-kpi"><span>Локальные заказы</span><strong>{formatNumber(totals.localShare)}%</strong><small className={totals.localShare >= previousTotals.localShare ? 'geo-positive' : 'geo-negative'}>{previousTotals.total ? `${totals.localShare >= previousTotals.localShare ? '+' : ''}${formatNumber(totals.localShare - previousTotals.localShare)} п.п. к прошлому периоду` : 'Нет прошлого периода'}</small><i><b style={{ width: `${Math.min(100, totals.localShare)}%` }} /></i><small>{formatNumber(totals.local)} из {formatNumber(totals.total)} шт.</small></article>
      <article className="geo-kpi"><span>Среднее время доставки</span><strong>{formatHours(totals.deliveryHours)}</strong><small className={deliveryDelta <= 0 ? 'geo-positive' : 'geo-negative'}>{previousTotals.deliveryHours === null ? 'Нет прошлого периода' : `${deliveryDelta > 0 ? '+' : ''}${formatNumber(deliveryDelta)} ч к прошлому периоду`}</small><small>Покрытие временем: {totals.total ? formatNumber(totals.coveredOrders / totals.total * 100) : 0}%</small></article>
      <article className="geo-kpi"><span>Не локальные заказы</span><strong>{formatNumber(totals.nonlocal)}</strong><small>{formatNumber(totals.total ? totals.nonlocal / totals.total * 100 : 0)}% от всех заказов</small></article>
      <article className="geo-kpi"><span>Потенциал локализации</span><strong>{formatNumber(potential)}</strong><small>Максимум не локальных заказов, который может покрыть доступный остаток</small></article>
    </div>
    <div className="geo-content-grid">
      <article className="geo-card geo-insights-card"><div className="geo-card-head"><div><h2>Главные выводы</h2></div></div><div className="geo-insights"><div><i>◉</i><p><b>Локальность текущего среза</b><span>{formatNumber(totals.localShare)}% локальных заказов</span></p></div><div><i>◷</i><p><b>Среднее время доставки {deliveryDelta <= 0 ? 'снизилось' : 'выросло'}</b><span>{deliveryDelta > 0 ? '+' : ''}{formatNumber(deliveryDelta)} ч к прошлому периоду</span></p></div><div><i>⇄</i><p><b>Потенциал локализации</b><span>{formatNumber(potential)} заказов можно перевести в локальные</span></p></div><div><i>⌂</i><p><b>ФО роста</b><span>{growthRegion?.region || 'Нет данных'} имеет наибольший потенциал</span></p></div></div></article>
      <article className="geo-card geo-chart-card"><div className="geo-card-head"><div><h2>Динамика по дням</h2><p>Показатели выбранного географического среза</p></div><div className="geo-chart-controls"><select value={metric} onChange={event => setMetric(event.target.value as ChartMetric)}>{Object.entries(metricLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select><div className="geo-segmented"><button className={granularity === 'day' ? 'active' : ''} onClick={() => setGranularity('day')}>День</button><button className={granularity === 'week' ? 'active' : ''} onClick={() => setGranularity('week')}>Неделя</button></div></div></div>
        <div className="geo-chart"><ResponsiveContainer width="100%" height={290}><LineChart data={chartData}><CartesianGrid stroke="#E8EEF5" strokeDasharray="3 3" /><XAxis dataKey="date" tickLine={false} axisLine={false} minTickGap={28} interval="preserveStartEnd"/><YAxis tickLine={false} axisLine={false}/><Tooltip formatter={value => formatNumber(Number(value || 0))} /><Legend />{metric === 'orders' ? <><Line dataKey="localOrders" name="Локальные заказы" stroke="#10B981" strokeWidth={2.4} dot={false} /><Line dataKey="orders" name="Все заказы" stroke="#3B82F6" strokeWidth={2.4} dot={false} /></> : <Line dataKey="value" name={metricLabels[metric]} stroke="#3B82F6" strokeWidth={2.5} dot={false} />}</LineChart></ResponsiveContainer></div>
      </article>
    </div>
    <div className="geo-locality-grid">
      <article className="geo-card geo-map-card"><div className="geo-card-head"><div><h2>Локальность по федеральным округам</h2><p>Top-9 по доле локальных заказов; полная детализация доступна ниже.</p></div></div><div className="geo-map-stage">{regionRows.slice(0, 9).map((row, index) => <button type="button" key={row.region} title={row.region} style={{ '--geo-strength': Math.max(.1, row.localShare / 100), '--geo-order': index } as React.CSSProperties} onClick={() => setSelectedGeo({ level: 'district', district: row.region })}><span>{row.region}</span><b>{formatNumber(row.localShare)}%</b></button>)}</div><div className="geo-map-legend"><span><i className="high" />&gt; 50%</span><span><i className="medium" />30–50%</span><span><i className="low" />10–30%</span><span><i className="zero" />&lt; 10%</span></div></article>
    </div>
    <article className="geo-card geo-table-card"><div className="geo-card-head"><div><h2>Регионы</h2><p>Отсортировано по доле не локальных заказов.</p></div></div><div className="geo-table-wrap"><table className="geo-table geo-regions-table"><thead><tr><th>Регион</th><th>Заказы, шт</th><th>Локальность</th><th>Ср. время доставки</th><th>Покрытие СВД</th><th>Не локально</th><th>Потенциал</th></tr></thead><tbody>{visibleRegionRows.map(row => <tr key={row.region} className="geo-clickable-row" onClick={() => setSelectedGeo({ level: 'district', district: row.region })}><td>{row.region}</td><td>{formatNumber(row.total)}</td><td><div className="geo-locality-cell"><span>{formatNumber(row.localShare)}%</span><i><b style={{ width: `${Math.min(100, row.localShare)}%` }} /></i></div></td><td>{formatHours(row.deliveryHours)}</td><td>{formatNumber(row.total ? row.coveredOrders / row.total * 100 : 0)}%</td><td>{formatNumber(row.nonlocal)}</td><td>{formatNumber(Math.min(row.nonlocal, row.stock))}</td></tr>)}</tbody></table></div>{regionRows.length > 8 && <button type="button" className="geo-show-all" onClick={() => setShowAllRegions(value => !value)}>{showAllRegions ? 'Скрыть часть регионов' : 'Показать все регионы'}</button>}</article>
    <div className="geo-finance-grid">
      <article className="geo-card geo-finance-card"><div className="geo-card-head"><div><h2>Финансовые метрики по географии</h2><p>ФО → регион → населённый пункт.</p></div></div><div className="geo-table-wrap"><table className="geo-table geo-finance-table geo-hierarchy-table"><thead><tr><th>География</th><th>Доля в заказах</th><th>Сумма заказов</th><th>Чистая прибыль</th><th>Рентабельность</th></tr></thead><tbody>{financeHierarchy.map(district => <Fragment key={district.name}><tr className="geo-level-district" onClick={() => { setSelectedGeo({ level: 'district', district: district.name }); setExpandedRegions(current => { const next = new Set(current); if (next.has(district.name)) next.delete(district.name); else next.add(district.name); return next; }); }}><td><button type="button">{expandedRegions.has(district.name) ? '−' : '+'}</button><strong>{district.name}</strong></td><td>{formatNumber(orderShare(district.orders, baseTotals.total))}%</td><td>{formatNumber(district.orderedAmount)} ₽</td><td className={district.netProfit >= 0 ? 'geo-positive' : 'geo-negative'}>{formatNumber(district.netProfit)} ₽</td><td className={district.profitability >= 0 ? 'geo-positive' : 'geo-negative'}>{formatNumber(district.profitability)}%</td></tr>{expandedRegions.has(district.name) && district.areas.map(areaRow => { const areaKey = `${district.name}|${areaRow.name}`; return <Fragment key={areaKey}><tr className="geo-level-area" onClick={() => { setSelectedGeo({ level: 'area', district: district.name, area: areaRow.name }); setExpandedAreas(current => { const next = new Set(current); if (next.has(areaKey)) next.delete(areaKey); else next.add(areaKey); return next; }); }}><td><button type="button">{expandedAreas.has(areaKey) ? '−' : '+'}</button><span>{areaRow.name}</span></td><td>{formatNumber(orderShare(areaRow.orders, baseTotals.total))}%</td><td>{formatNumber(areaRow.orderedAmount)} ₽</td><td className={areaRow.netProfit >= 0 ? 'geo-positive' : 'geo-negative'}>{formatNumber(areaRow.netProfit)} ₽</td><td className={areaRow.profitability >= 0 ? 'geo-positive' : 'geo-negative'}>{formatNumber(areaRow.profitability)}%</td></tr>{expandedAreas.has(areaKey) && areaRow.cities.map(cityRow => <tr className="geo-level-city" key={`${areaKey}|${cityRow.name}`} onClick={() => setSelectedGeo({ level: 'city', district: district.name, area: areaRow.name, city: cityRow.name })}><td><span>{cityRow.name}</span></td><td>{formatNumber(orderShare(cityRow.orders, baseTotals.total))}%</td><td>{formatNumber(cityRow.orderedAmount)} ₽</td><td className={cityRow.netProfit >= 0 ? 'geo-positive' : 'geo-negative'}>{formatNumber(cityRow.netProfit)} ₽</td><td className={cityRow.profitability >= 0 ? 'geo-positive' : 'geo-negative'}>{formatNumber(cityRow.profitability)}%</td></tr>)}</Fragment>; })}</Fragment>)}</tbody></table></div></article>
      <article className="geo-card geo-district-bars"><div className="geo-card-head"><div><h2>Top-7 федеральных округов</h2><p>Доля в сумме заказов</p></div></div><div className="geo-ranking-bars">{topRegions.map((item, index) => <div key={item.name} title={item.name}><span>{item.name}</span><i><b style={{ width: `${totalRegionAmount ? item.value / totalRegionAmount * 100 : 0}%`, background: regionColors[index % regionColors.length] }} /></i><strong>{formatNumber(totalRegionAmount ? item.value / totalRegionAmount * 100 : 0)}%</strong></div>)}</div></article>
    </div>
    <article className="geo-card geo-comparison-card"><div className="geo-card-head"><div><h2>Скорость доставки и воронка</h2><p>Среднее время доставки и выбранная метрика воронки по дням.</p></div><label>Сравнить с<select value={comparisonMetric} onChange={event => setComparisonMetric(event.target.value as FunnelMetric)}>{Object.entries(funnelMetricLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label></div><div className="geo-chart geo-comparison-chart"><ResponsiveContainer width="100%" height={330}><LineChart data={comparisonData} margin={{ top: 14, right: 18, left: 6, bottom: 4 }}><CartesianGrid stroke="#E8EEF5" strokeDasharray="3 3" /><XAxis dataKey="date" tickLine={false} axisLine={false} /><YAxis yAxisId="delivery" tickLine={false} axisLine={false} tickFormatter={value => `${formatNumber(Number(value))}ч`} /><YAxis yAxisId="metric" orientation="right" tickLine={false} axisLine={false} /><Tooltip formatter={(value, name) => name === 'deliveryHours' ? [`${formatNumber(Number(value || 0))} ч`, 'Среднее время доставки'] : [formatNumber(Number(value || 0)), funnelMetricLabels[comparisonMetric]]} /><Line yAxisId="delivery" type="monotone" dataKey="deliveryHours" name="deliveryHours" stroke="#60A5FA" strokeWidth={2.6} dot={false} /><Line yAxisId="metric" type="monotone" dataKey="comparison" name="comparison" stroke="#34D399" strokeWidth={2.4} dot={false} /></LineChart></ResponsiveContainer></div></article>
    <div className="geo-bottom-rankings"><article className="geo-card geo-region-pie"><div className="geo-card-head"><div><h2>Top-5 регионов</h2><p>По сумме заказов.</p></div></div><ResponsiveContainer width="100%" height={300}><PieChart><Pie data={topAreas} dataKey="value" nameKey="name" innerRadius={58} outerRadius={100} paddingAngle={2}>{topAreas.map((item, index) => <Cell key={item.name} fill={regionColors[index % regionColors.length]} />)}</Pie><Tooltip formatter={value => [`${formatNumber(Number(value || 0))} ₽`, 'Сумма заказов']} /><Legend layout="vertical" align="right" verticalAlign="middle" /></PieChart></ResponsiveContainer></article><article className="geo-card geo-region-pie"><div className="geo-card-head"><div><h2>Top-5 населённых пунктов</h2><p>По сумме заказов.</p></div></div><ResponsiveContainer width="100%" height={300}><PieChart><Pie data={topCities} dataKey="value" nameKey="name" innerRadius={58} outerRadius={100} paddingAngle={2}>{topCities.map((item, index) => <Cell key={item.name} fill={regionColors[index % regionColors.length]} />)}</Pie><Tooltip formatter={value => [`${formatNumber(Number(value || 0))} ₽`, 'Сумма заказов']} /><Legend layout="vertical" align="right" verticalAlign="middle" /></PieChart></ResponsiveContainer></article></div>
    <article className="geo-card geo-table-card geo-detail-table-card">
      <div className="geo-card-head"><div><h2>Области и населённые пункты</h2><p>Области раскрываются до входящих населённых пунктов; доля рассчитана от {formatNumber(baseTotals.total)} заказов до географических фильтров.</p></div><label className="geo-detail-sort">Сортировка<select value={detailSort} onChange={event => { setDetailSort(event.target.value as DetailSort); setDetailPage(0); }}><option value="orders">Заказы</option><option value="orderedAmount">Сумма заказов</option><option value="share">Доля в заказах</option><option value="localShare">Локальность</option><option value="deliveryHours">Время доставки</option></select></label></div>
      <div className="geo-table-wrap"><table className="geo-table geo-detail-table"><thead><tr><th>Область / населённый пункт</th><th>ФО</th><th>Заказы</th><th>Доля в заказах</th><th>Заказано</th><th>Локальность</th><th>СВД</th><th>Рентабельность</th></tr></thead><tbody>{visibleDetailAreas.map(areaRow => <Fragment key={areaRow.key}><tr className="geo-level-area geo-clickable-row" onClick={() => setSelectedGeo({ level: 'area', district: areaRow.district, area: areaRow.name })}><td>{areaRow.cities.length > 0 && <button type="button" aria-label={expandedDetailAreas.has(areaRow.key) ? 'Скрыть города' : 'Показать города'} onClick={event => { event.stopPropagation(); setExpandedDetailAreas(current => { const next = new Set(current); if (next.has(areaRow.key)) next.delete(areaRow.key); else next.add(areaRow.key); return next; }); }}>{expandedDetailAreas.has(areaRow.key) ? '−' : '+'}</button>}<strong>{areaRow.name}</strong></td><td>{areaRow.district}</td><td>{formatNumber(areaRow.orders)}</td><td>{formatNumber(areaRow.share)}%</td><td>{formatNumber(areaRow.orderedAmount)} ₽</td><td>{formatNumber(areaRow.localShare)}%</td><td>{formatHours(areaRow.deliveryHours)}</td><td>{formatNumber(areaRow.profitability)}%</td></tr>{expandedDetailAreas.has(areaRow.key) && areaRow.cities.map(cityRow => <tr className="geo-level-city geo-clickable-row" key={`${areaRow.key}|${cityRow.name}`} onClick={() => setSelectedGeo({ level: 'city', district: areaRow.district, area: areaRow.name, city: cityRow.name })}><td><span>{cityRow.name}</span></td><td>{areaRow.district}</td><td>{formatNumber(cityRow.orders)}</td><td>{formatNumber(cityRow.share)}%</td><td>{formatNumber(cityRow.orderedAmount)} ₽</td><td>{formatNumber(cityRow.localShare)}%</td><td>{formatHours(cityRow.deliveryHours)}</td><td>{formatNumber(cityRow.profitability)}%</td></tr>)}</Fragment>)}</tbody></table></div>
      {detailAreas.length === 0 && <div className="geo-detail-empty">В выбранном срезе нет детализации по областям и населённым пунктам. Загрузите актуальный отчёт с колонками «Область» и «Город».</div>}
      {detailPageCount > 1 && <div className="geo-detail-pagination"><button type="button" disabled={currentDetailPage === 0} onClick={() => setDetailPage(Math.max(0, currentDetailPage - 1))}>Назад</button><span>{currentDetailPage + 1} / {detailPageCount}</span><button type="button" disabled={currentDetailPage >= detailPageCount - 1} onClick={() => setDetailPage(Math.min(detailPageCount - 1, currentDetailPage + 1))}>Далее</button></div>}
    </article>
    {selectedGeo && <><button type="button" className="geo-drawer-backdrop" aria-label="Закрыть карточку географии" onClick={() => setSelectedGeo(null)} /><aside className="geo-detail-drawer"><header><div><span>{selectedGeo.level === 'district' ? 'ФЕДЕРАЛЬНЫЙ ОКРУГ' : selectedGeo.level === 'area' ? 'РЕГИОН' : 'НАСЕЛЁННЫЙ ПУНКТ'}</span><h2>{selectedGeo.city || selectedGeo.area || selectedGeo.district}</h2><p>{[selectedGeo.district, selectedGeo.area, selectedGeo.city].filter(Boolean).join(' → ')}</p></div><button type="button" onClick={() => setSelectedGeo(null)}>×</button></header><div className="geo-drawer-kpis"><article><span>Заказы</span><strong>{formatNumber(selectedGeoSummary.total)}</strong></article><article><span>Доля в заказах</span><strong>{formatNumber(orderShare(selectedGeoSummary.total, baseTotals.total))}%</strong></article><article><span>Локальность</span><strong>{formatNumber(selectedGeoSummary.localShare)}%</strong></article><article><span>СВД</span><strong>{formatHours(selectedGeoSummary.deliveryHours)}</strong></article><article><span>Сумма заказов</span><strong>{formatNumber(selectedGeoFinance?.orderedAmount || 0)} ₽</strong></article><article><span>Чистая прибыль</span><strong>{formatNumber(selectedGeoFinance?.netProfit || 0)} ₽</strong></article><article><span>Рентабельность</span><strong>{formatNumber(selectedGeoFinance?.profitability || 0)}%</strong></article></div><section className="geo-drawer-section"><h3>Динамика</h3><ResponsiveContainer width="100%" height={190}><LineChart data={selectedGeoTrend}><CartesianGrid stroke="#e8eef5" strokeDasharray="3 3" /><XAxis dataKey="date" tick={{ fontSize: 9 }} minTickGap={24} interval="preserveStartEnd" /><YAxis yAxisId="delivery" tick={{ fontSize: 9 }} /><YAxis yAxisId="local" orientation="right" tick={{ fontSize: 9 }} /><Tooltip /><Line yAxisId="delivery" dataKey="delivery" stroke="#60A5FA" strokeWidth={2.2} dot={false} /><Line yAxisId="local" dataKey="localShare" stroke="#34D399" strokeWidth={2.2} dot={false} /></LineChart></ResponsiveContainer></section><section className="geo-drawer-section"><h3>Лидирующие товары</h3><div className="geo-drawer-products">{selectedGeoProducts.slice(0, 5).map(row => <div key={row.product?.id}><strong>{row.product?.sku || 'Без артикула'}</strong><span>{row.product?.name || 'Без названия'}</span><b>{formatNumber(row.total)} заказов</b></div>)}</div></section><section className="geo-drawer-section"><h3>Проблемные SKU</h3><div className="geo-drawer-products">{[...selectedGeoProducts].sort((left, right) => right.nonlocal - left.nonlocal || (right.deliveryHours || 0) - (left.deliveryHours || 0)).slice(0, 5).map(row => <div key={row.product?.id}><strong>{row.product?.sku || 'Без артикула'}</strong><span>{formatNumber(row.nonlocal)} нелок. · {formatHours(row.deliveryHours)}</span><b>{formatNumber(row.localShare)}% лок.</b></div>)}</div></section></aside></>}
  </section>;
}
