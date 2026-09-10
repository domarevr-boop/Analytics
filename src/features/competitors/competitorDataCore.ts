const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface V5CompetitorCoverage {
  minDate: string | null;
  maxDate: string | null;
  dayCount: number;
  rowCount?: number;
}

export interface V5CompetitorFilters {
  batchId: string | null;
  funnel: V5CompetitorCoverage;
  positions: V5CompetitorCoverage;
  stocks: V5CompetitorCoverage;
  brands: string[];
  stockBrands: string[];
  warehouses: Array<{ key: string; name: string }>;
}

export interface V5CompetitorOverviewRow {
  date: string;
  orderedAmount: number;
  orders: number;
  weightedPrice: number;
  impressions: number;
  orderConversion: number;
  buyoutRate: number;
  ownOrderedAmount: number;
  ownOrders: number;
  ownWeightedPrice: number;
  ownImpressions: number;
  ownOrderConversion: number;
  ownBuyoutRate: number;
  leaderShare: number;
  ownShare: number;
}

export interface V5CompetitorBrandRow {
  key: string;
  brand: string;
  seller: string;
  isOwn: boolean;
  articles: number;
  orderedAmount: number;
  orders: number;
  weightedPrice: number;
  weightedBuyerMedianPrice: number;
  avgSearchPosition: number;
  share: number | null;
  impressions: number;
  clicks: number;
  ctr: number | null;
  carts: number;
  cartConversion: number | null;
  orderConversion: number | null;
  buyouts: number;
  buyoutRate: number;
}

export interface V5CompetitorArticleRow {
  wbArticle: string;
  brand: string;
  seller: string;
  isOwn: boolean;
  orderedAmount: number;
  orders: number;
  impressions: number;
  orderConversion: number;
  buyoutRate: number;
  weightedPrice: number;
  stock: number;
  avgDailyOrders: number;
  stockCoverage: number;
  warehouseCount: number;
  productName: string;
  subject: string;
  topQuery: string;
  queryRequests: number;
  latestPosition: number | null;
  positionDelta: number;
}

export interface V5CompetitorQueryLeader {
  query: string;
  requests: number;
  requestsPrevious: number;
  articles: number;
}

export interface V5CompetitorStockSlice {
  dateStart: string | null;
  dateEnd: string | null;
  totalPrevious: number;
  totalCurrent: number;
  totalDelta: number;
  warehouses: Array<{ key: string; warehouse: string; stock: number; share: number | null }>;
  brands: Array<{ key: string; brand: string; previous: number; current: number; delta: number; deltaRate: number | null }>;
}

export interface V5CompetitorTopSummary {
  dates: string[];
  timeline: Array<{ date: string; size: number; retained: number; entrants: number; exits: number; retentionRate: number | null }>;
  brandStructure: Array<{ key: string; brand: string; counts: number[]; latest: number; delta: number }>;
  stabilityRate: number | null;
  entrants: number;
  exits: number;
  averageMovement: number | null;
  brandsLatest: number;
}

export type V5CompetitorMovementStatus = 'all' | 'retained' | 'new' | 'exited' | 'intermittent';

export interface V5CompetitorTopMovement {
  wbArticle: string;
  brand: string;
  seller: string;
  baseline: number | null;
  comparison: number | null;
  best: number;
  worst: number;
  observedDays: number;
  positionDelta: number | null;
  status: Exclude<V5CompetitorMovementStatus, 'all'>;
}

export interface V5CompetitorPage<T> {
  totalCount: number;
  rows: T[];
}

export interface V5CompetitorRangeRequest {
  start: string;
  end: string;
  brand?: string | null;
  search?: string | null;
}

function asRecord(value: unknown, context: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${context}: сервер вернул неожиданный ответ`);
  return value as Record<string, unknown>;
}

function readString(value: unknown, field: string, allowEmpty = false): string {
  if (typeof value !== 'string' || (!allowEmpty && !value.trim())) throw new Error(`V5 «Конкуренты»: некорректное поле ${field}`);
  return value;
}

function readBoolean(value: unknown, field: string): boolean {
  if (typeof value !== 'boolean') throw new Error(`V5 «Конкуренты»: некорректное поле ${field}`);
  return value;
}

function readNumber(value: unknown, field: string, options: { nullable?: boolean; integer?: boolean; nonNegative?: boolean } = {}): number | null {
  if (value == null && options.nullable) return null;
  const number = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(number) || (options.integer && !Number.isSafeInteger(number)) || (options.nonNegative && number < 0)) {
    throw new Error(`V5 «Конкуренты»: некорректное поле ${field}`);
  }
  return number;
}

function readCount(value: unknown, field: string): number {
  return readNumber(value, field, { integer: true, nonNegative: true }) as number;
}

function readDate(value: unknown, field: string, nullable = false): string | null {
  if (value == null && nullable) return null;
  const date = readString(value, field);
  if (!ISO_DATE.test(date)) throw new Error(`V5 «Конкуренты»: некорректное поле ${field}`);
  return date;
}

function parseCoverage(value: unknown, field: string, withRows = false): V5CompetitorCoverage {
  const record = asRecord(value, `Покрытие ${field}`);
  const minDate = readDate(record.min_date, `${field}.min_date`, true);
  const maxDate = readDate(record.max_date, `${field}.max_date`, true);
  const dayCount = readCount(record.day_count, `${field}.day_count`);
  if ((minDate === null) !== (maxDate === null) || (dayCount === 0) !== (minDate === null) || (minDate && maxDate && minDate > maxDate)) {
    throw new Error(`V5 «Конкуренты»: несогласованное покрытие ${field}`);
  }
  return withRows ? { minDate, maxDate, dayCount, rowCount: readCount(record.row_count, `${field}.row_count`) } : { minDate, maxDate, dayCount };
}

function parseStringList(value: unknown, field: string): string[] {
  if (!Array.isArray(value)) throw new Error(`V5 «Конкуренты»: некорректное поле ${field}`);
  const rows = value.map((item, index) => readString(item, `${field}[${index}]`));
  if (new Set(rows).size !== rows.length) throw new Error(`V5 «Конкуренты»: повторы в ${field}`);
  return rows;
}

function parsePage<T>(value: unknown, map: (record: Record<string, unknown>, index: number) => T): V5CompetitorPage<T> {
  if (!Array.isArray(value)) throw new Error('V5 «Конкуренты»: сервер вернул неожиданный список');
  if (!value.length) return { totalCount: 0, rows: [] };
  let totalCount: number | null = null;
  const rows = value.map((item, index) => {
    const record = asRecord(item, `V5 «Конкуренты», строка ${index + 1}`);
    const rowTotal = readCount(record.total_count, 'total_count');
    if (totalCount === null) totalCount = rowTotal;
    if (rowTotal !== totalCount) throw new Error('V5 «Конкуренты»: несогласованное общее количество строк');
    return map(record, index);
  });
  if ((totalCount ?? 0) < rows.length) throw new Error('V5 «Конкуренты»: страница больше общего количества строк');
  return { totalCount: totalCount ?? 0, rows };
}

export function assertV5CompetitorRange(request: V5CompetitorRangeRequest, maxDifferenceDays = 731): Required<V5CompetitorRangeRequest> {
  if (!ISO_DATE.test(request.start) || !ISO_DATE.test(request.end)) throw new Error('V5 «Конкуренты»: период должен быть в формате YYYY-MM-DD');
  const difference = (Date.parse(`${request.end}T00:00:00Z`) - Date.parse(`${request.start}T00:00:00Z`)) / 86_400_000;
  if (!Number.isInteger(difference) || difference < 0 || difference > maxDifferenceDays) throw new Error('V5 «Конкуренты»: период выходит за серверный лимит');
  const brand = request.brand?.trim() || null;
  const search = request.search?.trim() || null;
  if (brand && brand.length > 500) throw new Error('V5 «Конкуренты»: бренд не должен превышать 500 символов');
  if (search && search.length > 100) throw new Error('V5 «Конкуренты»: поиск не должен превышать 100 символов');
  return { start: request.start, end: request.end, brand, search };
}

export function assertV5CompetitorPage(limit: number, offset: number, maxOffset: number): void {
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error('V5 «Конкуренты»: размер страницы должен быть от 1 до 100');
  if (!Number.isInteger(offset) || offset < 0 || offset > maxOffset) throw new Error(`V5 «Конкуренты»: смещение должно быть от 0 до ${maxOffset}`);
}

export function assertV5CompetitorTop(depth: number, status: V5CompetitorMovementStatus = 'all'): void {
  if (![10, 20, 50].includes(depth)) throw new Error('V5 «Конкуренты»: глубина TOP должна быть 10, 20 или 50');
  if (!['all', 'retained', 'new', 'exited', 'intermittent'].includes(status)) throw new Error('V5 «Конкуренты»: неизвестный статус движения');
}

export function parseV5CompetitorFilters(value: unknown): V5CompetitorFilters {
  const record = asRecord(value, 'Фильтры V5 «Конкуренты»');
  const batchId = record.batch_id == null ? null : readString(record.batch_id, 'batch_id');
  if (batchId && !UUID.test(batchId)) throw new Error('V5 «Конкуренты»: некорректное поле batch_id');
  if (!Array.isArray(record.warehouses)) throw new Error('V5 «Конкуренты»: некорректное поле warehouses');
  return {
    batchId,
    funnel: parseCoverage(record.funnel, 'funnel', true),
    positions: parseCoverage(record.positions, 'positions'),
    stocks: parseCoverage(record.stocks, 'stocks'),
    brands: parseStringList(record.brands, 'brands'),
    stockBrands: parseStringList(record.stock_brands, 'stock_brands'),
    warehouses: record.warehouses.map((item, index) => {
      const row = asRecord(item, `warehouses[${index}]`);
      return { key: readString(row.key, 'warehouses.key'), name: readString(row.name, 'warehouses.name') };
    }),
  };
}

export function parseV5CompetitorOverview(value: unknown): V5CompetitorOverviewRow[] {
  if (!Array.isArray(value) || value.length > 732) throw new Error('V5 «Конкуренты»: некорректный дневной ряд');
  let previous = '';
  return value.map((item, index) => {
    const row = asRecord(item, `Дневной ряд, строка ${index + 1}`);
    const date = readDate(row.period_date, 'period_date') as string;
    if (date <= previous) throw new Error('V5 «Конкуренты»: даты дневного ряда не возрастают');
    previous = date;
    return {
      date,
      orderedAmount: readNumber(row.ordered_amount, 'ordered_amount') as number,
      orders: readCount(row.orders, 'orders'),
      weightedPrice: readNumber(row.weighted_price, 'weighted_price') as number,
      impressions: readCount(row.impressions, 'impressions'),
      orderConversion: readNumber(row.order_conversion, 'order_conversion') as number,
      buyoutRate: readNumber(row.buyout_rate, 'buyout_rate') as number,
      ownOrderedAmount: readNumber(row.own_ordered_amount, 'own_ordered_amount') as number,
      ownOrders: readCount(row.own_orders, 'own_orders'),
      ownWeightedPrice: readNumber(row.own_weighted_price, 'own_weighted_price') as number,
      ownImpressions: readCount(row.own_impressions, 'own_impressions'),
      ownOrderConversion: readNumber(row.own_order_conversion, 'own_order_conversion') as number,
      ownBuyoutRate: readNumber(row.own_buyout_rate, 'own_buyout_rate') as number,
      leaderShare: readNumber(row.leader_share, 'leader_share') as number,
      ownShare: readNumber(row.own_share, 'own_share') as number,
    };
  });
}

export function parseV5CompetitorBrands(value: unknown): V5CompetitorPage<V5CompetitorBrandRow> {
  return parsePage(value, row => ({
    key: readString(row.brand_key, 'brand_key'), brand: readString(row.brand, 'brand'), seller: readString(row.seller, 'seller', true), isOwn: readBoolean(row.is_own, 'is_own'),
    articles: readCount(row.articles, 'articles'), orderedAmount: readNumber(row.ordered_amount, 'ordered_amount') as number, orders: readCount(row.orders, 'orders'),
    weightedPrice: readNumber(row.weighted_price, 'weighted_price') as number, weightedBuyerMedianPrice: readNumber(row.weighted_buyer_median_price, 'weighted_buyer_median_price') as number,
    avgSearchPosition: readNumber(row.avg_search_position, 'avg_search_position') as number, share: readNumber(row.share, 'share', { nullable: true }), impressions: readCount(row.impressions, 'impressions'),
    clicks: readCount(row.clicks, 'clicks'), ctr: readNumber(row.ctr, 'ctr', { nullable: true }), carts: readCount(row.carts, 'carts'),
    cartConversion: readNumber(row.cart_conversion, 'cart_conversion', { nullable: true }), orderConversion: readNumber(row.order_conversion, 'order_conversion', { nullable: true }),
    buyouts: readCount(row.buyouts, 'buyouts'), buyoutRate: readNumber(row.buyout_rate, 'buyout_rate') as number,
  }));
}

export function parseV5CompetitorArticles(value: unknown): V5CompetitorPage<V5CompetitorArticleRow> {
  return parsePage(value, row => ({
    wbArticle: readString(row.wb_article, 'wb_article'), brand: readString(row.brand, 'brand', true), seller: readString(row.seller, 'seller', true), isOwn: readBoolean(row.is_own, 'is_own'),
    orderedAmount: readNumber(row.ordered_amount, 'ordered_amount') as number, orders: readCount(row.orders, 'orders'), impressions: readCount(row.impressions, 'impressions'),
    orderConversion: readNumber(row.order_conversion, 'order_conversion') as number, buyoutRate: readNumber(row.buyout_rate, 'buyout_rate') as number,
    weightedPrice: readNumber(row.weighted_price, 'weighted_price') as number, stock: readCount(row.stock, 'stock'), avgDailyOrders: readNumber(row.avg_daily_orders, 'avg_daily_orders') as number,
    stockCoverage: readNumber(row.stock_coverage, 'stock_coverage') as number, warehouseCount: readCount(row.warehouse_count, 'warehouse_count'),
    productName: readString(row.product_name, 'product_name', true), subject: readString(row.subject, 'subject', true), topQuery: readString(row.top_query, 'top_query', true),
    queryRequests: readCount(row.query_requests, 'query_requests'), latestPosition: readNumber(row.latest_position, 'latest_position', { nullable: true, integer: true }),
    positionDelta: readNumber(row.position_delta, 'position_delta', { integer: true }) as number,
  }));
}

export function parseV5CompetitorQueries(value: unknown): V5CompetitorQueryLeader[] {
  if (!Array.isArray(value) || value.length > 50) throw new Error('V5 «Конкуренты»: некорректный список запросов');
  return value.map((item, index) => {
    const row = asRecord(item, `Запросы, строка ${index + 1}`);
    return { query: readString(row.query, 'query'), requests: readCount(row.requests, 'requests'), requestsPrevious: readCount(row.requests_previous, 'requests_previous'), articles: readCount(row.articles, 'articles') };
  });
}

export function parseV5CompetitorStock(value: unknown): V5CompetitorStockSlice {
  const record = asRecord(value, 'Остатки V5 «Конкуренты»');
  const dateStart = readDate(record.date_start, 'date_start', true);
  const dateEnd = readDate(record.date_end, 'date_end', true);
  if ((dateStart === null) !== (dateEnd === null) || (dateStart && dateEnd && dateStart > dateEnd)) throw new Error('V5 «Конкуренты»: несогласованные даты остатков');
  if (!Array.isArray(record.warehouses) || !Array.isArray(record.brands)) throw new Error('V5 «Конкуренты»: некорректные срезы остатков');
  return {
    dateStart, dateEnd,
    totalPrevious: readNumber(record.total_previous, 'total_previous') as number,
    totalCurrent: readNumber(record.total_current, 'total_current') as number,
    totalDelta: readNumber(record.total_delta, 'total_delta') as number,
    warehouses: record.warehouses.map((item, index) => { const row = asRecord(item, `warehouses[${index}]`); return { key: readString(row.key, 'warehouses.key'), warehouse: readString(row.warehouse, 'warehouses.warehouse'), stock: readCount(row.stock, 'warehouses.stock'), share: readNumber(row.share, 'warehouses.share', { nullable: true }) }; }),
    brands: record.brands.map((item, index) => { const row = asRecord(item, `brands[${index}]`); return { key: readString(row.key, 'brands.key'), brand: readString(row.brand, 'brands.brand'), previous: readNumber(row.previous, 'brands.previous') as number, current: readNumber(row.current, 'brands.current') as number, delta: readNumber(row.delta, 'brands.delta') as number, deltaRate: readNumber(row.delta_rate, 'brands.delta_rate', { nullable: true }) }; }),
  };
}

export function parseV5CompetitorTopSummary(value: unknown): V5CompetitorTopSummary {
  const record = asRecord(value, 'TOP V5 «Конкуренты»');
  if (!Array.isArray(record.dates) || !Array.isArray(record.timeline) || !Array.isArray(record.brand_structure)) throw new Error('V5 «Конкуренты»: некорректная структура TOP');
  const dates = record.dates.map((date, index) => readDate(date, `dates[${index}]`) as string);
  if (dates.length > 367 || new Set(dates).size !== dates.length) throw new Error('V5 «Конкуренты»: некорректные даты TOP');
  const timeline = record.timeline.map((item, index) => { const row = asRecord(item, `timeline[${index}]`); return { date: readDate(row.date, 'timeline.date') as string, size: readCount(row.size, 'timeline.size'), retained: readCount(row.retained, 'timeline.retained'), entrants: readCount(row.entrants, 'timeline.entrants'), exits: readCount(row.exits, 'timeline.exits'), retentionRate: readNumber(row.retention_rate, 'timeline.retention_rate', { nullable: true }) }; });
  if (timeline.length !== dates.length || timeline.some((row, index) => row.date !== dates[index])) throw new Error('V5 «Конкуренты»: timeline TOP не согласован с датами');
  const brandStructure = record.brand_structure.map((item, index) => { const row = asRecord(item, `brand_structure[${index}]`); if (!Array.isArray(row.counts) || row.counts.length !== dates.length) throw new Error('V5 «Конкуренты»: матрица бренда не согласована с датами TOP'); return { key: readString(row.key, 'brand_structure.key'), brand: readString(row.brand, 'brand_structure.brand'), counts: row.counts.map((count, countIndex) => readCount(count, `brand_structure.counts[${countIndex}]`)), latest: readCount(row.latest, 'brand_structure.latest'), delta: readNumber(row.delta, 'brand_structure.delta', { integer: true }) as number }; });
  return { dates, timeline, brandStructure, stabilityRate: readNumber(record.stability_rate, 'stability_rate', { nullable: true }), entrants: readCount(record.entrants, 'entrants'), exits: readCount(record.exits, 'exits'), averageMovement: readNumber(record.average_movement, 'average_movement', { nullable: true }), brandsLatest: readCount(record.brands_latest, 'brands_latest') };
}

export function parseV5CompetitorTopMovements(value: unknown): V5CompetitorPage<V5CompetitorTopMovement> {
  return parsePage(value, row => {
    const status = readString(row.movement_status, 'movement_status') as V5CompetitorTopMovement['status'];
    if (!['retained', 'new', 'exited', 'intermittent'].includes(status)) throw new Error('V5 «Конкуренты»: неизвестный статус движения');
    return { wbArticle: readString(row.wb_article, 'wb_article'), brand: readString(row.brand, 'brand', true), seller: readString(row.seller, 'seller', true), baseline: readNumber(row.baseline, 'baseline', { nullable: true, integer: true }), comparison: readNumber(row.comparison, 'comparison', { nullable: true, integer: true }), best: readCount(row.best, 'best'), worst: readCount(row.worst, 'worst'), observedDays: readCount(row.observed_days, 'observed_days'), positionDelta: readNumber(row.position_delta, 'position_delta', { nullable: true, integer: true }), status };
  });
}
