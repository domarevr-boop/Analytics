import type { MetricValues, TableRow } from '../types';
import type { ProductGroup } from '../types';
import { getProducts, getMetrics, getBrands, getGroups, getMemberships, getCabinets, getMonthlyPlansForMonth, UNGROUPED_GROUP_ID } from './store';
import { addDays, formatDate } from './dateUtils';
const DEV = import.meta.env.DEV;
const _zeroLogged = new Set<string>();

export interface DatePeriod {
  start: string;
  end: string;
}

export { addDays, formatDate, monthToPeriod, getDefaultMonth, toDate, toStr } from './dateUtils';

export function getDefaultPeriods(fallbackMaxDate?: string): { a: DatePeriod; b: DatePeriod; maxDate: string } {
  const metrics = getMetrics();
  if (!metrics.length) {
    const now = new Date();
    const today = formatDate(now);
    return {
      a: { start: addDays(today, -29), end: today },
      b: { start: addDays(today, -59), end: addDays(today, -30) },
      maxDate: today,
    };
  }
  let maxDate = metrics[0].date;
  for (const m of metrics) {
    if (m.date > maxDate) maxDate = m.date;
  }
  if (fallbackMaxDate && fallbackMaxDate > maxDate) {
    maxDate = fallbackMaxDate;
  }
  const defPeriods = {
    a: { start: addDays(maxDate, -29), end: maxDate },
    b: { start: addDays(maxDate, -59), end: addDays(maxDate, -30) },
    maxDate,
  };
  if (DEV) console.log('[getDefaultPeriods] metrics=' + metrics.length + ' maxDate=' + maxDate + ' periodA=' + JSON.stringify(defPeriods.a));
  return defPeriods;
}

export interface PlanData {
  totalRubles: number; totalQty: number; checkAmount: number;
  totalNetProfit: number; profitability: number; buyoutRate: number;
}

export function getPlanMap(periodStart: string): Map<string, PlanData> {
  const month = periodStart.slice(0, 7);
  const plans = getMonthlyPlansForMonth(month);
  const map = new Map<string, PlanData>();
  for (const p of plans) {
    map.set(p.sku, {
      totalRubles: p.totalRubles, totalQty: p.totalQty,
      checkAmount: p.checkAmount, totalNetProfit: p.totalNetProfit,
      profitability: p.profitability, buyoutRate: p.buyoutRate,
    });
  }
  return map;
}

export function sumForProduct(productId: string, start: string, end: string, planMap?: Map<string, PlanData>, productSku?: string) {
  const allMetrics = getMetrics();
  const rows = allMetrics.filter(m => m.product_id === productId && m.date >= start && m.date <= end);
  if (rows.length === 0) {
    const key = start + '|' + end;
    if (!_zeroLogged.has(key)) {
      _zeroLogged.add(key);
      const dates = [...new Set(allMetrics.map(m => m.date))].sort();
      if (DEV) console.warn('[sumForProduct] ZERO (first per range): start=' + start + ' end=' + end + ' storeMetrics=' + allMetrics.length + ' storeDateRange=' + (dates.length ? dates[0] + '..' + dates[dates.length-1] : 'empty'));
    }
  }
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
    planOrdersQty: planData?.totalQty || 0,
    planSum: planRubles,
    planPrice: planData?.checkAmount || 0,
    planNetProfit: planData?.totalNetProfit || 0,
    planProfitability: planData?.profitability || 0,
    planRevenue: planRubles * (planBuyoutRate / 100),
  };
}

export function toMetrics(s: ReturnType<typeof sumForProduct>): MetricValues {
  return {
    impressions: s.imp, clicks: s.cl,
    ctr: s.imp ? (s.cl / s.imp) * 100 : 0, carts: s.cart,
    cr_cart: s.imp ? (s.cart / s.imp) * 100 : 0, orders: s.ord,
    avg_price: s.ord ? Math.round(s.ordAmt / s.ord) : 0,
    cr_order: s.imp ? (s.ord / s.imp) * 100 : 0, ad_spend: s.adSpend,
    ad_clicks: s.adCl, ad_orders: s.adOrd,
    cpc: s.adCl ? s.adSpend / s.adCl : 0, cpo: s.adOrd ? s.adSpend / s.adOrd : 0,
    drr: s.ordAmt ? (s.adSpend / s.ordAmt) * 100 : 0,
    drrForecast: s.drrForecast,
    drrActual: s.drrActual,
    plan_orders: s.plan, plan_orders_qty: s.planOrdersQty, plan_sum: s.planSum,
    plan_price: s.planPrice, plan_net_profit: s.planNetProfit,
    plan_profitability: s.planProfitability, plan_revenue: s.planRevenue,
    fact_orders: s.ordAmt,
    plan_pct: s.plan ? (s.ordAmt / s.plan) * 100 : 0,
    revenue: s.buyoutAmt, effectiveRevenue: s.effectiveRevenue, buyout_amount: s.buyoutAmt, profit: s.profit,
    margin: s.margin, stock: s.stock,
  };
}

function emptyMetrics(): MetricValues {
  return { impressions: 0, clicks: 0, ctr: 0, carts: 0, cr_cart: 0, orders: 0, avg_price: 0, cr_order: 0, ad_spend: 0, ad_clicks: 0, ad_orders: 0, cpc: 0, cpo: 0, drr: 0, drrForecast: 0, drrActual: 0, plan_orders: 0, plan_orders_qty: 0, plan_sum: 0, plan_price: 0, plan_net_profit: 0, plan_profitability: 0, plan_revenue: 0, fact_orders: 0, plan_pct: 0, revenue: 0, effectiveRevenue: 0, buyout_amount: 0, profit: 0, margin: 0, stock: 0 };
}

function addTo(a: MetricValues, b: MetricValues) {
  a.impressions += b.impressions; a.clicks += b.clicks;
  a.carts += b.carts; a.orders += b.orders;
  a.ad_spend += b.ad_spend; a.ad_clicks += b.ad_clicks; a.ad_orders += b.ad_orders;
  a.plan_orders += b.plan_orders; a.plan_orders_qty += b.plan_orders_qty; a.plan_sum += b.plan_sum; a.plan_net_profit += b.plan_net_profit; a.plan_revenue += b.plan_revenue;
  a.fact_orders += b.fact_orders;
  a.revenue += b.revenue; a.effectiveRevenue += b.effectiveRevenue; a.buyout_amount += b.buyout_amount; a.profit += b.profit; a.stock += b.stock;
}

/** Recompute derived metrics from summed raw values */
function recalcDerived(m: MetricValues) {
  m.ctr = m.impressions ? (m.clicks / m.impressions) * 100 : 0;
  m.cr_cart = m.impressions ? (m.carts / m.impressions) * 100 : 0;
  m.cr_order = m.impressions ? (m.orders / m.impressions) * 100 : 0;
  m.avg_price = m.orders ? Math.round(m.fact_orders / m.orders) : 0;
  m.plan_price = m.plan_orders_qty ? Math.round(m.plan_sum / m.plan_orders_qty) : 0;
  m.plan_profitability = m.plan_revenue ? (m.plan_net_profit / m.plan_revenue) * 100 : 0;
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
  const planMapA = getPlanMap(periodA.start);
  const planMapB = getPlanMap(periodB.start);

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
      const c = sumForProduct(pr.id, periodA.start, periodA.end, planMapA, pr.sku);
      const p = sumForProduct(pr.id, periodB.start, periodB.end, planMapB, pr.sku);
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
      const c = sumForProduct(pr.id, periodA.start, periodA.end, planMapA, pr.sku);
      const p = sumForProduct(pr.id, periodB.start, periodB.end, planMapB, pr.sku);
      const curr = c ? toMetrics(c) : emptyMetrics();
      const prev = p ? toMetrics(p) : emptyMetrics();
      rows.push({ id: pr.id, type: 'product', name: pr.name, sku: pr.sku, parent: null, depth: 0, current: curr, previous: prev });
      addTo(orphanCurr, curr); addTo(orphanPrev, prev);
    }
  }

  if (DEV) console.log('[getTableData] periodA=' + JSON.stringify(periodA) + ' periodB=' + JSON.stringify(periodB) + ' filters=' + JSON.stringify(filters) + ' totalRows=' + rows.length);
  return rows;
}

export function getFilteredKpi(periodA: DatePeriod, periodB: DatePeriod, filters: FilterOptions) {
  const products = getProducts();
  const memberships = getMemberships();
  const planMapA = getPlanMap(periodA.start);
  const planMapB = getPlanMap(periodB.start);

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

    const ca = sumForProduct(pr.id, periodA.start, periodA.end, planMapA, pr.sku);
    const cb = sumForProduct(pr.id, periodB.start, periodB.end, planMapB, pr.sku);
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
