import type { MetricValues, TableRow, Product } from '../types';
import { getProducts, getMetrics, getBrands, getGroups, getMemberships, getCabinets, getMonthlyPlansForMonth, getProfitabilityRecords, getGroupMembershipHistory, UNGROUPED_GROUP_ID } from './store';
import { getCabinetExtraExpense } from './profitStore';
import { getReportGrossProfit } from './profitabilityCalculations';
import { addDays, formatDate } from './dateUtils';
import { getFilteredProductIds } from './productFilters';
import { resolveGroupAtDate } from './groupMembershipHistory';
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
      a: { start: today, end: today },
      b: { start: addDays(today, -1), end: addDays(today, -1) },
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
    a: { start: maxDate, end: maxDate },
    b: { start: addDays(maxDate, -1), end: addDays(maxDate, -1) },
    maxDate,
  };
  if (DEV) console.log('[getDefaultPeriods] metrics=' + metrics.length + ' maxDate=' + maxDate + ' periodA=' + JSON.stringify(defPeriods.a));
  return defPeriods;
}

export interface PlanData {
  totalRubles: number; totalQty: number; checkAmount: number;
  totalNetProfit: number; profitability: number; buyoutRate: number;
}

function canonicalSku(value: string | undefined) {
  return String(value || '')
    .replace(/\u00a0/g, ' ')
    .trim()
    .replace(/\.0+$/, '')
    .replace(/\s*\(\d+\)\s*$/, '');
}

function productIdentityValues(product: Product) {
  return [...new Set([
    product.sku,
    product.wb_sku,
    ...(product.aliases || []),
    canonicalSku(product.sku),
  ].map(value => String(value || '').trim()).filter(Boolean))];
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

export function sumForProduct(productId: string, start: string, end: string, planMap?: Map<string, PlanData>, productSku?: string, relatedProductIds?: Iterable<string>, groupId?: string, groupHistory = getGroupMembershipHistory(), legacyMemberships = getMemberships()) {
  const allMetrics = getMetrics();
  const products = getProducts();
  const product = products.find(p => p.id === productId);
  const cabinetId = product?.cabinet_id || '';
  const month = start.slice(0, 7);
  const extraExpensePct = getCabinetExtraExpense(month, cabinetId);

  const productIds = new Set(relatedProductIds || [productId]);
  productIds.add(productId);
  const rows = allMetrics.filter(m => productIds.has(m.product_id) && m.date >= start && m.date <= end && (!groupId || (() => { const resolution = resolveGroupAtDate(m.product_id, m.date, groupHistory, legacyMemberships); return resolution.known && resolution.groupId === groupId; })()));
  const profitabilityRows = getProfitabilityRecords().filter(record =>
    productIds.has(record.product_id)
    && record.period_end >= start
    && record.period_start <= end
    && (!groupId || (() => {
      const resolution = resolveGroupAtDate(record.product_id, record.period_start, groupHistory, legacyMemberships);
      return resolution.known && resolution.groupId === groupId;
    })())
  );
  
  if (rows.length === 0) {
    const key = start + '|' + end;
    if (!_zeroLogged.has(key)) {
      _zeroLogged.add(key);
      const dates = [...new Set(allMetrics.map(m => m.date))].sort();
      if (DEV) console.warn('[sumForProduct] ZERO (first per range): start=' + start + ' end=' + end + ' storeMetrics=' + allMetrics.length + ' storeDateRange=' + (dates.length ? dates[0] + '..' + dates[dates.length-1] : 'empty'));
    }
  }

  // Aggregate from _metrics
  const total = (fn: (m: typeof rows[0]) => number) => rows.reduce((s, m) => s + fn(m), 0);
  const avg = (fn: (m: typeof rows[0]) => number) => rows.length ? total(fn) / rows.length : 0;

  const planData = productSku ? planMap?.get(productSku) : undefined;
  const planRubles = planData?.totalRubles || 0;
  const planBuyoutRate = planData?.buyoutRate || 85;
  const ordAmt = total(m => m.ordered_amount);
  const buyoutAmt = total(m => m.buyout_amount);
  const adSpend = total(m => m.ad_spend);
  
  const agentFee = total(m => m.agent_fee || 0);
  const logisticsCost = total(m => m.logistics_cost || 0);
  const marketingCost = total(m => m.marketing_cost || 0);
  const storageCost = total(m => m.storage_cost || 0);
  
  const reportRevenue = profitabilityRows.reduce((sum, record) => sum + record.profit_revenue, 0);
  const reportGrossProfit = profitabilityRows.reduce((sum, record) => sum + getReportGrossProfit(record), 0);
  const hasProfitabilityReport = profitabilityRows.length > 0;
  const revenue = reportRevenue || total(m => m.profit_revenue || 0);
  const cost = total(m => m.cost || 0);
  const fallbackGrossProfit = revenue - cost - agentFee - logisticsCost - marketingCost - storageCost;
  const grossProfit = hasProfitabilityReport ? reportGrossProfit : fallbackGrossProfit;
  const extraExpenseAmount = revenue * (extraExpensePct / 100);
  const profit = hasProfitabilityReport ? grossProfit - extraExpenseAmount : 0;
  
  const margin = hasProfitabilityReport && revenue ? (profit / revenue) * 100 : 0;
  const effectiveRevenue = ordAmt * (planBuyoutRate / 100);

  return {
    imp: total(m => m.impressions), cl: total(m => m.clicks),
    cart: total(m => m.carts), ord: total(m => m.orders),
    ordAmt, profit,
    margin,
    profit_revenue: revenue,
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
    revenue: s.profit_revenue, effectiveRevenue: s.effectiveRevenue, buyout_amount: s.buyoutAmt, profit: s.profit,
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
  category?: string;
  brandId?: string;
  groupId?: string;
  sku?: string;
}

export function getTableData(periodA: DatePeriod, periodB: DatePeriod, filters?: FilterOptions): TableRow[] {
  return getCategoryTableData(periodA, periodB, filters);
}

function getCategoryTableData(periodA: DatePeriod, periodB: DatePeriod, filters?: FilterOptions): TableRow[] {
  const products = getProducts(); const groups = getGroups(); const cabinets = getCabinets(); const memberships = getMemberships();
  const planA = getPlanMap(periodA.start); const planB = getPlanMap(periodB.start);
  const productById = new Map(products.map(product => [product.id, product]));
  
  const productIdsByExternalId = new Map<string, Set<string>>();
  for (const product of products) {
    for (const value of productIdentityValues(product)) {
      const key = String(value || '').trim();
      if (!key) continue;
      const productIds = productIdsByExternalId.get(key) || new Set<string>();
      productIds.add(product.id);
      productIdsByExternalId.set(key, productIds);
    }
  }

  const linkedProductIds = new Map<string, Set<string>>();
  
  const canonicalProduct = (product: Product) => {
    const known = linkedProductIds.get(product.id);
    if (known) {
      return [...known]
        .map(productId => productById.get(productId)!)
        .sort((left, right) => {
          const score = (item: Product) => Number(Boolean(item.cabinet_id)) * 4 + Number(Boolean(item.category)) * 2 + Number(Boolean(item.brand_id));
          return score(right) - score(left) || left.id.localeCompare(right.id);
        })[0] || product;
    }
    const connected = new Set<string>([product.id]);
    const queue = [product.id];
    while (queue.length) {
      const current = productById.get(queue.pop()!);
      if (!current) continue;
      for (const value of productIdentityValues(current)) {
        const matches = productIdsByExternalId.get(String(value || '').trim());
        if (!matches) continue;
        for (const productId of matches) {
          if (connected.has(productId)) continue;
          connected.add(productId);
          queue.push(productId);
        }
      }
    }
    for (const productId of connected) linkedProductIds.set(productId, connected);
    return [...connected]
      .map(productId => productById.get(productId)!)
      .sort((left, right) => {
        const score = (item: Product) => Number(Boolean(item.cabinet_id)) * 4 + Number(Boolean(item.category)) * 2 + Number(Boolean(item.brand_id));
        return score(right) - score(left) || left.id.localeCompare(right.id);
      })[0] || product;
  };
  for (const product of products) canonicalProduct(product);
  const canonicalProducts = products.filter(product => canonicalProduct(product).id === product.id && product.cabinet_id);
  const canonicalMemberships = memberships.reduce<typeof memberships>((result, membership) => {
    const product = productById.get(membership.product_id);
    if (!product) return result;
    const canonical = canonicalProduct(product);
    if (!result.some(item => item.product_id === canonical.id && item.group_id === membership.group_id)) result.push({ product_id: canonical.id, group_id: membership.group_id });
    return result;
  }, []);
  const groupHistory = getGroupMembershipHistory();
  const allowed = getFilteredProductIds(canonicalProducts, canonicalMemberships, { cabinetFilter: filters?.cabinetId, categoryFilter: filters?.category, brandFilter: filters?.brandId, groupFilter: filters?.groupId, skuFilter: filters?.sku }, { groupHistory, period: { start: periodB.start < periodA.start ? periodB.start : periodA.start, end: periodA.end > periodB.end ? periodA.end : periodB.end } });
  const cabinetForProduct = (product: Product) => canonicalProduct(product).cabinet_id;
  const categoryForProduct = (product: Product) => canonicalProduct(product).category || 'Без категории';
  const groupIdsForProduct = (product: Product) => {
    const canonicalId = canonicalProduct(product).id;
    if (!groupHistory.length) return new Set(canonicalMemberships.filter(item => item.product_id === canonicalId).map(item => item.group_id || UNGROUPED_GROUP_ID));
    const dates = getMetrics().filter(row => row.product_id === canonicalId && row.date >= periodB.start && row.date <= periodA.end).map(row => row.date);
    const ids = new Set<string>();
    for (const date of dates) {
      const resolution = resolveGroupAtDate(canonicalId, date, groupHistory, canonicalMemberships);
      if (resolution.known && resolution.groupId) ids.add(resolution.groupId);
    }
    return ids;
  };
  const rows: TableRow[] = [];
  const productMetrics = (product: Product) => {
    const relatedProductIds = linkedProductIds.get(product.id) || new Set([product.id]);
    return {
      current: (groupId?: string) => { const value = sumForProduct(product.id, periodA.start, periodA.end, planA, product.sku, relatedProductIds, groupId, groupHistory, canonicalMemberships); return value ? toMetrics(value) : emptyMetrics(); },
      previous: (groupId?: string) => { const value = sumForProduct(product.id, periodB.start, periodB.end, planB, product.sku, relatedProductIds, groupId, groupHistory, canonicalMemberships); return value ? toMetrics(value) : emptyMetrics(); },
    };
  };
  for (const cabinet of cabinets) {
    const cabinetProducts = canonicalProducts.filter(product => cabinetForProduct(product) === cabinet.id && allowed.has(product.id)); if (!cabinetProducts.length) continue;
    const cabinetCurrent = emptyMetrics(), cabinetPrevious = emptyMetrics();
    for (const category of [...new Set(cabinetProducts.map(categoryForProduct))].sort()) {
      const categoryId = `${cabinet.id}:category:${category}`; const categoryCurrent = emptyMetrics(), categoryPrevious = emptyMetrics(); const categoryProducts = cabinetProducts.filter(product => categoryForProduct(product) === category);
      const periodGroupIds = new Set(categoryProducts.flatMap(product => [...groupIdsForProduct(product)]));
      for (const groupId of periodGroupIds) {
        if (filters?.groupId && filters?.groupId !== groupId) continue;
        const groupCurrent = emptyMetrics(), groupPrevious = emptyMetrics(); const groupRowId = `${categoryId}:group:${groupId}`; const groupName = groupId === UNGROUPED_GROUP_ID ? 'Без склейки' : groups.find(group => group.id === groupId)?.name || 'Без склейки';
        for (const product of categoryProducts.filter(item => groupIdsForProduct(item).has(groupId))) { const metrics = productMetrics(product); const current = metrics.current(groupId); const previous = metrics.previous(groupId); rows.push({ id: `${product.id}:${groupId}`, productId: product.id, groupId, type: 'product', name: product.name, sku: product.sku, parent: groupRowId, depth: 3, current, previous }); addTo(groupCurrent, current); addTo(groupPrevious, previous); }
        recalcDerived(groupCurrent); recalcDerived(groupPrevious); rows.push({ id: groupRowId, type: 'group', name: groupName, parent: categoryId, depth: 2, current: groupCurrent, previous: groupPrevious }); addTo(categoryCurrent, groupCurrent); addTo(categoryPrevious, groupPrevious);
      }
      recalcDerived(categoryCurrent); recalcDerived(categoryPrevious); rows.push({ id: categoryId, type: 'category', name: category, parent: cabinet.id, depth: 1, current: categoryCurrent, previous: categoryPrevious }); addTo(cabinetCurrent, categoryCurrent); addTo(cabinetPrevious, categoryPrevious);
    }
    recalcDerived(cabinetCurrent); recalcDerived(cabinetPrevious); rows.push({ id: cabinet.id, type: 'cabinet', name: cabinet.name, parent: null, depth: 0, current: cabinetCurrent, previous: cabinetPrevious });
  }
  return rows;
}

export function getFilteredKpi(periodA: DatePeriod, periodB: DatePeriod, filters: FilterOptions) {
  const products = getProducts();
  const memberships = getMemberships();
  const groupHistory = getGroupMembershipHistory();
  const planMapA = getPlanMap(periodA.start);
  const planMapB = getPlanMap(periodB.start);

  const allowed = getFilteredProductIds(products, memberships, {
    cabinetFilter: filters.cabinetId,
    categoryFilter: filters.category,
    brandFilter: filters.brandId,
    groupFilter: filters.groupId,
    skuFilter: filters.sku,
  }, { groupHistory, period: { start: periodB.start < periodA.start ? periodB.start : periodA.start, end: periodA.end > periodB.end ? periodA.end : periodB.end } });

  const a = emptyMetrics();
  const b = emptyMetrics();

  for (const pr of products) {
    if (!allowed.has(pr.id)) continue;

    const ca = sumForProduct(pr.id, periodA.start, periodA.end, planMapA, pr.sku, undefined, filters.groupId, groupHistory, memberships);
    const cb = sumForProduct(pr.id, periodB.start, periodB.end, planMapB, pr.sku, undefined, filters.groupId, groupHistory, memberships);
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
