import { useEffect, useState, useMemo, useSyncExternalStore } from 'react';
import type { MetricValues, TableRow } from '../types';
import type { DailyMetrics } from '../types';
import { subscribe, getVersion, getProducts, getMetrics, getProfitabilityRecords, getGroupMembershipHistory, getMemberships } from '../data/store';
import { getTableData, sumForProduct, toMetrics as mockToMetrics, getPlanMap } from '../data/mock';
import type { DatePeriod } from '../data/mock';
import { getWbImageUrls, rememberWbImageUrl } from '../data/images';
import { getCabinetExtraExpense } from '../data/profitStore';
import { getReportNetProfit } from '../data/profitabilityCalculations';
import { resolveGroupAtDate } from '../data/groupMembershipHistory';
import { getEffectivePlanMetrics } from '../data/planningStore';
import { sortDashboardSiblingsByOrders } from '../data/dashboardTableCalculations';

const emptyMetrics = (): MetricValues => ({ impressions: 0, clicks: 0, ctr: 0, carts: 0, cr_cart: 0, orders: 0, avg_price: 0, cr_order: 0, ad_spend: 0, ad_clicks: 0, ad_orders: 0, cpc: 0, cpo: 0, drr: 0, drrForecast: 0, drrActual: 0, plan_orders: 0, plan_orders_qty: 0, plan_sum: 0, plan_price: 0, plan_net_profit: 0, plan_profitability: 0, plan_revenue: 0, fact_orders: 0, plan_pct: 0, revenue: 0, effectiveRevenue: 0, buyout_amount: 0, profit: 0, margin: 0, stock: 0 });
const addTo = (a: MetricValues, b: MetricValues) => {
  a.impressions += b.impressions; a.clicks += b.clicks;
  a.carts += b.carts; a.orders += b.orders;
  a.ad_spend += b.ad_spend; a.plan_orders += b.plan_orders; a.plan_orders_qty += b.plan_orders_qty; a.plan_sum += b.plan_sum; a.plan_net_profit += b.plan_net_profit; a.plan_revenue += b.plan_revenue;
  a.fact_orders += b.fact_orders; a.revenue += b.revenue;
  a.effectiveRevenue += b.effectiveRevenue; a.buyout_amount += b.buyout_amount; a.profit += b.profit; a.stock += b.stock;
};

const f = (n: number) => Math.round(n).toLocaleString('ru-RU');
const f1 = (n: number) => n.toLocaleString('ru-RU', { maximumFractionDigits: 1 });
const f2 = (n: number) => n.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const formatMetricValue = (n: number, metricKey: string, decimals: boolean) => metricKey === 'cr_order'
  ? f2(n)
  : decimals ? f1(n) : f(n);
const shortFmt = (n: number): string => {
  if (n >= 1000000) return f1(n / 1000000) + 'м';
  if (n >= 1000) return f1(n / 1000) + 'к';
  return f(n);
};


function pctChange(curr: number, prev: number): number | null {
  if (prev === 0) return curr > 0 ? null : 0;
  return ((curr - prev) / prev) * 100;
}

export const TABLE_METRIC_GROUPS = [
  { label: 'Бизнес метрики', keys: ['fact_orders', 'orders', 'avg_price', 'profit', 'margin'] as const },
  { label: 'Реклама', keys: ['ad_spend', 'drr'] as const },
  { label: 'Воронка', keys: ['impressions', 'clicks', 'ctr', 'carts', 'cr_cart', 'cr_order'] as const },
  { label: 'Финансы', keys: ['revenue'] as const },
];

export type TableMetricKey = typeof TABLE_METRIC_GROUPS[number]['keys'][number];

export const TABLE_METRIC_LABELS: Record<TableMetricKey, string> = {
  impressions: 'Показы', clicks: 'Клики', ctr: 'CTR',
  carts: 'Корзины', cr_cart: 'CR корз', orders: 'Заказы, шт', cr_order: 'CR зак',
  fact_orders: 'Факт заказов', avg_price: 'Средняя цена',
  ad_spend: 'Расход', drr: 'ДРР',
  profit: 'Прибыль', margin: 'Рент-сть',
  revenue: 'Выручка',
};

const PLAN_KEYS = new Set(['orders', 'fact_orders', 'avg_price', 'profit', 'margin', 'revenue']);

const METRIC_CFG: Record<string, { suffix: string; decimals: boolean; rev: boolean; primary: boolean }> = {
  fact_orders: { suffix: ' ₽', decimals: false, rev: false, primary: true },
  orders: { suffix: '', decimals: false, rev: false, primary: true },
  avg_price: { suffix: ' ₽', decimals: false, rev: false, primary: false },
  profit: { suffix: ' ₽', decimals: false, rev: false, primary: false },
  margin: { suffix: '%', decimals: true, rev: false, primary: false },
  impressions: { suffix: '', decimals: false, rev: false, primary: false },
  clicks: { suffix: '', decimals: false, rev: false, primary: false },
  ctr: { suffix: '%', decimals: true, rev: false, primary: false },
  carts: { suffix: '', decimals: false, rev: false, primary: false },
  cr_cart: { suffix: '%', decimals: true, rev: false, primary: false },
  cr_order: { suffix: '%', decimals: true, rev: false, primary: false },
  ad_spend: { suffix: ' ₽', decimals: false, rev: true, primary: false },
  drr: { suffix: '%', decimals: true, rev: true, primary: false },
  revenue: { suffix: ' ₽', decimals: false, rev: false, primary: true },
};

interface AggDay {
  date: string;
  impressions: number; clicks: number; carts: number; orders: number;
  ordered_amount: number; buyout_amount: number; ad_spend: number;
  actual_profit: number; profit_revenue: number;
}

function metricFromDay(day: AggDay, key: string): number {
  switch (key) {
    case 'fact_orders': return day.ordered_amount;
    case 'orders': return day.orders;
    case 'avg_price': return day.orders ? day.ordered_amount / day.orders : 0;
    case 'profit': return day.actual_profit;
    case 'margin': return day.profit_revenue ? (day.actual_profit / day.profit_revenue) * 100 : 0;
    case 'impressions': return day.impressions;
    case 'clicks': return day.clicks;
    case 'ctr': return day.impressions ? (day.clicks / day.impressions) * 100 : 0;
    case 'carts': return day.carts;
    case 'cr_cart': return day.impressions ? (day.carts / day.impressions) * 100 : 0;
    case 'cr_order': return day.carts ? (day.orders / day.carts) * 100 : 0;
    case 'ad_spend': return day.ad_spend;
    case 'drr': return day.ordered_amount ? (day.ad_spend / day.ordered_amount) * 100 : 0;
    case 'revenue': return day.buyout_amount;
    default: return 0;
  }
}

function toAggDay(m: DailyMetrics): AggDay {
  return {
    date: m.date,
    impressions: m.impressions, clicks: m.clicks, carts: m.carts, orders: m.orders,
    ordered_amount: m.ordered_amount, buyout_amount: m.buyout_amount,
    ad_spend: m.ad_spend, actual_profit: m.actual_profit,
    profit_revenue: m.profit_revenue || 0,
  };
}

function addAggDay(a: AggDay, b: AggDay): AggDay {
  return {
    date: a.date,
    impressions: a.impressions + b.impressions,
    clicks: a.clicks + b.clicks,
    carts: a.carts + b.carts,
    orders: a.orders + b.orders,
    ordered_amount: a.ordered_amount + b.ordered_amount,
    buyout_amount: a.buyout_amount + b.buyout_amount,
    ad_spend: a.ad_spend + b.ad_spend,
    actual_profit: a.actual_profit + b.actual_profit,
    profit_revenue: a.profit_revenue + b.profit_revenue,
  };
}

interface Props {
  cabinetFilter: string;
  categoryFilter: string;
  brandFilter: string;
  groupFilter: string;
  skuFilter: string;
  periodA: DatePeriod;
  periodB: DatePeriod;
  visibleMetrics?: TableMetricKey[];
  onProductOpen?: (productId: string) => void;
}

const CHART_BAR_W = 18;
const CHART_BAR_H = 24;
const CHART_LABEL_H = 12;
const CHART_H = CHART_BAR_H + CHART_LABEL_H;
const CHART_W = 7 * CHART_BAR_W;
const TREND_METRICS = new Set(['ctr', 'cr_cart', 'cr_order', 'drr', 'margin']);

function formatDateLabel(dateStr: string): string {
  const p = dateStr.split('-');
  if (p.length === 3) return String(parseInt(p[2], 10));
  return dateStr;
}

function MiniBarChart({ values, dates, metricKey }: { values: number[]; dates: string[]; metricKey: string }) {
  const [hover, setHover] = useState<{ text: string; cx: number } | null>(null);
  const maxVal = Math.max(...values, 1);
  const cfg = METRIC_CFG[metricKey];
  const fmt = (v: number) => formatMetricValue(v, metricKey, cfg.decimals) + cfg.suffix;
  const isTrend = TREND_METRICS.has(metricKey);
  const minValue = Math.min(...values, 0);
  const maxValue = Math.max(...values, 0);
  const spread = Math.max(maxValue - minValue, 0.1);
  const trendMin = minValue - spread * 0.12;
  const trendMax = maxValue + spread * 0.12;
  const trendRange = trendMax - trendMin;
  const trendPoints = values.map((value, index) => ({
    x: index * CHART_BAR_W + 7,
    y: CHART_BAR_H - ((value - trendMin) / trendRange) * (CHART_BAR_H - 3) - 1,
  }));
  return (
    <div style={{ position: 'relative', display: 'inline-block' }}>
      <svg width={CHART_W} height={CHART_H} viewBox={`0 0 ${CHART_W} ${CHART_H}`} style={{ display: 'block' }}>
        {isTrend ? (
          <>
            <polyline
              points={trendPoints.map((point) => `${point.x},${point.y}`).join(' ')}
              fill="none"
              stroke="var(--color-primary)"
              strokeWidth="1.8"
              strokeLinejoin="round"
              strokeLinecap="round"
            />
            {trendPoints.map((point, index) => (
              <circle
                key={index}
                cx={point.x}
                cy={point.y}
                r="2.4"
                fill="var(--color-surface)"
                stroke="var(--color-primary)"
                strokeWidth="1.5"
                onMouseEnter={() => setHover({ text: fmt(values[index]), cx: point.x })}
                onMouseLeave={() => setHover(null)}
              />
            ))}
          </>
        ) : values.map((v, i) => {
            const barH = Math.max((v / maxVal) * CHART_BAR_H, 1);
            const x = i * CHART_BAR_W;
            return (
              <rect key={i} x={x} y={CHART_BAR_H - barH} width={14} height={barH}
                fill="var(--color-primary)" rx={1}
                onMouseEnter={() => setHover({ text: fmt(v), cx: x + 5 })}
                onMouseLeave={() => setHover(null)}
              />
            );
          })}
        {dates.map((d, i) => (
          <text key={i} x={i * CHART_BAR_W + 5} y={CHART_H - 2} textAnchor="middle"
            fill="var(--color-text-muted)" fontSize="8" fontFamily="inherit">
            {formatDateLabel(d)}
          </text>
        ))}
      </svg>
      {hover && (
        <div style={{
          position: 'absolute', top: -22, left: hover.cx,
          transform: 'translateX(-50%)',
          background: '#2D2824', color: '#fff',
          padding: '2px 6px', borderRadius: 4,
          fontSize: 11, fontFamily: 'JetBrains Mono, monospace',
          whiteSpace: 'nowrap', pointerEvents: 'none', zIndex: 10,
        }}>
          {hover.text}
        </div>
      )}
    </div>
  );
}

export default function AnalyticsTable({ cabinetFilter, categoryFilter, brandFilter, groupFilter, skuFilter, periodA, periodB, visibleMetrics, onProductOpen }: Props) {
  const version = useSyncExternalStore(subscribe, getVersion);
  if (import.meta.env.DEV) console.log('[AnalyticsTable] render', { periodA, periodB, version });
  const filters = useMemo(() => {
    const f: Record<string, string> = {};
    if (cabinetFilter) f.cabinetId = cabinetFilter;
    if (categoryFilter) f.category = categoryFilter;
    if (brandFilter) f.brandId = brandFilter;
    if (groupFilter) f.groupId = groupFilter;
    if (skuFilter) f.sku = skuFilter;
    return f;
  }, [cabinetFilter, categoryFilter, brandFilter, groupFilter, skuFilter]);
  const allRows = useMemo(() => {
    const result = getTableData(periodA, periodB, filters);
    if (import.meta.env.DEV) console.log('[AnalyticsTable] allRows computed', { periodA, periodB, filters, rows: result.length });
    return result;
  }, [version, periodA, periodB, filters]);
  const products = useMemo(() => getProducts(), [version]);
  const productToWbSku = useMemo(() => {
    const result = new Map<string, string>();
    const baseSkuToWbSku = new Map<string, string>();
    const normalizeBaseSku = (sku: string) => sku.trim().replace(/-\d+$/, '');

    for (const product of products) {
      if (product.wb_sku && (product.wb_sku !== product.sku || product.sku.replace(/\D/g, '').length >= 7)) {
        result.set(product.id, product.wb_sku);
        const baseSku = normalizeBaseSku(product.sku);
        if (!baseSkuToWbSku.has(baseSku)) baseSkuToWbSku.set(baseSku, product.wb_sku);
      }
    }

    for (const product of products) {
      if (result.has(product.id)) continue;
      const inheritedWbSku = baseSkuToWbSku.get(normalizeBaseSku(product.sku));
      if (inheritedWbSku) result.set(product.id, inheritedWbSku);
    }

    return result;
  }, [products]);
  const monthStart = useMemo(() => periodA.end.slice(0, 7) + '-01', [periodA]);
  const last7Start = useMemo(() => {
    const d = new Date(periodA.end);
    d.setDate(d.getDate() - 6);
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }, [periodA]);

  const [expanded, setExpanded] = useState<Set<string>>(new Set([allRows[0]?.id]));
  const [chartMetrics, setChartMetrics] = useState<Set<string>>(new Set());
  const [focusedMetric, setFocusedMetric] = useState('');
  const [planMetrics, setPlanMetrics] = useState<Set<string>>(new Set());

  useEffect(() => {
    const handleKpiSelect = (event: Event) => {
      const { metricKey, active } = (event as CustomEvent<{ metricKey: string; active?: boolean }>).detail || {};
      if (!metricKey || !TABLE_METRIC_LABELS[metricKey as TableMetricKey]) return;
      setFocusedMetric(current => active === false && current === metricKey ? '' : metricKey);
      setChartMetrics(current => {
        const next = new Set(current);
        if (active === false) next.delete(metricKey); else next.add(metricKey);
        return next;
      });
    };
    window.addEventListener('analytics:kpi-select', handleKpiSelect);
    return () => window.removeEventListener('analytics:kpi-select', handleKpiSelect);
  }, []);
  const visibleMetricSet = useMemo(
    () => new Set<TableMetricKey>(visibleMetrics || TABLE_METRIC_GROUPS.flatMap(group => [...group.keys])),
    [visibleMetrics],
  );
  const visibleGroups = useMemo(
    () => TABLE_METRIC_GROUPS
      .map(group => ({ ...group, keys: group.keys.filter(key => visibleMetricSet.has(key)) }))
      .filter(group => group.keys.length > 0),
    [visibleMetricSet],
  );

  const toggleChart = (key: string) => {
    setChartMetrics(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  };

  const togglePlan = (key: string) => {
    setPlanMetrics(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  };

  const toggleRow = (id: string) => {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const visible = useMemo(() => {
    const productsMatchingBrand = brandFilter
      ? new Set(products.filter(p => p.brand_id === brandFilter).map(p => p.id))
      : null;
    const hasProductFilter = Boolean(brandFilter || skuFilter);
    const includedIds = new Set<string>();
    const rowsById = new Map(allRows.map(row => [row.id, row]));

    if (hasProductFilter) {
      for (const row of allRows) {
        if (row.type !== 'product') continue;
        if (productsMatchingBrand && !productsMatchingBrand.has(row.productId || row.id)) continue;
        if (skuFilter && row.sku !== skuFilter) continue;

        let current: TableRow | undefined = row;
        while (current) {
          includedIds.add(current.id);
          current = current.parent ? rowsById.get(current.parent) : undefined;
        }
      }
    }

    const result: TableRow[] = [];
    const walk = (rows: TableRow[]) => {
      for (const row of rows) {
        const isIncluded = !hasProductFilter || includedIds.has(row.id);
        if (isIncluded) {
          result.push(row);
          const children = sortDashboardSiblingsByOrders(allRows.filter(r => r.parent === row.id));
          const shouldExpand = expanded.has(row.id) || (hasProductFilter && children.some(child => includedIds.has(child.id)));
          if (shouldExpand && children.length) {
            walk(children);
          }
        }
      }
    };
    walk(allRows.filter(r => r.parent === null));
    return result;
  }, [allRows, products, brandFilter, skuFilter, expanded]);

  const totalRow = useMemo(() => {
    if (!visible.length) return null;
    const rootRows = allRows.filter(r => r.parent === null);
    if (rootRows.length === 1) return rootRows[0];
    const total = emptyMetrics();
    for (const r of rootRows) {
      addTo(total, r.current);
    }
    return { id: 'total', type: 'cabinet' as const, name: 'Итого', parent: null, depth: 0, current: total, previous: total };
  }, [allRows, visible]);

  // Raw daily data per product (last 7 days of periodA)
  const rawMetrics = useMemo(() => getMetrics(), [version]);
  const groupHistory = useMemo(() => getGroupMembershipHistory(), [version]);
  const memberships = useMemo(() => getMemberships(), [version]);
  const productDays = useMemo(() => {
    const map = new Map<string, AggDay[]>();
    for (const m of rawMetrics) {
      if (m.date < last7Start || m.date > periodA.end) continue;
      const arr = map.get(m.product_id) || [];
      arr.push(toAggDay(m));
      map.set(m.product_id, arr);
    }
    // Merge profitability records by date
    const allProfitability = getProfitabilityRecords();
    for (const r of allProfitability) {
      if (r.period_start < last7Start || r.period_start > periodA.end) continue;
      const arr = map.get(r.product_id) || [];
      const existing = arr.find(a => a.date === r.period_start);
      const extraExpensePct = getCabinetExtraExpense(r.period_start.slice(0, 7), products.find(product => product.id === r.product_id)?.cabinet_id || '');
      const reportProfit = getReportNetProfit(r, extraExpensePct);
      if (existing) {
        existing.actual_profit = reportProfit;
        existing.profit_revenue = r.profit_revenue;
      } else {
        arr.push({ date: r.period_start, impressions: 0, clicks: 0, carts: 0, orders: 0, ordered_amount: 0, buyout_amount: 0, ad_spend: 0, actual_profit: reportProfit, profit_revenue: r.profit_revenue });
        map.set(r.product_id, arr);
      }
    }
    for (const [, arr] of map) {
      arr.sort((a, b) => a.date.localeCompare(b.date));
    }
    return map;
  }, [rawMetrics, last7Start, periodA]);

  // Get AggDay[] for a row (product: direct, group/cabinet: aggregate children)
  function getRowDays(rowId: string, rowType: string): AggDay[] {
    if (rowType === 'product') {
      const row = allRows.find(item => item.id === rowId);
      const productId = row?.productId || rowId;
      const days = productDays.get(productId) || [];
      if (!row?.groupId) return days;
      return days.filter(day => {
        const resolution = resolveGroupAtDate(productId, day.date, groupHistory, memberships);
        return resolution.known && resolution.groupId === row.groupId;
      });
    }
    const children = allRows.filter(r => r.parent === rowId);
    if (!children.length) return [];
    const merged = new Map<string, AggDay>();
    for (const child of children) {
      const cd = getRowDays(child.id, child.type);
      for (const d of cd) {
        if (merged.has(d.date)) {
          merged.set(d.date, addAggDay(merged.get(d.date)!, d));
        } else {
          merged.set(d.date, { ...d });
        }
      }
    }
    const sorted = Array.from(merged.values()).sort((a, b) => a.date.localeCompare(b.date));
    return sorted;
  }

  // Memoize chart data per visible row to avoid recomputation
  const rowChartCache = useMemo(() => {
    const cache = new Map<string, Map<string, number[]>>();
    for (const row of visible) {
      const days = getRowDays(row.id, row.type);
      const perMetric = new Map<string, number[]>();
      for (const key of chartMetrics) {
        perMetric.set(key, days.map(d => metricFromDay(d, key)));
      }
      cache.set(row.id, perMetric);
    }
    return cache;
  }, [visible, productDays, chartMetrics, groupHistory, memberships]);

  const rowDateCache = useMemo(() => {
    const cache = new Map<string, string[]>();
    for (const row of visible) {
      cache.set(row.id, getRowDays(row.id, row.type).map(d => d.date));
    }
    return cache;
  }, [visible, productDays, groupHistory, memberships]);

  // Per-product month metrics (monthStart – periodA.end)
  const productMonthMetrics = useMemo(() => {
    const planMap = getPlanMap(monthStart);
    const map = new Map<string, MetricValues>();
    for (const p of products) {
      const s = sumForProduct(p.id, monthStart, periodA.end, planMap, p.sku);
      if (s) map.set(p.id, mockToMetrics(s));
    }
    return map;
  }, [version, monthStart, periodA]);

  // Month metrics for each visible row (product: direct, group/cabinet: aggregate children)
  const rowMonthCache = useMemo(() => {
    const cache = new Map<string, MetricValues>();
    function getMM(rowId: string, rowType: string): MetricValues {
      const cached = cache.get(rowId);
      if (cached) return cached;
      if (rowType === 'product') {
        const row = allRows.find(item => item.id === rowId);
        const productId = row?.productId || rowId;
        const m = row?.groupId
          ? (() => {
            const product = products.find(item => item.id === productId);
            const sum = product ? sumForProduct(productId, monthStart, periodA.end, getPlanMap(monthStart), product.sku, undefined, row.groupId, groupHistory, memberships) : null;
            return sum ? mockToMetrics(sum) : undefined;
          })()
          : productMonthMetrics.get(productId);
        const r = m ? { ...m } : emptyMetrics();
        cache.set(rowId, r);
        return r;
      }
      const children = allRows.filter(r => r.parent === rowId);
      if (!children.length) {
        const r = emptyMetrics();
        cache.set(rowId, r);
        return r;
      }
      const acc = emptyMetrics();
      for (const child of children) {
        addTo(acc, getMM(child.id, child.type));
      }
      cache.set(rowId, acc);
      return acc;
    }
    for (const row of visible) getMM(row.id, row.type);
    return cache;
  }, [productMonthMetrics, allRows, visible, products, monthStart, periodA, groupHistory, memberships]);

  const daysInMonth = (dateStr: string) => {
    const [year, month] = dateStr.slice(0, 7).split('-').map(Number);
    return new Date(year, month, 0).getDate();
  };
  const daysInPeriod = (start: string, end: string) => {
    const s = new Date(start), e = new Date(end);
    return Math.floor((e.getTime() - s.getTime()) / 86400000) + 1;
  };

  function planCell(row: TableRow, key: string) {
    if (row.type === 'group' || row.type === 'product') return <td key={`plan-${row.id}-${key}`} className="at-td at-plan-cell">—</td>;
    const curr = rowMonthCache.get(row.id) || row.current;
    const isTotal = row.id === 'total' || row.name === 'Итого';
    const scope = isTotal ? {} : row.type === 'category'
      ? { cabinetId: row.parent || '', category: row.name }
      : { cabinetId: row.id };
    const effectivePlan = getEffectivePlanMetrics(monthStart.slice(0, 7), scope);
    const plan = key === 'orders' ? effectivePlan.ordersQty
      : key === 'fact_orders' ? effectivePlan.ordersSum
      : key === 'profit' ? effectivePlan.netProfit
      : key === 'revenue' ? effectivePlan.buyoutAmount
      : key === 'avg_price' ? effectivePlan.avgCheck
      : key === 'margin' ? effectivePlan.profitability
      : null;
    const fact = (curr as any)[key] as number;

    if (!effectivePlan.hasData || plan === null) return <td key={`plan-${row.id}-${key}`} className="at-td at-plan-cell">—</td>;

    if (key === 'avg_price' || key === 'margin') {
      const cf = METRIC_CFG[key];
      const planDisplay = cf.decimals ? f1(plan) : f(plan);
      const factDisplay = cf.decimals ? f1(fact) : f(fact);
      return (
        <td key={`plan-${row.id}-${key}`} className="at-td at-plan-cell">
          <span className="at-plan-label">План: {planDisplay}{cf.suffix}</span>
          <span className="at-plan-fact">Факт: {factDisplay}{cf.suffix} ср.</span>
        </td>
      );
    }

    const pct = plan ? (fact / plan) * 100 : 0;
    const rowDays = row.id === 'total' ? [] : getRowDays(row.id, row.type).filter(day => day.date >= monthStart && day.date <= periodA.end);
    const last7 = rowDays.slice(-7);
    const last7Average = last7.length ? last7.reduce((sum, day) => sum + metricFromDay(day, key), 0) / last7.length : 0;
    const days = daysInPeriod(monthStart, periodA.end);
    const monthDays = daysInMonth(monthStart);
    const factPerDay = last7Average || (days ? fact / days : 0);
    const forecast = fact + factPerDay * Math.max(0, monthDays - days);
    const forecastPct = plan ? (forecast / plan - 1) * 100 : 0;
    const barW = Math.min(pct, 100);
    const cf = METRIC_CFG[key];
    const dayPlan = plan / monthDays;
    return (
      <td key={`plan-${row.id}-${key}`} className="at-td at-plan-cell">
        <div className="at-plan-bar-wrap">
          <div className="at-plan-bar" style={{ width: `${barW}%` }}></div>
        </div>
        <span className="at-plan-pct">{f1(pct)}%</span>
        <span className="at-plan-forecast">Прогноз {forecastPct >= 0 ? '+' : ''}{f1(forecastPct)}% · {f(forecast)}{cf.suffix}</span>
        {isFinite(dayPlan) && <span className="at-plan-day">Факт {shortFmt(factPerDay)} / план {shortFmt(dayPlan)}{cf.suffix}/день</span>}
      </td>
    );
  }

  function cell(row: TableRow, key: string) {
    const curr = (row.current as any)[key] as number;
    const prev = (row.previous as any)[key] as number;
    const change = pctChange(curr, prev);
    const cfg = METRIC_CFG[key];
    const v = formatMetricValue(curr, key, cfg.decimals);
    const display = v + cfg.suffix;
    const isGood = change !== null && (cfg.rev ? change < 0 : change >= 0);

    return (
      <td key={key} className={`at-td at-mcell${key === 'drr' ? ' at-drr-cell' : ''}${focusedMetric === key ? ' at-metric-focused' : ''}`}>
        <span className={`at-mv${cfg.primary ? ' primary' : ''}`}>{display}</span>
        {change !== null && (
          <span className={`at-mc ${isGood ? 'up' : 'down'} ${Math.abs(change) < 0.01 ? 'flat' : ''}`}>
            {change > 0 ? '+' : ''}{f1(change)}%
          </span>
        )}
      </td>
    );
  }

  return (
    <div className="table-container">
      <table className="at">
        <thead>
          <tr className="at-header">
            <th className="at-th at-left-top" rowSpan={2}>Товар / группа</th>
            {visibleGroups.map(g => {
              const chartExtra = g.keys.filter(k => chartMetrics.has(k)).length;
              const planExtra = g.keys.filter(k => planMetrics.has(k) && PLAN_KEYS.has(k)).length;
              return (
                <th key={g.label} className="at-group" colSpan={g.keys.length + chartExtra + planExtra}>{g.label}</th>
              );
            })}
          </tr>
          <tr className="at-subheader">
            {visibleGroups.flatMap(g => g.keys.flatMap(key => {
              const chartActive = chartMetrics.has(key);
              const planActive = planMetrics.has(key) && PLAN_KEYS.has(key);
              return [
                <th key={key} className={`at-th at-metric${key === 'drr' ? ' at-metric-drr' : ''}${chartActive ? ' at-metric-chart-on' : ''}${focusedMetric === key ? ' at-metric-focused' : ''}`}>
                  {TABLE_METRIC_LABELS[key]}
                  <span className={`at-chart-btn${chartActive ? ' active' : ''}`} onClick={() => toggleChart(key)}>
                    <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                      <rect x="1" y="6" width="2" height="5" rx="0.5" fill="currentColor"/>
                      <rect x="5" y="3" width="2" height="8" rx="0.5" fill="currentColor"/>
                      <rect x="9" y="1" width="2" height="10" rx="0.5" fill="currentColor"/>
                    </svg>
                  </span>
                  {PLAN_KEYS.has(key) && (
                    <span className={`at-plan-btn${planActive ? ' active' : ''}`} onClick={() => togglePlan(key)}>
                      <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                        <rect x="1" y="2" width="10" height="2" rx="0.5" fill="currentColor"/>
                        <rect x="1" y="6" width="7" height="2" rx="0.5" fill="currentColor"/>
                        <rect x="1" y="10" width="4" height="2" rx="0.5" fill="currentColor"/>
                      </svg>
                    </span>
                  )}
                </th>,
                chartActive && <th key={`chart-${key}`} className="at-th at-chart-th"></th>,
                planActive && <th key={`plan-${key}`} className="at-th at-plan-th"></th>,
              ];
            }))}
          </tr>
        </thead>
        <tbody>
          {visible.map(row => {
            const children = allRows.filter(r => r.parent === row.id);
            const hasChildren = children.length > 0;
            const isExpanded = expanded.has(row.id);
            const imgSku = row.type === 'product' ? productToWbSku.get(row.productId || row.id) : undefined;
            const hasDistinctProductName = row.type !== 'product'
              || Boolean(row.name?.trim() && row.name.trim() !== row.sku?.trim());

            return (
              <tr key={row.id} className={`at-row at-row-${row.type}`}>
                <td className="at-td at-product-cell">
                  <div className="at-product-inner">
                    <div className="at-product-indent" style={{ width: row.depth * 14 }} />
                    <button
                      type="button"
                      className={`at-expand${hasChildren ? '' : ' at-expand-placeholder'}`}
                      onClick={() => hasChildren && toggleRow(row.id)}
                      aria-label={hasChildren ? (isExpanded ? 'Свернуть' : 'Развернуть') : undefined}
                    >
                      {hasChildren ? (isExpanded ? '−' : '+') : ''}
                    </button>
                    <div className={`at-product-media${row.type === 'product' ? ' at-product-open' : ''}`} onClick={() => row.type === 'product' && onProductOpen?.(row.productId || row.id)}>
                      {row.type === 'product' && row.sku ? (
                        <>
                          <span className="at-image-fallback" aria-hidden="true">Т</span>
                          {imgSku && (
                            <img className="at-photo-img"
                              src={getWbImageUrls(imgSku)[0] || ''}
                              alt=""
                              loading="lazy"
                              decoding="async"
                              data-url-index="0"
                              onLoad={e => {
                                const img = e.currentTarget;
                                rememberWbImageUrl(imgSku, img.currentSrc || img.src);
                              }}
                              onError={e => {
                                const img = e.currentTarget;
                                const urls = getWbImageUrls(imgSku);
                                const nextIndex = Number(img.dataset.urlIndex || '0') + 1;
                                if (nextIndex < urls.length) {
                                  img.dataset.urlIndex = String(nextIndex);
                                  img.src = urls[nextIndex];
                                } else {
                                  img.style.display = 'none';
                                }
                              }}
                            />
                          )}
                        </>
                      ) : (
                        <span className={`at-entity-icon at-entity-${row.type}`}>{row.type === 'cabinet' ? 'К' : 'Г'}</span>
                      )}
                    </div>
                    <div className={`at-product-info${hasDistinctProductName ? '' : ' at-product-info-compact'}${row.type === 'product' ? ' at-product-open' : ''}`} onClick={() => row.type === 'product' && onProductOpen?.(row.productId || row.id)}>
                      {hasDistinctProductName && <span className={`at-product-name at-product-name-${row.type}`}>{row.name}</span>}
                      <span className="at-product-meta">
                        {row.type === 'product'
                          ? <>
                              <span className="at-sku-chip">{row.sku}</span>
                              {imgSku && imgSku !== row.sku && <span className="at-wb-id">WB {imgSku}</span>}
                            </>
                          : row.type === 'cabinet' ? 'Кабинет' : 'Группа товаров'}
                      </span>
                    </div>
                  </div>
                </td>
                {visibleGroups.flatMap(g => g.keys.flatMap(key => {
                  const chartVals = rowChartCache.get(row.id)?.get(key);
                  const chartDates = rowDateCache.get(row.id);
                  const planActive = planMetrics.has(key) && PLAN_KEYS.has(key);
                  return [
                    cell(row, key),
                    chartVals && chartDates && chartMetrics.has(key) && (
                      <td key={`chart-${row.id}-${key}`} className="at-td at-chart-cell">
                        <MiniBarChart values={chartVals} dates={chartDates} metricKey={key} />
                      </td>
                    ),
                    planActive && planCell(row, key),
                  ];
                }))}
              </tr>
            );
          })}
        </tbody>
        {totalRow && (
          <tfoot>
            <tr className="at-row at-total">
              <td className="at-td at-product-cell">
                <div className="at-product-inner at-total-label">Итого</div>
              </td>
              {visibleGroups.flatMap(g => g.keys.flatMap(key => {
                const chartActive = chartMetrics.has(key);
                const planActive = planMetrics.has(key) && PLAN_KEYS.has(key);
                return [
                  cell(totalRow, key),
                  chartActive && <td key={`chart-${key}`} className="at-td at-chart-cell"></td>,
                  planActive && planCell(totalRow, key),
                ];
              }))}
            </tr>
          </tfoot>
        )}
      </table>
    </div>
  );
}
