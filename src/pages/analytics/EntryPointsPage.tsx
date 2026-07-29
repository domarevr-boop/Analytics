import { Fragment, useMemo, useState, useSyncExternalStore } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import DateRangeFilter from '../../components/DateRangeFilter';
import FilterBar from '../../components/FilterBar';
import { getEntryPoints, getMemberships, getProducts, getVersion, subscribe } from '../../data/store';
import { getWbImageUrls, rememberWbImageUrl } from '../../data/images';
import type { EntryPointRecord, Product } from '../../types';

type AbsoluteMetric = 'impressions' | 'clicks' | 'carts' | 'orders';
type RelativeMetric = 'ctr' | 'cartCr' | 'clickOrderCr' | 'impressionOrderCr';
type MetricKey = AbsoluteMetric | RelativeMetric;

const metricLabels: Record<MetricKey, string> = {
  impressions: 'Показы', clicks: 'Переходы', carts: 'Корзины', orders: 'Заказы', ctr: 'CTR', cartCr: 'CR корз.', clickOrderCr: 'CR переход → заказ', impressionOrderCr: 'CR показ → заказ',
};
const topSections = [
  { key: 'search', label: 'Поиск', match: (section: string) => section.toLowerCase().includes('поиск') },
  { key: 'card', label: 'Карточка товара', match: (section: string) => section.toLowerCase().includes('карточк') },
  { key: 'link', label: 'Переходы по ссылке', match: (section: string) => section.toLowerCase().includes('ссылк') },
];
const chartColors = ['#2563EB', '#0EA5E9', '#10B981', '#F59E0B', '#8B5CF6', '#EC4899', '#64748B', '#14B8A6', '#F97316', '#84CC16'];
const fmt = (value: number) => new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 1 }).format(value);
const fmtRelative = (key: RelativeMetric, value: number) => new Intl.NumberFormat('ru-RU', { maximumFractionDigits: key === 'impressionOrderCr' ? 2 : 1, minimumFractionDigits: key === 'impressionOrderCr' ? 2 : 0 }).format(value);
const dayFormatter = new Intl.DateTimeFormat('ru-RU', { weekday: 'short' });

function aggregate(rows: EntryPointRecord[]) {
  const impressions = rows.reduce((sum, row) => sum + row.impressions, 0);
  const clicks = rows.reduce((sum, row) => sum + row.clicks, 0);
  const carts = rows.reduce((sum, row) => sum + row.carts, 0);
  const orders = rows.reduce((sum, row) => sum + row.orders, 0);
  return {
    impressions,
    clicks,
    carts,
    orders,
    ctr: impressions ? clicks / impressions * 100 : 0,
    cartCr: clicks ? carts / clicks * 100 : 0,
    clickOrderCr: clicks ? orders / clicks * 100 : 0,
    impressionOrderCr: impressions ? orders / impressions * 100 : 0,
  };
}

function pointName(row: Pick<EntryPointRecord, 'section' | 'entry_point'>): string {
  return `${row.section} · ${row.entry_point}`;
}

function allocatedOrderedAmount(row: EntryPointRecord): number {
  return row.product_orders_total ? (row.product_ordered_amount || 0) * row.orders / row.product_orders_total : 0;
}

function heatStyle(value: number, min: number, max: number): React.CSSProperties {
  if (max <= min || value === 0) return {};
  const ratio = Math.max(0, Math.min(1, (value - min) / (max - min)));
  return { backgroundColor: `hsl(145 48% ${99 - ratio * 12}%)` };
}

function range(values: number[]): [number, number] {
  return [Math.min(...values, 0), Math.max(...values, 0)];
}

function median(values: number[]): number {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? (sorted[middle] || 0) : ((sorted[middle - 1] || 0) + (sorted[middle] || 0)) / 2;
}

function formatMetric(metric: MetricKey, value: number): string {
  return metric === 'impressions' || metric === 'clicks' || metric === 'carts' || metric === 'orders'
    ? fmt(value)
    : `${fmtRelative(metric, value)}%`;
}

function ProductThumb({ product }: { product?: Product }) {
  const urls = useMemo(() => getWbImageUrls(product?.wb_sku || ''), [product?.wb_sku]);
  const [index, setIndex] = useState(0);
  if (!urls.length || !product || index >= urls.length) return <span className="entry-product-placeholder">Т</span>;
  return <img src={urls[index]} alt="" loading="lazy" onLoad={() => rememberWbImageUrl(product.wb_sku, urls[index])} onError={() => setIndex(current => current + 1)} />;
}

export default function EntryPointsPage() {
  useSyncExternalStore(subscribe, getVersion);
  const rows = getEntryPoints();
  const products = getProducts();
  const memberships = getMemberships();
  const availableDates = rows.map(row => row.date).sort();

  const [start, setStart] = useState(() => availableDates[0] || '');
  const [end, setEnd] = useState(() => availableDates.at(-1) || '');
  const [section, setSection] = useState('');
  const [entryPoint, setEntryPoint] = useState('');
  const [category, setCategory] = useState('');
  const [groupId, setGroupId] = useState('');
  const [cabinet, setCabinet] = useState('');
  const [brand, setBrand] = useState('');
  const [query, setQuery] = useState('');
  const [absoluteMetric, setAbsoluteMetric] = useState<AbsoluteMetric>('orders');
  const [relativeMetric, setRelativeMetric] = useState<RelativeMetric>('ctr');
  const [trendMetric, setTrendMetric] = useState<MetricKey>('orders');
  const [topMetric, setTopMetric] = useState<AbsoluteMetric>('orders');
  const [structureLevel, setStructureLevel] = useState<'section' | 'point'>('point');
  const [dayWindow, setDayWindow] = useState<7 | 14 | 30>(30);

  const productMap = useMemo(() => new Map(products.map(product => [product.id, product])), [products]);
  const canonicalProductId = useMemo(() => {
    const parent = new Map(products.map(product => [product.id, product.id]));
    const find = (id: string): string => {
      const current = parent.get(id) || id;
      if (current === id) return id;
      const root = find(current);
      parent.set(id, root);
      return root;
    };
    const union = (left: string, right: string) => {
      const leftRoot = find(left);
      const rightRoot = find(right);
      if (leftRoot !== rightRoot) parent.set(rightRoot, leftRoot);
    };
    const idsByIdentity = new Map<string, string[]>();
    products.forEach(product => {
      const canonicalSku = product.sku.replace(/\u00a0/g, ' ').trim().replace(/\.0+$/, '').replace(/\s*\(\d+\)\s*$/, '');
      const identities = [...new Set([product.sku, product.wb_sku, ...(product.aliases || []), canonicalSku].map(value => String(value || '').trim()).filter(Boolean))];
      identities.forEach(identity => idsByIdentity.set(identity, [...(idsByIdentity.get(identity) || []), product.id]));
    });
    idsByIdentity.forEach(ids => ids.slice(1).forEach(id => union(ids[0], id)));
    return new Map(products.map(product => [product.id, find(product.id)]));
  }, [products]);
  const groupIdsByProduct = useMemo(() => {
    const result = new Map<string, Set<string>>();
    memberships.forEach(membership => {
      const ids = result.get(membership.product_id) || new Set<string>();
      ids.add(membership.group_id);
      result.set(membership.product_id, ids);
    });
    return result;
  }, [memberships]);
  const sections = useMemo(() => [...new Set(rows.map(row => row.section))].sort(), [rows]);
  const points = useMemo(() => [...new Set(rows.filter(row => !section || row.section === section).map(row => row.entry_point))].sort(), [rows, section]);

  const filtered = useMemo(() => rows.filter(row => {
    const product = productMap.get(row.product_id);
    const search = query.trim().toLowerCase();
    return (!start || row.date >= start)
      && (!end || row.date <= end)
      && (!section || row.section === section)
      && (!entryPoint || row.entry_point === entryPoint)
      && (!category || product?.category === category)
      && (!groupId || groupIdsByProduct.get(row.product_id)?.has(groupId))
      && (!cabinet || product?.cabinet_id === cabinet)
      && (!brand || product?.brand_id === brand)
      && (!search || [product?.sku, product?.wb_sku, product?.name].some(value => value?.toLowerCase().includes(search)));
  }), [rows, productMap, groupIdsByProduct, start, end, section, entryPoint, category, groupId, cabinet, brand, query]);

  const topFiltered = useMemo(() => rows.filter(row => {
    const product = productMap.get(row.product_id);
    return (!start || row.date >= start)
      && (!end || row.date <= end)
      && (!category || product?.category === category)
      && (!groupId || groupIdsByProduct.get(row.product_id)?.has(groupId))
      && (!cabinet || product?.cabinet_id === cabinet);
  }), [rows, productMap, groupIdsByProduct, start, end, category, groupId, cabinet]);

  const financeBaseRows = useMemo(() => rows.filter(row => {
    const product = productMap.get(row.product_id);
    const search = query.trim().toLowerCase();
    return (!start || row.date >= start)
      && (!end || row.date <= end)
      && (!category || product?.category === category)
      && (!groupId || groupIdsByProduct.get(row.product_id)?.has(groupId))
      && (!cabinet || product?.cabinet_id === cabinet)
      && (!brand || product?.brand_id === brand)
      && (!search || [product?.sku, product?.wb_sku, product?.name].some(value => value?.toLowerCase().includes(search)));
  }), [rows, productMap, groupIdsByProduct, start, end, category, groupId, cabinet, brand, query]);

  const dates = useMemo(() => [...new Set(filtered.map(row => row.date))].sort(), [filtered]);
  const matrixRows = useMemo(() => {
    const byPoint = new Map<string, EntryPointRecord[]>();
    filtered.forEach(row => {
      const name = pointName(row);
      byPoint.set(name, [...(byPoint.get(name) || []), row]);
    });
    return [...byPoint.entries()]
      .map(([name, records]) => {
        const byDate = new Map<string, EntryPointRecord[]>();
        records.forEach(row => byDate.set(row.date, [...(byDate.get(row.date) || []), row]));
        const daily = new Map(dates.map(date => [date, aggregate(byDate.get(date) || [])]));
        return { name, section: records[0].section, entryPoint: records[0].entry_point, total: aggregate(records), daily };
      })
      .filter(row => row.total.impressions > 0)
      .sort((left, right) => right.total[absoluteMetric] - left.total[absoluteMetric]);
  }, [filtered, dates, absoluteMetric]);
  const totals = useMemo(() => aggregate(filtered), [filtered]);
  const visibleDates = useMemo(() => dates.slice(-dayWindow), [dates, dayWindow]);
  const rowRanges = useMemo(() => new Map(matrixRows.map(row => [row.name, {
    absolute: range(visibleDates.map(date => (row.daily.get(date) || aggregate([]))[absoluteMetric])),
    relative: range(visibleDates.map(date => (row.daily.get(date) || aggregate([]))[relativeMetric])),
  }])), [matrixRows, visibleDates, absoluteMetric, relativeMetric]);

  const topProducts = useMemo(() => topSections.map(channel => {
    const byProduct = new Map<string, EntryPointRecord[]>();
    topFiltered.filter(row => channel.match(row.section)).forEach(row => byProduct.set(row.product_id, [...(byProduct.get(row.product_id) || []), row]));
    const items = [...byProduct.entries()].map(([productId, records]) => {
      const finance = records.reduce((result, row) => {
        const share = row.product_orders_total ? row.orders / row.product_orders_total : 0;
        result.orderedAmount += (row.product_ordered_amount || 0) * share;
        result.profit += (row.product_net_profit || 0) * share;
        result.profitRevenue += (row.product_profit_revenue || 0) * share;
        return result;
      }, { orderedAmount: 0, profit: 0, profitRevenue: 0 });
      return {
        product: productMap.get(productId),
        metrics: aggregate(records),
        orderedAmount: finance.orderedAmount,
        profitability: finance.profitRevenue ? finance.profit / finance.profitRevenue * 100 : 0,
      };
    });
    return { ...channel, items: items.sort((left, right) => right.metrics[topMetric] - left.metrics[topMetric]).slice(0, 5) };
  }), [topFiltered, productMap, topMetric]);

  const trendData = useMemo(() => dates.map(date => {
    const dailyRows = filtered.filter(row => row.date === date);
    const metrics = aggregate(dailyRows);
    return { date, value: metrics[trendMetric], orderedAmount: dailyRows.reduce((sum, row) => sum + allocatedOrderedAmount(row), 0) };
  }), [filtered, dates, trendMetric]);

  const structureData = useMemo(() => {
    const grouped = new Map<string, EntryPointRecord[]>();
    filtered.forEach(row => {
      const key = structureLevel === 'section' ? row.section : pointName(row);
      grouped.set(key, [...(grouped.get(key) || []), row]);
    });
    const sorted = [...grouped.entries()].map(([name, records]) => ({ name, orderedAmount: records.reduce((sum, row) => sum + allocatedOrderedAmount(row), 0) })).sort((left, right) => right.orderedAmount - left.orderedAmount);
    const top = sorted.slice(0, 10);
    const other = sorted.slice(10).reduce((sum, row) => sum + row.orderedAmount, 0);
    return other ? [...top, { name: 'Остальные', orderedAmount: other }] : top;
  }, [filtered, structureLevel]);

  const finance = useMemo(() => {
    const keyOf = (date: string, productId: string) => `${date}|${canonicalProductId.get(productId) || productId}`;
    const entryOrdersByKey = new Map<string, number>();
    const productTotalsByKey = new Map<string, { orders: number; orderedAmount: number; profit: number; profitRevenue: number; adSpend: number }>();
    financeBaseRows.forEach(row => {
      const key = keyOf(row.date, row.product_id);
      entryOrdersByKey.set(key, (entryOrdersByKey.get(key) || 0) + row.orders);
      if (!productTotalsByKey.has(key)) productTotalsByKey.set(key, {
        orders: row.product_orders_total || 0,
        orderedAmount: row.product_ordered_amount || 0,
        profit: row.product_net_profit || 0,
        profitRevenue: row.product_profit_revenue || 0,
        adSpend: row.product_ad_spend || 0,
      });
    });

    const byPoint = new Map<string, { name: string; section: string; entryPoint: string; orders: number; orderedAmount: number; profit: number; profitRevenue: number; adSpend: number }>();
    filtered.forEach(row => {
      const key = keyOf(row.date, row.product_id);
      const productTotals = productTotalsByKey.get(key);
      const denominator = productTotals?.orders || 0;
      if (!denominator || !row.orders) return;
      const share = row.orders / denominator;
      const name = pointName(row);
      const current = byPoint.get(name) || { name, section: row.section, entryPoint: row.entry_point, orders: 0, orderedAmount: 0, profit: 0, profitRevenue: 0, adSpend: 0 };
      current.orders += row.orders;
      current.orderedAmount += (productTotals?.orderedAmount || 0) * share;
      current.adSpend += (productTotals?.adSpend || 0) * share;
      current.profit += (productTotals?.profit || 0) * share;
      current.profitRevenue += (productTotals?.profitRevenue || 0) * share;
      byPoint.set(name, current);
    });

    const points = [...byPoint.values()].map(row => ({
      ...row,
      drr: row.orderedAmount ? row.adSpend / row.orderedAmount * 100 : 0,
      profitability: row.profitRevenue ? row.profit / row.profitRevenue * 100 : 0,
    })).sort((left, right) => right.orderedAmount - left.orderedAmount || right.orders - left.orders || left.name.localeCompare(right.name, 'ru'));
    const totals = points.reduce((result, row) => ({
      orders: result.orders + row.orders,
      orderedAmount: result.orderedAmount + row.orderedAmount,
      profit: result.profit + row.profit,
      profitRevenue: result.profitRevenue + row.profitRevenue,
      adSpend: result.adSpend + row.adSpend,
    }), { orders: 0, orderedAmount: 0, profit: 0, profitRevenue: 0, adSpend: 0 });
    const reconciliation = [...entryOrdersByKey.entries()].reduce((result, [key, entryOrders]) => {
      const funnelOrders = productTotalsByKey.get(key)?.orders || 0;
      if (productTotalsByKey.has(key) && funnelOrders > 0) result.matchedKeys += 1;
      result.entryOrders += entryOrders;
      result.funnelOrders += funnelOrders;
      result.unallocated += Math.max(0, funnelOrders - entryOrders);
      result.excess += Math.max(0, entryOrders - funnelOrders);
      return result;
    }, { entryOrders: 0, funnelOrders: 0, unallocated: 0, excess: 0, matchedKeys: 0, totalKeys: entryOrdersByKey.size });
    return {
      points,
      totals: {
        ...totals,
        drr: totals.orderedAmount ? totals.adSpend / totals.orderedAmount * 100 : 0,
        profitability: totals.profitRevenue ? totals.profit / totals.profitRevenue * 100 : 0,
      },
      reconciliation,
    };
  }, [financeBaseRows, filtered, productMap, canonicalProductId, start, end]);

  if (!rows.length) return <section className="entry-page analytics-empty-page">
    <header className="entry-header"><span className="geo-eyebrow">АНАЛИТИКА</span><h1>Структура трафика</h1><p>Точки входа, динамика и товарные лидеры в едином фильтрованном контексте.</p></header>
    <article className="analytics-empty-card"><span>ДАННЫЕ НЕ ЗАГРУЖЕНЫ</span><h2>Точки входа пока недоступны</h2><p>Импортируйте отчёт «Точки входа», чтобы собрать структуру трафика и финансовую аналитику каналов.</p></article>
  </section>;

  return (
    <section className="entry-page">
      <header className="entry-header"><span className="geo-eyebrow">АНАЛИТИКА</span><h1>Структура трафика</h1><p>Точки входа, динамика и товарные лидеры в едином фильтрованном контексте.</p></header>

      <article className="entry-card entry-filter-card table-toolbar entry-analytics-toolbar">
        <div className="date-filters"><DateRangeFilter label="Период" value={{ start, end }} onChange={period => { setStart(period.start); setEnd(period.end); }} maxDate={availableDates.at(-1) || end} /></div>
        <FilterBar cabinetFilter={cabinet} categoryFilter={category} brandFilter={brand} groupFilter={groupId} skuFilter={query} onCabinetChange={setCabinet} onCategoryChange={setCategory} onBrandChange={setBrand} onGroupChange={setGroupId} onSkuChange={setQuery} variant="dashboard" afterControls={<><select className="entry-context-select" aria-label="Раздел" value={section} onChange={event => { setSection(event.target.value); setEntryPoint(''); }}><option value="">Все разделы</option>{sections.map(item => <option key={item}>{item}</option>)}</select><select className="entry-context-select" aria-label="Точка входа" value={entryPoint} onChange={event => setEntryPoint(event.target.value)}><option value="">Все точки входа</option>{points.map(item => <option key={item}>{item}</option>)}</select></>} />
      </article>

      <div className="entry-kpis">
        <article><span>Показы</span><strong>{fmt(totals.impressions)}</strong><small>CTR {fmt(totals.ctr)}%</small></article>
        <article><span>Переходы</span><strong>{fmt(totals.clicks)}</strong><small>В корзину {fmt(totals.cartCr)}%</small></article>
        <article><span>Заказы</span><strong>{fmt(totals.orders)}</strong><small>CR показ → заказ {fmt(totals.impressionOrderCr)}%</small></article>
        <article><span>Точки входа</span><strong>{matrixRows.length}</strong><small>Активных в выбранном срезе</small></article>
      </div>

      <article className="entry-card entry-top-card">
        <div className="entry-card-head"><div><h2>Топ-5 товаров по каналам</h2><p>Лидеры агрегированы по всем точкам входа внутри раздела.</p></div><label className="entry-inline-control">Метрика<select value={topMetric} onChange={event => setTopMetric(event.target.value as AbsoluteMetric)}>{(['impressions', 'clicks', 'carts', 'orders'] as AbsoluteMetric[]).map(key => <option key={key} value={key}>{metricLabels[key]}</option>)}</select></label></div>
        <div className="entry-top-grid">{topProducts.map(channel => <section key={channel.key}><h3>{channel.label}</h3>{channel.items.length ? <ol>{channel.items.map(({ product, metrics, orderedAmount, profitability }, index) => <li key={product?.id || index} onClick={() => product && setQuery(product.sku)}><span className="entry-top-rank">{index + 1}</span><span className="entry-product-thumb"><ProductThumb product={product} /></span><span className="entry-top-product"><strong>{product?.name || product?.sku || 'Неизвестный товар'}</strong><small>SKU {product?.sku || '—'}</small></span><span className="entry-top-value"><strong>{fmt(metrics[topMetric])}</strong><small>{fmt(metrics.orders)} зак. · {fmt(orderedAmount)} ₽</small><em>Рент. {fmt(profitability)}%</em></span></li>)}</ol> : <div className="entry-empty">Нет данных в выбранном срезе</div>}</section>)}</div>
      </article>

      <article className="entry-card entry-matrix-card">
        <div className="entry-card-head entry-matrix-head"><div><h2>Точки входа по дням</h2></div><div className="entry-matrix-controls"><label>Основная<select value={absoluteMetric} onChange={event => setAbsoluteMetric(event.target.value as AbsoluteMetric)}>{(['impressions', 'clicks', 'carts', 'orders'] as AbsoluteMetric[]).map(key => <option key={key} value={key}>{metricLabels[key]}</option>)}</select></label><label>Относительная<select value={relativeMetric} onChange={event => setRelativeMetric(event.target.value as RelativeMetric)}>{(['ctr', 'cartCr', 'clickOrderCr', 'impressionOrderCr'] as RelativeMetric[]).map(key => <option key={key} value={key}>{metricLabels[key]}</option>)}</select></label><label>Дней<select value={dayWindow} onChange={event => setDayWindow(Number(event.target.value) as 7 | 14 | 30)}><option value={7}>7 дней</option><option value={14}>14 дней</option><option value={30}>30 дней</option></select></label></div></div>
        <div className="entry-matrix-wrap"><table className="entry-matrix"><thead><tr><th className="entry-matrix-point">Точка входа</th>{visibleDates.map(date => { const day = new Date(`${date}T00:00:00`).getDay(); const weekend = day === 0 || day === 6; const latest = date === visibleDates.at(-1); return <th key={date} className={`entry-matrix-date${weekend ? ' entry-weekend' : ''}${latest ? ' entry-latest-day' : ''}`}><span>{date.slice(5).split('-').reverse().join('.')}</span><small>{dayFormatter.format(new Date(`${date}T00:00:00`)).replace('.', '')}</small></th>; })}</tr></thead>
          <tbody>{matrixRows.map(row => {
            const absoluteValues = visibleDates.map(date => (row.daily.get(date) || aggregate([]))[absoluteMetric]);
            const absoluteAverage = absoluteValues.length ? absoluteValues.reduce((sum, value) => sum + value, 0) / absoluteValues.length : 0;
            const relativeValues = visibleDates.map(date => (row.daily.get(date) || aggregate([]))[relativeMetric]);
            const average = relativeValues.length ? relativeValues.reduce((sum, value) => sum + value, 0) / relativeValues.length : 0;
            const latestValue = absoluteValues.at(-1) || 0;
            const change = absoluteAverage ? (latestValue - absoluteAverage) / absoluteAverage * 100 : 0;
            const ranges = rowRanges.get(row.name)!;
            return <Fragment key={row.name}><tr className="entry-matrix-primary"><td className="entry-matrix-point" rowSpan={2} title={row.name} onClick={() => { setSection(row.section); setEntryPoint(row.entryPoint); }}><div className="entry-point-head"><strong>{row.entryPoint}</strong><span className="entry-section-tag">{row.section}</span></div><div className="entry-point-metrics"><div><span>{metricLabels[relativeMetric]}</span><strong>{fmtRelative(relativeMetric, average)}%</strong><small>мед. {fmtRelative(relativeMetric, median(relativeValues))}%</small></div><div><span>{metricLabels[absoluteMetric]}</span><strong>{fmt(row.total[absoluteMetric])}</strong><small>ср. {fmt(absoluteAverage)} · мед. {fmt(median(absoluteValues))}</small></div></div><em className={`entry-point-change ${change >= 0 ? 'up' : 'down'}`}>посл. {change >= 0 ? '+' : ''}{fmt(change)}%</em></td>{visibleDates.map(date => { const metrics = row.daily.get(date) || aggregate([]); const day = new Date(`${date}T00:00:00`).getDay(); const weekend = day === 0 || day === 6; const latest = date === visibleDates.at(-1); return <td key={`${date}-${absoluteMetric}`} className={`${weekend ? 'entry-weekend' : ''}${latest ? ' entry-latest-day' : ''}`} style={heatStyle(metrics[absoluteMetric], ...ranges.absolute)}>{fmt(metrics[absoluteMetric])}</td>; })}</tr><tr className="entry-matrix-relative">{visibleDates.map(date => { const metrics = row.daily.get(date) || aggregate([]); const day = new Date(`${date}T00:00:00`).getDay(); const weekend = day === 0 || day === 6; const latest = date === visibleDates.at(-1); return <td key={`${date}-${relativeMetric}`} className={`${weekend ? 'entry-weekend' : ''}${latest ? ' entry-latest-day' : ''}`} title={`${metricLabels[relativeMetric]}: ${fmtRelative(relativeMetric, metrics[relativeMetric])}%`}>{fmtRelative(relativeMetric, metrics[relativeMetric])}%</td>; })}</tr></Fragment>;
          })}</tbody></table></div>
      </article>

      <div className="entry-analysis-grid">
        <article className="entry-card entry-chart-card"><div className="entry-card-head"><div><h2>Динамика метрик</h2><p>Выбранная метрика и сумма заказов по дням.</p></div><label className="entry-inline-control">Метрика<select value={trendMetric} onChange={event => setTrendMetric(event.target.value as MetricKey)}>{(Object.keys(metricLabels) as MetricKey[]).map(key => <option key={key} value={key}>{metricLabels[key]}</option>)}</select></label></div><div className="entry-chart-area"><ResponsiveContainer width="100%" height={280}><ComposedChart data={trendData} margin={{ top: 16, right: 18, left: 4, bottom: 4 }}><CartesianGrid stroke="#E7ECF2" strokeDasharray="3 3" /><XAxis dataKey="date" tickFormatter={date => String(date).slice(5)} tick={{ fontSize: 10, fill: '#7B889B' }} tickLine={false} /><YAxis yAxisId="metric" tickFormatter={value => formatMetric(trendMetric, Number(value))} tick={{ fontSize: 10, fill: '#7B889B' }} tickLine={false} width={52} /><YAxis yAxisId="amount" orientation="right" tickFormatter={value => `${fmt(Number(value) / 1_000_000)}M ₽`} tick={{ fontSize: 10, fill: '#7B889B' }} tickLine={false} width={52} /><Tooltip labelFormatter={date => String(date)} formatter={(value, name) => name === 'orderedAmount' ? [`${fmt(Number(value || 0))} ₽`, 'Сумма заказов'] : [formatMetric(trendMetric, Number(value || 0)), metricLabels[trendMetric]]} /><Line yAxisId="metric" type="monotone" dataKey="value" name="value" stroke="#2563EB" strokeWidth={2.4} dot={trendData.length <= 14 ? { r: 2.5 } : false} activeDot={{ r: 4 }} /><Line yAxisId="amount" type="monotone" dataKey="orderedAmount" name="orderedAmount" stroke="#10A778" strokeWidth={2.2} dot={false} /></ComposedChart></ResponsiveContainer></div></article>

        <article className="entry-card entry-chart-card"><div className="entry-card-head"><div><h2>Сумма заказов по точкам входа</h2><p>Распределённая сумма в рублях · Top-10 и остаток.</p></div><div className="entry-segmented"><button className={structureLevel === 'section' ? 'active' : ''} onClick={() => setStructureLevel('section')}>Разделы</button><button className={structureLevel === 'point' ? 'active' : ''} onClick={() => setStructureLevel('point')}>Точки</button></div></div><div className="entry-chart-area"><ResponsiveContainer width="100%" height={280}><BarChart data={structureData} layout="vertical" margin={{ top: 8, right: 24, left: 18, bottom: 4 }}><CartesianGrid stroke="#E7ECF2" strokeDasharray="3 3" horizontal={false} /><XAxis type="number" tickFormatter={value => `${fmt(Number(value) / 1_000_000)}M`} tick={{ fontSize: 10, fill: '#7B889B' }} tickLine={false} /><YAxis type="category" dataKey="name" width={145} tick={{ fontSize: 9, fill: '#52647C' }} tickLine={false} tickFormatter={value => String(value).length > 24 ? `${String(value).slice(0, 22)}…` : String(value)} /><Tooltip formatter={value => [`${fmt(Number(value || 0))} ₽`, 'Сумма заказов']} /><Bar dataKey="orderedAmount" radius={[0, 4, 4, 0]} maxBarSize={18}>{structureData.map((item, index) => <Cell key={item.name} fill={item.name === 'Остальные' ? '#CBD5E1' : chartColors[index % chartColors.length]} />)}</Bar></BarChart></ResponsiveContainer></div></article>
      </div>

      <article className="entry-card entry-finance-card">
        <div className="entry-card-head"><div><h2>Экономика точек входа</h2><p>Суммы распределены по доле заказов каждой точки внутри комбинации «дата + товар».</p></div><div className={`entry-reconciliation${finance.reconciliation.unallocated || finance.reconciliation.excess || finance.reconciliation.matchedKeys < finance.reconciliation.totalKeys ? ' warning' : ''}`}><strong>{finance.reconciliation.funnelOrders ? fmt(finance.reconciliation.entryOrders / finance.reconciliation.funnelOrders * 100) : '0'}%</strong><span>покрытие заказов · сопоставлено {finance.reconciliation.matchedKeys}/{finance.reconciliation.totalKeys} SKU-дней</span>{finance.reconciliation.unallocated > 0 && <small>Нераспределено: {fmt(finance.reconciliation.unallocated)} шт.</small>}{finance.reconciliation.excess > 0 && <small>Сверх воронки: {fmt(finance.reconciliation.excess)} шт.</small>}</div></div>
        <div className="entry-finance-kpis">
          <article><span>Сумма заказов</span><strong>{fmt(finance.totals.orderedAmount)} ₽</strong><small>{fmt(finance.totals.orders)} заказов</small></article>
          <article><span>Чистая прибыль</span><strong>{fmt(finance.totals.profit)} ₽</strong><small>Распределена по заказам</small></article>
          <article><span>Реклама</span><strong>{fmt(finance.totals.adSpend)} ₽</strong><small>Распределена по заказам</small></article>
          <article><span>ДРР</span><strong>{fmt(finance.totals.drr)}%</strong><small>Реклама / сумма заказов</small></article>
          <article><span>Рентабельность</span><strong>{fmt(finance.totals.profitability)}%</strong><small>ЧП / выручка отчёта</small></article>
        </div>
        <div className="entry-finance-table-wrap"><table className="entry-finance-table"><thead><tr><th>Раздел / точка входа</th><th>Заказы, шт.</th><th>Сумма заказов</th><th>Доля</th><th>Чистая прибыль</th><th>Доля</th><th>Реклама</th><th>Доля</th><th>ДРР</th><th>Рентабельность</th></tr></thead><tbody>{finance.points.map(row => <tr key={row.name}><td><strong>{row.entryPoint}</strong><small>{row.section}</small></td><td>{fmt(row.orders)}</td><td>{fmt(row.orderedAmount)} ₽</td><td className="entry-share-cell">{finance.totals.orderedAmount ? fmt(row.orderedAmount / finance.totals.orderedAmount * 100) : '0'}%</td><td className={row.profit < 0 ? 'negative' : 'positive'}>{fmt(row.profit)} ₽</td><td className="entry-share-cell">{finance.totals.profit ? fmt(row.profit / finance.totals.profit * 100) : '0'}%</td><td>{fmt(row.adSpend)} ₽</td><td className="entry-share-cell">{finance.totals.adSpend ? fmt(row.adSpend / finance.totals.adSpend * 100) : '0'}%</td><td>{fmt(row.drr)}%</td><td className={row.profitability < 0 ? 'negative' : 'positive'}>{fmt(row.profitability)}%</td></tr>)}</tbody></table>{!finance.points.length && <div className="entry-empty">Нет данных для распределения в выбранном срезе</div>}</div>
        <p className="entry-finance-note">Это управленческая пропорциональная модель, а не подтверждённая рекламная атрибуция. Процентные показатели рассчитаны заново из распределённых денежных сумм.</p>
      </article>
    </section>
  );
}
