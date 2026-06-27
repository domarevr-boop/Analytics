import type { MetricValues, TableRow } from '../types';
import type { ProductGroup } from '../types';
import { getProducts, getMetrics, getBrands, getGroups, getMemberships, getCabinets, getMonthlyPlansForMonth, UNGROUPED_GROUP_ID } from './store';


function pad(n: number) { return n < 10 ? '0' + n : '' + n; }

export function formatDate(d: Date) {
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
}

function addDays(dateStr: string, days: number) {
  const d = new Date(dateStr);
  d.setDate(d.getDate() + days);
  return formatDate(d);
}

export interface DatePeriod {
  start: string;
  end: string;
}

export function monthToPeriod(month: string): DatePeriod {
  const [y, m] = month.split('-').map(Number);
  const lastDay = new Date(y, m, 0).getDate();
  return {
    start: `${month}-01`,
    end: `${month}-${String(lastDay).padStart(2, '0')}`,
  };
}

export function getDefaultMonth(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

export function getDefaultPeriods(): { a: DatePeriod; b: DatePeriod } {
  const metrics = getMetrics();
  if (!metrics.length) {
    const now = new Date();
    const today = formatDate(now);
    return {
      a: { start: addDays(today, -6), end: today },
      b: { start: addDays(today, -13), end: addDays(today, -7) },
    };
  }
  let maxDate = metrics[0].date;
  for (const m of metrics) {
    if (m.date > maxDate) maxDate = m.date;
  }
  return {
    a: { start: addDays(maxDate, -6), end: maxDate },
    b: { start: addDays(maxDate, -13), end: addDays(maxDate, -7) },
  };
}

function getPlanMap(periodStart: string): Map<string, { totalRubles: number; buyoutRate: number }> {
  const month = periodStart.slice(0, 7);
  const plans = getMonthlyPlansForMonth(month);
  const map = new Map();
  for (const p of plans) {
    map.set(p.sku, { totalRubles: p.totalRubles, buyoutRate: p.buyoutRate });
  }
  return map;
}

interface ProductInfo {
  sku: string;
}

function sumForProduct(productId: string, start: string, end: string, planMap?: Map<string, { totalRubles: number; buyoutRate: number }>, productSku?: string) {
  const rows = getMetrics().filter(m => m.product_id === productId && m.date >= start && m.date <= end);
  const total = (fn: (m: typeof rows[0]) => number) => rows.reduce((s, m) => s + fn(m), 0);
  const avg = (fn: (m: typeof rows[0]) => number) => rows.length ? total(fn) / rows.length : 0;
  const planData = productSku ? planMap?.get(productSku) : undefined;
  const planRubles = planData?.totalRubles || 0;
  const planBuyoutRate = planData?.buyoutRate || 85;
  const ordAmt = total(m => m.ordered_amount);
  const buyoutAmt = total(m => m.buyout_amount);
  const adSpend = total(m => m.ad_spend);
  const effectiveRevenue = ordAmt * (planBuyoutRate / 100);
  return {
    imp: total(m => m.impressions), cl: total(m => m.clicks),
    cart: total(m => m.carts), ord: total(m => m.orders),
    ordAmt, profit: total(m => m.actual_profit),
    margin: avg(m => m.actual_margin),
    adImp: total(m => m.ad_impressions), adCl: total(m => m.ad_clicks),
    adOrd: total(m => m.ad_orders), adSpend,
    buyoutAmt,
    plan: planRubles, planBuyoutRate: planRubles ? planBuyoutRate : 85, stock: avg(m => m.stock),
    drrForecast: effectiveRevenue ? (adSpend / effectiveRevenue) * 100 : 0,
    drrActual: buyoutAmt ? (adSpend / buyoutAmt) * 100 : 0,
    effectiveRevenue,
  };
}

function toMetrics(s: ReturnType<typeof sumForProduct>): MetricValues {
  return {
    impressions: s.imp, clicks: s.cl,
    ctr: s.imp ? (s.cl / s.imp) * 100 : 0, carts: s.cart,
    cr_cart: s.imp ? (s.cart / s.imp) * 100 : 0, orders: s.ord,
    cr_order: s.imp ? (s.ord / s.imp) * 100 : 0, ad_spend: s.adSpend,
    ad_clicks: s.adCl, ad_orders: s.adOrd,
    cpc: s.adCl ? s.adSpend / s.adCl : 0, cpo: s.adOrd ? s.adSpend / s.adOrd : 0,
    drr: s.ordAmt ? (s.adSpend / s.ordAmt) * 100 : 0,
    drrForecast: s.drrForecast,
    drrActual: s.drrActual,
    plan_orders: s.plan, fact_orders: s.ordAmt,
    plan_pct: s.plan ? (s.ordAmt / s.plan) * 100 : 0,
    revenue: s.buyoutAmt, effectiveRevenue: s.effectiveRevenue, buyout_amount: s.buyoutAmt, profit: s.profit,
    margin: s.margin * 100, stock: s.stock,
  };
}

function emptyMetrics(): MetricValues {
  return { impressions: 0, clicks: 0, ctr: 0, carts: 0, cr_cart: 0, orders: 0, cr_order: 0, ad_spend: 0, ad_clicks: 0, ad_orders: 0, cpc: 0, cpo: 0, drr: 0, drrForecast: 0, drrActual: 0, plan_orders: 0, fact_orders: 0, plan_pct: 0, revenue: 0, effectiveRevenue: 0, buyout_amount: 0, profit: 0, margin: 0, stock: 0 };
}

function addTo(a: MetricValues, b: MetricValues) {
  a.impressions += b.impressions; a.clicks += b.clicks;
  a.carts += b.carts; a.orders += b.orders;
  a.ad_spend += b.ad_spend; a.ad_clicks += b.ad_clicks; a.ad_orders += b.ad_orders;
  a.plan_orders += b.plan_orders; a.fact_orders += b.fact_orders;
  a.revenue += b.revenue; a.effectiveRevenue += b.effectiveRevenue; a.buyout_amount += b.buyout_amount; a.profit += b.profit; a.stock += b.stock;
}

/** Recompute derived metrics from summed raw values */
function recalcDerived(m: MetricValues) {
  m.ctr = m.impressions ? (m.clicks / m.impressions) * 100 : 0;
  m.cr_cart = m.impressions ? (m.carts / m.impressions) * 100 : 0;
  m.cr_order = m.impressions ? (m.orders / m.impressions) * 100 : 0;
  m.cpc = m.ad_clicks ? m.ad_spend / m.ad_clicks : 0;
  m.cpo = m.ad_orders ? m.ad_spend / m.ad_orders : 0;
  m.drr = m.fact_orders ? (m.ad_spend / m.fact_orders) * 100 : 0;
  m.drrForecast = m.effectiveRevenue ? (m.ad_spend / m.effectiveRevenue) * 100 : 0;
  m.drrActual = m.buyout_amount ? (m.ad_spend / m.buyout_amount) * 100 : 0;
  m.plan_pct = m.plan_orders ? (m.fact_orders / m.plan_orders) * 100 : 0;
  m.margin = m.revenue ? (m.profit / m.revenue) * 100 : 0;
}

export interface FilterOptions {
  cabinetId?: string;
  brandId?: string;
  groupId?: string;
}

/**
 * Build tree rows for the given periods and optional filters.
 */
export function getTableData(periodA: DatePeriod, periodB: DatePeriod, filters?: FilterOptions): TableRow[] {
  const products = getProducts();
  const groups = getGroups();
  const cabinets = getCabinets();
  const memberships = getMemberships();
  const planMap = getPlanMap(periodA.start);

  if (!products.length) return [];

  const brandProductIds = filters?.brandId
    ? new Set(products.filter(p => p.brand_id === filters.brandId).map(p => p.id))
    : null;

  const restrictGroupId = filters?.groupId;

  const ungroupedIds = new Set(memberships.filter(m => m.group_id === UNGROUPED_GROUP_ID).map(m => m.product_id));

  const matchProduct = (pid: string) => {
    if (brandProductIds && !brandProductIds.has(pid)) return false;
    return true;
  };

  const rows: TableRow[] = [];
  const visited = new Set<string>();

  const addProducts = (parentId: string, productList: typeof products, depth: number, accCurr: MetricValues, accPrev: MetricValues) => {
    for (const pr of productList) {
      visited.add(pr.id);
      const c = sumForProduct(pr.id, periodA.start, periodA.end, planMap, pr.sku);
      const p = sumForProduct(pr.id, periodB.start, periodB.end, planMap, pr.sku);
      const curr = c ? toMetrics(c) : emptyMetrics();
      const prev = p ? toMetrics(p) : emptyMetrics();
      rows.push({ id: pr.id, type: 'product', name: pr.name, sku: pr.sku, parent: parentId, depth, current: curr, previous: prev });
      addTo(accCurr, curr); addTo(accPrev, prev);
    }
  };

  for (const cab of cabinets) {
    if (filters?.cabinetId && cab.id !== filters.cabinetId) continue;

    const cabCurr = emptyMetrics(); const cabPrev = emptyMetrics();
    const cabGroups = groups.filter(g => g.cabinet_id === cab.id);

    const groupRows: { grp: ProductGroup; curr: MetricValues; prev: MetricValues }[] = [];
    for (const grp of cabGroups) {
      if (restrictGroupId && grp.id !== restrictGroupId) continue;

      const grpCurr = emptyMetrics(); const grpPrev = emptyMetrics();
      const grpProducts = products.filter(p =>
        memberships.some(m => m.product_id === p.id && m.group_id === grp.id) && matchProduct(p.id)
      );
      addProducts(grp.id, grpProducts, 2, grpCurr, grpPrev);
      recalcDerived(grpCurr); recalcDerived(grpPrev);

      groupRows.push({ grp, curr: grpCurr, prev: grpPrev });
    }

    groupRows.sort((a, b) => b.curr.revenue - a.curr.revenue);

    for (const { grp, curr, prev } of groupRows) {
      rows.push({ id: grp.id, type: 'group', name: grp.name, parent: cab.id, depth: 1, current: curr, previous: prev });
      addTo(cabCurr, curr); addTo(cabPrev, prev);
    }

    if (!restrictGroupId || restrictGroupId === UNGROUPED_GROUP_ID) {
      const ungroupedProducts = products.filter(p =>
        ungroupedIds.has(p.id) && p.cabinet_id === cab.id && !visited.has(p.id) && matchProduct(p.id)
      );
      if (ungroupedProducts.length > 0) {
        const grpCurr = emptyMetrics(); const grpPrev = emptyMetrics();
        const rowGrpId = cab.id + '-' + UNGROUPED_GROUP_ID;
        addProducts(rowGrpId, ungroupedProducts, 2, grpCurr, grpPrev);
        recalcDerived(grpCurr); recalcDerived(grpPrev);
        rows.push({ id: rowGrpId, type: 'group', name: 'Без склейки', parent: cab.id, depth: 1, current: grpCurr, previous: grpPrev });
        addTo(cabCurr, grpCurr); addTo(cabPrev, grpPrev);
      }
    }

    recalcDerived(cabCurr); recalcDerived(cabPrev);
    rows.push({ id: cab.id, type: 'cabinet', name: cab.name, parent: null, depth: 0, current: cabCurr, previous: cabPrev });
  }

  const orphanProducts = products.filter(p => !visited.has(p.id) && matchProduct(p.id));
  if (orphanProducts.length) {
    const orphanCurr = emptyMetrics(); const orphanPrev = emptyMetrics();
    for (const pr of orphanProducts) {
      visited.add(pr.id);
      const c = sumForProduct(pr.id, periodA.start, periodA.end, planMap, pr.sku);
      const p = sumForProduct(pr.id, periodB.start, periodB.end, planMap, pr.sku);
      const curr = c ? toMetrics(c) : emptyMetrics();
      const prev = p ? toMetrics(p) : emptyMetrics();
      rows.push({ id: pr.id, type: 'product', name: pr.name, sku: pr.sku, parent: null, depth: 0, current: curr, previous: prev });
      addTo(orphanCurr, curr); addTo(orphanPrev, prev);
    }
  }

  return rows;
}

export function getFilteredKpi(periodA: DatePeriod, periodB: DatePeriod, filters: FilterOptions) {
  const products = getProducts();
  const memberships = getMemberships();
  const planMap = getPlanMap(periodA.start);

  const brandProductIds = filters.brandId
    ? new Set(products.filter(p => p.brand_id === filters.brandId).map(p => p.id))
    : null;

  const groupProductIds = filters.groupId
    ? new Set(memberships.filter(m => m.group_id === filters.groupId).map(m => m.product_id))
    : null;

  const cabProductIds = filters.cabinetId
    ? new Set(products.filter(p => p.cabinet_id === filters.cabinetId).map(p => p.id))
    : null;

  const a = emptyMetrics();
  const b = emptyMetrics();

  for (const pr of products) {
    if (brandProductIds && !brandProductIds.has(pr.id)) continue;
    if (groupProductIds && !groupProductIds.has(pr.id)) continue;
    if (cabProductIds && !cabProductIds.has(pr.id)) continue;

    const ca = sumForProduct(pr.id, periodA.start, periodA.end, planMap, pr.sku);
    const cb = sumForProduct(pr.id, periodB.start, periodB.end, planMap, pr.sku);
    if (ca) addTo(a, toMetrics(ca));
    if (cb) addTo(b, toMetrics(cb));
  }

  return { current: a, previous: b };
}

export function getHierarchy(): Record<string, string[]> {
  const cabinets = getCabinets();
  const groups = getGroups();
  const memberships = getMemberships();
  const map: Record<string, string[]> = {};
  for (const cab of cabinets) {
    const cabGroups = groups.filter(g => g.cabinet_id === cab.id);
    map[cab.id] = cabGroups.map(g => g.id);
  }
  for (const g of groups) {
    if (!map[g.id]) map[g.id] = [];
  }
  for (const m of memberships) {
    if (!map[m.group_id]) map[m.group_id] = [];
    if (!map[m.group_id].includes(m.product_id)) map[m.group_id].push(m.product_id);
  }
  return map;
}

export const getCabs = () => getCabinets();
export const getBrs = () => getBrands();
export const getGrps = () => getGroups();
