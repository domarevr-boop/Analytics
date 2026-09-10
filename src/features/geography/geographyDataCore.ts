export type GeographyFulfillment = 'all' | 'fbo' | 'fbs';
export type GeographyLevel = 'region' | 'area' | 'city';

export interface GeographyDataFilters {
  start: string;
  end: string;
  cabinetIds?: string[] | null;
  productIds?: string[] | null;
  region?: string | null;
  area?: string | null;
  city?: string | null;
}

export interface GeographyFilterOptions {
  minDate: string | null;
  maxDate: string | null;
  cabinetCount: number;
  productCount: number;
  regions: string[];
  areas: string[];
  cities: string[];
}

export interface GeographySummaryRow {
  fulfillment: GeographyFulfillment;
  orders: number;
  deliveryHours: number | null;
  coveredOrders: number;
  rowCount: number;
}

export interface GeographySeriesRow {
  date: string;
  allOrders: number;
  fboOrders: number;
  fbsOrders: number;
  allDeliveryHours: number | null;
  fboDeliveryHours: number | null;
  fbsDeliveryHours: number | null;
}

export interface GeographyLocationRow {
  region: string;
  area: string;
  city: string;
  orders: number;
  deliveryHours: number | null;
  coveredOrders: number;
  productCount: number;
}

export interface GeographyLocationPage { totalCount: number; rows: GeographyLocationRow[] }

export interface GeographyProductLeader {
  productId: string;
  cabinetId: string;
  sellerSku: string | null;
  wbSku: string | null;
  productName: string;
  orders: number;
  deliveryHours: number | null;
  coveredOrders: number;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/u;
const FULFILLMENTS = new Set<GeographyFulfillment>(['all', 'fbo', 'fbs']);
const LEVELS = new Set<GeographyLevel>(['region', 'area', 'city']);

function asRecord(value: unknown, context: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${context}: сервер вернул неожиданный ответ`);
  return value as Record<string, unknown>;
}

function readText(value: unknown, field: string, nullable = false): string | null {
  if (value == null && nullable) return null;
  if (typeof value !== 'string' || (!nullable && !value.trim())) throw new Error(`V5 «География»: некорректное поле ${field}`);
  return value;
}

function readDate(value: unknown, field: string, nullable = false): string | null {
  const date = readText(value, field, nullable);
  if (date === null) return null;
  if (!ISO_DATE.test(date)) throw new Error(`V5 «География»: некорректная дата ${field}`);
  return date;
}

function readNumber(value: unknown, field: string, nullable = false): number | null {
  if (value == null && nullable) return null;
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) throw new Error(`V5 «География»: некорректное число ${field}`);
  return parsed;
}

function readCount(value: unknown, field: string): number {
  const parsed = readNumber(value, field);
  if (!Number.isSafeInteger(parsed)) throw new Error(`V5 «География»: ${field} должен быть целым числом`);
  return parsed;
}

function readStringList(value: unknown, field: string): string[] {
  if (!Array.isArray(value)) throw new Error(`V5 «География»: ${field} должен быть списком`);
  const values = value.map((item, index) => readText(item, `${field}[${index}]`) as string);
  if (new Set(values).size !== values.length) throw new Error(`V5 «География»: ${field} содержит повторы`);
  return values;
}

export function assertGeographyFilters(filters: GeographyDataFilters): GeographyDataFilters {
  if (!ISO_DATE.test(filters.start) || !ISO_DATE.test(filters.end) || filters.end < filters.start) throw new Error('V5 «География»: некорректный период');
  const days = Math.round((Date.parse(`${filters.end}T00:00:00Z`) - Date.parse(`${filters.start}T00:00:00Z`)) / 86_400_000);
  if (!Number.isFinite(days) || days > 731) throw new Error('V5 «География»: период не должен превышать 731 день');
  if ((filters.cabinetIds?.length || 0) > 100) throw new Error('V5 «География»: допускается не более 100 кабинетов');
  if ((filters.productIds?.length || 0) > 500) throw new Error('V5 «География»: допускается не более 500 товаров');
  for (const value of [filters.region, filters.area, filters.city]) {
    if ((value?.length || 0) > 1000) throw new Error('V5 «География»: географический фильтр слишком длинный');
  }
  return filters;
}

export function assertGeographyFulfillment(value: string): GeographyFulfillment {
  if (!FULFILLMENTS.has(value as GeographyFulfillment)) throw new Error('V5 «География»: неизвестный тип выполнения');
  return value as GeographyFulfillment;
}

export function assertGeographyLevel(value: string): GeographyLevel {
  if (!LEVELS.has(value as GeographyLevel)) throw new Error('V5 «География»: неизвестный уровень детализации');
  return value as GeographyLevel;
}

export function parseGeographyFilterOptions(value: unknown): GeographyFilterOptions {
  const record = asRecord(value, 'Фильтры V5 «География»');
  return {
    minDate: readDate(record.min_date, 'min_date', true),
    maxDate: readDate(record.max_date, 'max_date', true),
    cabinetCount: readCount(record.cabinet_count, 'cabinet_count'),
    productCount: readCount(record.product_count, 'product_count'),
    regions: readStringList(record.regions, 'regions'),
    areas: readStringList(record.areas, 'areas'),
    cities: readStringList(record.cities, 'cities'),
  };
}

export function parseGeographySummary(value: unknown): GeographySummaryRow[] {
  if (!Array.isArray(value)) throw new Error('V5 «География»: сводка должна быть списком');
  const seen = new Set<string>();
  const rows = value.map((item, index): GeographySummaryRow => {
    const record = asRecord(item, `Сводка, строка ${index + 1}`);
    const fulfillment = assertGeographyFulfillment(readText(record.fulfillment, 'fulfillment') as string);
    if (seen.has(fulfillment)) throw new Error('V5 «География»: повтор типа выполнения в сводке');
    seen.add(fulfillment);
    const orders = readCount(record.orders, 'orders');
    const coveredOrders = readCount(record.covered_orders, 'covered_orders');
    if (coveredOrders > orders) throw new Error('V5 «География»: покрытые СВД заказы превышают все заказы');
    return { fulfillment, orders, deliveryHours: readNumber(record.delivery_hours, 'delivery_hours', true), coveredOrders, rowCount: readCount(record.row_count, 'row_count') };
  });
  if (rows.length && seen.size !== 3) throw new Error('V5 «География»: сводка должна содержать All/FBO/FBS');
  return rows;
}

export function parseGeographySeries(value: unknown): GeographySeriesRow[] {
  if (!Array.isArray(value)) throw new Error('V5 «География»: динамика должна быть списком');
  let previous = '';
  return value.map((item, index): GeographySeriesRow => {
    const record = asRecord(item, `Динамика, строка ${index + 1}`);
    const date = readDate(record.period_date, 'period_date') as string;
    if (date <= previous) throw new Error('V5 «География»: даты динамики не упорядочены или повторяются');
    previous = date;
    const allOrders = readCount(record.all_orders, 'all_orders');
    const fboOrders = readCount(record.fbo_orders, 'fbo_orders');
    const fbsOrders = readCount(record.fbs_orders, 'fbs_orders');
    if (allOrders !== fboOrders + fbsOrders) throw new Error('V5 «География»: дневной баланс FBO/FBS не сходится');
    return {
      date, allOrders, fboOrders, fbsOrders,
      allDeliveryHours: readNumber(record.all_delivery_hours, 'all_delivery_hours', true),
      fboDeliveryHours: readNumber(record.fbo_delivery_hours, 'fbo_delivery_hours', true),
      fbsDeliveryHours: readNumber(record.fbs_delivery_hours, 'fbs_delivery_hours', true),
    };
  });
}

export function parseGeographyLocations(value: unknown): GeographyLocationPage {
  if (!Array.isArray(value)) throw new Error('V5 «География»: локации должны быть списком');
  let totalCount: number | null = null;
  const rows = value.map((item, index): GeographyLocationRow => {
    const record = asRecord(item, `Локации, строка ${index + 1}`);
    const rowTotal = readCount(record.total_count, 'total_count');
    if (totalCount === null) totalCount = rowTotal;
    if (rowTotal !== totalCount) throw new Error('V5 «География»: несогласованное число локаций');
    const orders = readCount(record.orders, 'orders');
    const coveredOrders = readCount(record.covered_orders, 'covered_orders');
    if (coveredOrders > orders) throw new Error('V5 «География»: покрытие локации превышает заказы');
    return {
      region: readText(record.region, 'region') as string,
      area: readText(record.area, 'area', true) || '', city: readText(record.city, 'city', true) || '',
      orders, deliveryHours: readNumber(record.delivery_hours, 'delivery_hours', true),
      coveredOrders, productCount: readCount(record.product_count, 'product_count'),
    };
  });
  if ((totalCount ?? 0) < rows.length) throw new Error('V5 «География»: страница длиннее общего числа локаций');
  return { totalCount: totalCount ?? 0, rows };
}

export function parseGeographyProductLeaders(value: unknown): GeographyProductLeader[] {
  if (!Array.isArray(value)) throw new Error('V5 «География»: лидеры товаров должны быть списком');
  const seen = new Set<string>();
  return value.map((item, index): GeographyProductLeader => {
    const record = asRecord(item, `Товары, строка ${index + 1}`);
    const productId = readText(record.product_id, 'product_id') as string;
    if (seen.has(productId)) throw new Error('V5 «География»: товар повторяется в рейтинге');
    seen.add(productId);
    const orders = readCount(record.orders, 'orders');
    const coveredOrders = readCount(record.covered_orders, 'covered_orders');
    if (coveredOrders > orders) throw new Error('V5 «География»: покрытие товара превышает заказы');
    return {
      productId, cabinetId: readText(record.cabinet_id, 'cabinet_id') as string,
      sellerSku: readText(record.seller_sku, 'seller_sku', true), wbSku: readText(record.wb_sku, 'wb_sku', true),
      productName: readText(record.product_name, 'product_name') as string,
      orders, deliveryHours: readNumber(record.delivery_hours, 'delivery_hours', true), coveredOrders,
    };
  });
}
