export type FunnelSort = 'impressions' | 'clicks' | 'carts' | 'orders' | 'ordered_amount' | 'ctr' | 'cart_cr' | 'order_cr' | 'ad_spend' | 'ad_orders_qty' | 'ad_ordered_amount' | 'cpo' | 'drr';

export interface FunnelFilters {
  start: string;
  end: string;
  cabinetIds?: string[] | null;
  productIds?: string[] | null;
  categoryIds?: string[] | null;
  brandIds?: string[] | null;
  groupIds?: string[] | null;
  search?: string | null;
}
export interface FunnelOption { id: string; name: string }
export interface FunnelFilterOptions { cabinets: FunnelOption[]; categories: FunnelOption[]; brands: FunnelOption[]; groups: FunnelOption[] }
export interface FunnelBounds { minDate: string | null; maxDate: string | null }
export interface FunnelMetrics {
  impressions: number; clicks: number; carts: number; orders: number; orderedAmount: number;
  adImpressions: number; adClicks: number; adOrdersQty: number; adOrderedAmount: number; adSpend: number;
}
export interface FunnelSummary extends FunnelMetrics { productCount: number }
export interface FunnelSeriesRow extends FunnelMetrics { date: string }
export interface FunnelRow extends FunnelMetrics {
  productId: string; cabinetId: string; cabinetName: string; groupId: string | null; groupName: string | null;
  sellerSku: string | null; wbSku: string | null; productName: string; totalCount: number;
}
export interface FunnelRates {
  ctr: number; cartCr: number; orderCr: number; impressionOrderCr: number;
  avgPrice: number; adCtr: number; cpo: number; drr: number;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/u;
const SORTS = new Set<FunnelSort>(['impressions', 'clicks', 'carts', 'orders', 'ordered_amount', 'ctr', 'cart_cr', 'order_cr', 'ad_spend', 'ad_orders_qty', 'ad_ordered_amount', 'cpo', 'drr']);

function record(value: unknown, context: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${context}: сервер вернул неожиданный ответ`);
  return value as Record<string, unknown>;
}
function text(value: unknown, field: string, nullable = false): string | null {
  if (value == null && nullable) return null;
  if (typeof value !== 'string' || (!nullable && !value.trim())) throw new Error(`V5 «Воронка»: некорректное поле ${field}`);
  return value;
}
function date(value: unknown, field: string, nullable = false): string | null {
  const parsed = text(value, field, nullable);
  if (parsed === null) return null;
  if (!ISO_DATE.test(parsed)) throw new Error(`V5 «Воронка»: некорректная дата ${field}`);
  return parsed;
}
function number(value: unknown, field: string, integer = false): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed) || parsed < 0 || (integer && !Number.isSafeInteger(parsed))) throw new Error(`V5 «Воронка»: некорректное значение ${field}`);
  return parsed;
}
function options(value: unknown, field: string): FunnelOption[] {
  if (!Array.isArray(value) || value.length > 500) throw new Error(`V5 «Воронка»: некорректный список ${field}`);
  const seen = new Set<string>();
  return value.map((item, index) => {
    const source = record(item, `${field}[${index}]`); const id = text(source.id, 'id') as string;
    if (seen.has(id)) throw new Error(`V5 «Воронка»: ${field} содержит повтор`); seen.add(id);
    return { id, name: text(source.name, 'name') as string };
  });
}
function metrics(source: Record<string, unknown>): FunnelMetrics {
  return {
    impressions: number(source.impressions, 'impressions', true), clicks: number(source.clicks, 'clicks', true),
    carts: number(source.carts, 'carts', true), orders: number(source.orders, 'orders', true),
    orderedAmount: number(source.ordered_amount, 'ordered_amount'), adImpressions: number(source.ad_impressions, 'ad_impressions', true),
    adClicks: number(source.ad_clicks, 'ad_clicks', true), adOrdersQty: number(source.ad_orders_qty, 'ad_orders_qty', true),
    adOrderedAmount: number(source.ad_ordered_amount, 'ad_ordered_amount'), adSpend: number(source.ad_spend, 'ad_spend'),
  };
}

export function assertFunnelFilters(filters: FunnelFilters): FunnelFilters {
  if (!ISO_DATE.test(filters.start) || !ISO_DATE.test(filters.end) || filters.end < filters.start) throw new Error('V5 «Воронка»: некорректный период');
  const days = Math.round((Date.parse(`${filters.end}T00:00:00Z`) - Date.parse(`${filters.start}T00:00:00Z`)) / 86_400_000);
  if (!Number.isFinite(days) || days > 731) throw new Error('V5 «Воронка»: период не должен превышать 731 день');
  if ((filters.cabinetIds?.length || 0) > 100 || (filters.categoryIds?.length || 0) > 100 || (filters.brandIds?.length || 0) > 100) throw new Error('V5 «Воронка»: слишком много значений справочника');
  if ((filters.productIds?.length || 0) > 500 || (filters.groupIds?.length || 0) > 500) throw new Error('V5 «Воронка»: слишком много товаров или склеек');
  if ((filters.search?.length || 0) > 100) throw new Error('V5 «Воронка»: поиск не должен превышать 100 символов');
  return filters;
}
export function assertFunnelSort(value: string): FunnelSort {
  if (!SORTS.has(value as FunnelSort)) throw new Error('V5 «Воронка»: неизвестная сортировка');
  return value as FunnelSort;
}
export function parseFunnelBounds(value: unknown): FunnelBounds {
  const source = record(value, 'Период V5 «Воронка»');
  return { minDate: date(source.min_date, 'min_date', true), maxDate: date(source.max_date, 'max_date', true) };
}
export function parseFunnelFilterOptions(value: unknown): FunnelFilterOptions {
  const source = record(value, 'Фильтры V5 «Воронка»');
  return { cabinets: options(source.cabinets, 'cabinets'), categories: options(source.categories, 'categories'), brands: options(source.brands, 'brands'), groups: options(source.groups, 'groups') };
}
export function parseFunnelSummary(value: unknown): FunnelSummary {
  if (!Array.isArray(value) || value.length !== 1) throw new Error('V5 «Воронка»: сводка должна содержать одну строку');
  const source = record(value[0], 'Сводка V5 «Воронка»');
  return { ...metrics(source), productCount: number(source.product_count, 'product_count', true) };
}
export function parseFunnelSeries(value: unknown): FunnelSeriesRow[] {
  if (!Array.isArray(value) || value.length > 732) throw new Error('V5 «Воронка»: некорректный дневной ряд');
  let previous = '';
  return value.map((item, index) => {
    const source = record(item, `Динамика, строка ${index + 1}`); const current = date(source.period_date, 'period_date') as string;
    if (current <= previous) throw new Error('V5 «Воронка»: даты не упорядочены или повторяются'); previous = current;
    return { date: current, ...metrics(source) };
  });
}
export function parseFunnelRows(value: unknown): FunnelRow[] {
  if (!Array.isArray(value) || value.length > 1000) throw new Error('V5 «Воронка»: таблица превышает серверный лимит');
  return value.map((item, index) => {
    const source = record(item, `Таблица, строка ${index + 1}`);
    return { productId: text(source.product_id, 'product_id') as string, cabinetId: text(source.cabinet_id, 'cabinet_id') as string,
      cabinetName: text(source.cabinet_name, 'cabinet_name') as string, groupId: text(source.group_id, 'group_id', true),
      groupName: text(source.group_name, 'group_name', true), sellerSku: text(source.seller_sku, 'seller_sku', true), wbSku: text(source.wb_sku, 'wb_sku', true),
      productName: text(source.product_name, 'product_name') as string, ...metrics(source), totalCount: number(source.total_count, 'total_count', true) };
  });
}
export function calculateFunnelRates(value: FunnelMetrics): FunnelRates {
  return {
    ctr: value.impressions ? value.clicks / value.impressions * 100 : 0,
    cartCr: value.clicks ? value.carts / value.clicks * 100 : 0,
    orderCr: value.carts ? value.orders / value.carts * 100 : 0,
    impressionOrderCr: value.impressions ? value.orders / value.impressions * 100 : 0,
    avgPrice: value.orders ? value.orderedAmount / value.orders : 0,
    adCtr: value.adImpressions ? value.adClicks / value.adImpressions * 100 : 0,
    cpo: value.adOrdersQty ? value.adSpend / value.adOrdersQty : 0,
    drr: value.adOrderedAmount ? value.adSpend / value.adOrderedAmount * 100 : 0,
  };
}
