import { useState, useMemo, useSyncExternalStore } from 'react';
import type { MetricValues, TableRow } from '../types';
import type { DailyMetrics } from '../types';
import { subscribe, getVersion, getProducts, getMetrics, UNGROUPED_GROUP_ID } from '../data/store';
import { getTableData, getHierarchy, sumForProduct, toMetrics as mockToMetrics, getPlanMap } from '../data/mock';
import type { DatePeriod } from '../data/mock';
import { getWbImageUrls } from '../data/images';

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
const shortFmt = (n: number): string => {
  if (n >= 1000000) return f1(n / 1000000) + 'м';
  if (n >= 1000) return f1(n / 1000) + 'к';
  return f(n);
};


function pctChange(curr: number, prev: number): number | null {
  if (prev === 0) return curr > 0 ? null : 0;
  return ((curr - prev) / prev) * 100;
}

const HEADER_GROUPS = [
  { label: 'Бизнес метрики', keys: ['fact_orders', 'orders', 'avg_price', 'profit', 'margin'] as const },
  { label: 'Воронка', keys: ['impressions', 'clicks', 'ctr', 'carts', 'cr_cart', 'cr_order'] as const },
  { label: 'Реклама', keys: ['ad_spend', 'drr'] as const },
  { label: 'Финансы', keys: ['revenue'] as const },
];

const LABELS: Record<string, string> = {
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
  ad_spend: { suffix: ' ₽', decimals: false, rev: false, primary: false },
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
  brandFilter: string;
  groupFilter: string;
  searchQuery: string;
  periodA: DatePeriod;
  periodB: DatePeriod;
}

const CHART_BAR_W = 18;
const CHART_BAR_H = 24;
const CHART_LABEL_H = 12;
const CHART_H = CHART_BAR_H + CHART_LABEL_H;
const CHART_W = 7 * CHART_BAR_W;

function formatDateLabel(dateStr: string): string {
  const p = dateStr.split('-');
  if (p.length === 3) return String(parseInt(p[2], 10));
  return dateStr;
}

function MiniBarChart({ values, dates, metricKey }: { values: number[]; dates: string[]; metricKey: string }) {
  const [hover, setHover] = useState<{ text: string; cx: number } | null>(null);
  const maxVal = Math.max(...values, 1);
  const cfg = METRIC_CFG[metricKey];
  const fmt = (v: number) => (cfg.decimals ? f1(v) : f(v)) + cfg.suffix;
  return (
    <div style={{ position: 'relative', display: 'inline-block' }}>
      <svg width={CHART_W} height={CHART_H} viewBox={`0 0 ${CHART_W} ${CHART_H}`} style={{ display: 'block' }}>
        {values.map((v, i) => {
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
          background: '#1e293b', color: '#fff',
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

export default function AnalyticsTable({ cabinetFilter, brandFilter, groupFilter, searchQuery, periodA, periodB }: Props) {
  const version = useSyncExternalStore(subscribe, getVersion);
  if (import.meta.env.DEV) console.log('[AnalyticsTable] render', { periodA, periodB, version });
  const filters = useMemo(() => {
    const f: Record<string, string> = {};
    if (cabinetFilter) f.cabinetId = cabinetFilter;
    if (brandFilter) f.brandId = brandFilter;
    if (groupFilter) f.groupId = groupFilter;
    return f;
  }, [cabinetFilter, brandFilter, groupFilter]);
  const allRows = useMemo(() => {
    const result = getTableData(periodA, periodB, filters);
    if (import.meta.env.DEV) console.log('[AnalyticsTable] allRows computed', { periodA, periodB, filters, rows: result.length });
    return result;
  }, [version, periodA, periodB, filters]);
  const hierarchy = useMemo(() => getHierarchy(), [version]);
  const products = useMemo(() => getProducts(), [version]);
  const skuToWbSku = useMemo(() => {
    const m = new Map<string, string>();
    for (const p of getProducts()) {
      if (p.wb_sku && p.wb_sku !== p.sku) m.set(p.sku, p.wb_sku);
    }
    return m;
  }, [version]);
  const monthStart = useMemo(() => periodA.end.slice(0, 7) + '-01', [periodA]);
  const last7Start = useMemo(() => {
    const d = new Date(periodA.end);
    d.setDate(d.getDate() - 6);
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }, [periodA]);

  const [expanded, setExpanded] = useState<Set<string>>(new Set([allRows[0]?.id]));
  const [chartMetrics, setChartMetrics] = useState<Set<string>>(new Set());
  const [planMetrics, setPlanMetrics] = useState<Set<string>>(new Set());

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

    const q = searchQuery.toLowerCase().trim();

    const matchingIds = new Set<string>();
    if (productsMatchingBrand) {
      for (const row of allRows) {
        if (row.type === 'product' && productsMatchingBrand.has(row.id)) {
          matchingIds.add(row.id);
          let parentId = row.parent;
          while (parentId) {
            matchingIds.add(parentId);
            const parent = allRows.find(r => r.id === parentId);
            parentId = parent?.parent || null;
          }
        }
      }
    }

    const result: TableRow[] = [];
    const walk = (rows: TableRow[]) => {
      for (const row of rows) {
        const matchCab = !cabinetFilter || row.id === cabinetFilter;
        const matchBrand = !brandFilter || matchingIds.has(row.id);
        const matchGroup = !groupFilter || row.id === groupFilter ||
          (groupFilter === UNGROUPED_GROUP_ID && row.id.endsWith('-' + UNGROUPED_GROUP_ID));

        const matchSearch = !q || (row.sku && (row.sku.toLowerCase().includes(q) || row.name.toLowerCase().includes(q)));
        if (matchCab && matchBrand && matchGroup) {
          if (q && row.type === 'product' && !matchSearch) continue;
          result.push(row);
          const children = allRows.filter(r => r.parent === row.id);
          if (expanded.has(row.id) && children.length) {
            if (brandFilter || q) {
              children.forEach(c => { if (!expanded.has(c.id)) expanded.add(c.id); });
            }
            walk(children);
          }
        }
      }
    };
    walk(allRows.filter(r => r.parent === null));
    return result;
  }, [allRows, hierarchy, cabinetFilter, brandFilter, groupFilter, searchQuery, expanded]);

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
  const productDays = useMemo(() => {
    const map = new Map<string, AggDay[]>();
    for (const m of rawMetrics) {
      if (m.date < last7Start || m.date > periodA.end) continue;
      const arr = map.get(m.product_id) || [];
      arr.push(toAggDay(m));
      map.set(m.product_id, arr);
    }
    for (const [, arr] of map) {
      arr.sort((a, b) => a.date.localeCompare(b.date));
    }
    return map;
  }, [rawMetrics, last7Start, periodA]);

  // Get AggDay[] for a row (product: direct, group/cabinet: aggregate children)
  function getRowDays(rowId: string, rowType: string): AggDay[] {
    if (rowType === 'product') return productDays.get(rowId) || [];
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
  }, [visible, productDays, chartMetrics]);

  const rowDateCache = useMemo(() => {
    const cache = new Map<string, string[]>();
    for (const row of visible) {
      cache.set(row.id, getRowDays(row.id, row.type).map(d => d.date));
    }
    return cache;
  }, [visible, productDays]);

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
        const m = productMonthMetrics.get(rowId);
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
  }, [productMonthMetrics, allRows, visible]);

  const daysInMonth = (dateStr: string) => new Date(dateStr.slice(0, 4) + '-' + dateStr.slice(5, 7) + '-01').getMonth() === 1 ? 28 : 31;
  const daysInPeriod = (start: string, end: string) => {
    const s = new Date(start), e = new Date(end);
    return Math.floor((e.getTime() - s.getTime()) / 86400000) + 1;
  };

  function planCell(row: TableRow, key: string) {
    const curr = rowMonthCache.get(row.id) || row.current;
    const planKey = key === 'orders' ? 'plan_orders_qty'
      : key === 'fact_orders' ? 'plan_sum'
      : key === 'profit' ? 'plan_net_profit'
      : key === 'revenue' ? 'plan_revenue'
      : key === 'avg_price' ? 'plan_price'
      : key === 'margin' ? 'plan_profitability'
      : 'plan_orders';
    const plan = (curr as any)[planKey] as number;
    const fact = (curr as any)[key] as number;

    if (plan === 0 || plan === undefined) return <td key={`plan-${row.id}-${key}`} className="at-td at-plan-cell">—</td>;

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
    const days = daysInPeriod(monthStart, periodA.end);
    const monthDays = daysInMonth(monthStart);
    const forecast = days ? (fact / days) * monthDays : 0;
    const forecastPct = plan ? (forecast / plan) * 100 : 0;
    const barW = Math.min(pct, 100);
    const cf = METRIC_CFG[key];
    const dayPlan = plan / monthDays;
    return (
      <td key={`plan-${row.id}-${key}`} className="at-td at-plan-cell">
        <div className="at-plan-bar-wrap">
          <div className="at-plan-bar" style={{ width: `${barW}%` }}></div>
        </div>
        <span className="at-plan-pct">{f1(pct)}%</span>
        <span className="at-plan-forecast">→ {f1(forecastPct)}% {f(forecast)}{cf.suffix}</span>
        {isFinite(dayPlan) && <span className="at-plan-day">{shortFmt(dayPlan)}{cf.suffix}/день</span>}
      </td>
    );
  }

  function cell(row: TableRow, key: string) {
    const curr = (row.current as any)[key] as number;
    const prev = (row.previous as any)[key] as number;
    const change = pctChange(curr, prev);
    const cfg = METRIC_CFG[key];
    const v = cfg.decimals ? f1(curr) : f(curr);
    const display = v + cfg.suffix;
    const isGood = change !== null && (cfg.rev ? change < 0 : change >= 0);

    return (
      <td key={key} className="at-td at-mcell">
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
            <th className="at-th at-left-top" rowSpan={2} colSpan={3}></th>
            {HEADER_GROUPS.map(g => {
              const chartExtra = g.keys.filter(k => chartMetrics.has(k)).length;
              const planExtra = g.keys.filter(k => planMetrics.has(k) && PLAN_KEYS.has(k)).length;
              return (
                <th key={g.label} className="at-group" colSpan={g.keys.length + chartExtra + planExtra}>{g.label}</th>
              );
            })}
          </tr>
          <tr className="at-subheader">
            {HEADER_GROUPS.flatMap(g => g.keys.flatMap(key => {
              const chartActive = chartMetrics.has(key);
              const planActive = planMetrics.has(key) && PLAN_KEYS.has(key);
              return [
                <th key={key} className={`at-th at-metric${chartActive ? ' at-metric-chart-on' : ''}`}>
                  {LABELS[key]}
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
            const imgSku = row.sku ? (skuToWbSku.get(row.sku) || row.sku) : undefined;

            return (
              <tr key={row.id} className={`at-row at-${row.type}`}>
                <td className="at-td at-toggle">
                  {hasChildren && (
                    <span className="at-expand" onClick={() => toggleRow(row.id)}>
                      {isExpanded ? '−' : '+'}
                    </span>
                  )}
                </td>
                <td className="at-td at-photo">
                  {row.type === 'product' && row.sku ? (
                    <img className="at-photo-img"
                      src={getWbImageUrls(imgSku!)[0] || ''}
                      alt=""
                      onError={e => {
                        const img = e.target as HTMLImageElement;
                        const urls = getWbImageUrls(imgSku!);
                        const idx = urls.indexOf(img.src);
                        if (idx < urls.length - 1) {
                          img.src = urls[idx + 1];
                        } else {
                          img.style.display = 'none';
                        }
                      }}
                    />
                  ) : (
                    <span className="photo-placeholder"></span>
                  )}
                </td>
                <td className="at-td at-name" style={{ paddingLeft: 8 + row.depth * 18 }}>
                  {row.type === 'product' ? (
                    <><span className="at-sku">{row.sku}</span> {row.name}</>
                  ) : (
                    <span className={`at-typename at-${row.type}`}>{row.name}</span>
                  )}
                </td>
                {HEADER_GROUPS.flatMap(g => g.keys.flatMap(key => {
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
              <td className="at-td at-toggle"></td>
              <td className="at-td at-photo"></td>
              <td className="at-td at-name">Итого</td>
              {HEADER_GROUPS.flatMap(g => g.keys.flatMap(key => {
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
