export type SearchQueriesSort = 'requests' | 'growth' | 'order_amount' | 'orders' | 'cart_cr' | 'order_cr' | 'opportunity' | 'products';
export type SearchQueriesMetric = 'requests' | 'card_clicks' | 'carts' | 'orders' | 'order_amount' | 'products';

export interface SearchQueriesFilters { start: string; end: string; category?: string | null; search?: string | null }
export interface SearchQueriesOptions { minDate: string | null; maxDate: string | null; categoryCount: number; queryCount: number; categories: string[] }
export interface SearchQueriesSummary {
  requests: number; requestsPrevious: number; cardClicks: number; cardClicksPrevious: number;
  carts: number; cartsPrevious: number; orders: number; ordersPrevious: number;
  orderAmount: number; orderAmountPrevious: number; queryCount: number;
  ownOrders: number | null; ownOrdersShare: number | null;
}
export interface SearchQueriesSeriesRow {
  date: string; requests: number; requestsPrevious: number; cardClicks: number; cardClicksPrevious: number;
  carts: number; cartsPrevious: number; orders: number; ordersPrevious: number; products: number; productsPrevious: number;
  orderAmount: number; orderAmountPrevious: number;
}
export interface SearchQueriesRow {
  query: string; category: string; requests: number; requestsPrevious: number; cardClicks: number; cardClicksPrevious: number;
  carts: number; cartsPrevious: number; orders: number; ordersPrevious: number; products: number; productsPrevious: number;
  orderAmount: number; orderAmountPrevious: number; cartCr: number; orderCr: number; growth: number; opportunity: number; totalCount: number;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/u;
function object(value: unknown, context: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${context}: сервер вернул неожиданный ответ`);
  return value as Record<string, unknown>;
}
function text(value: unknown, field: string): string {
  if (typeof value !== 'string') throw new Error(`V5 «Поисковые запросы»: некорректное поле ${field}`);
  return value;
}
function date(value: unknown, field: string, nullable = false): string | null {
  if (nullable && value == null) return null;
  const result = text(value, field);
  if (!ISO_DATE.test(result)) throw new Error(`V5 «Поисковые запросы»: некорректная дата ${field}`);
  return result;
}
function number(value: unknown, field: string, nullable = false): number | null {
  if (nullable && value == null) return null;
  const result = Number(value);
  if (!Number.isFinite(result)) throw new Error(`V5 «Поисковые запросы»: некорректное поле ${field}`);
  return result;
}

export function assertSearchQueriesFilters(value: SearchQueriesFilters): SearchQueriesFilters {
  if (!ISO_DATE.test(value.start) || !ISO_DATE.test(value.end) || value.start > value.end) throw new Error('V5 «Поисковые запросы»: некорректный период');
  if (value.search && value.search.length > 200) throw new Error('V5 «Поисковые запросы»: строка поиска длиннее 200 символов');
  return value;
}

export function parseSearchQueriesOptions(value: unknown): SearchQueriesOptions {
  const row = Array.isArray(value) ? value[0] : value;
  if (!row) return { minDate: null, maxDate: null, categoryCount: 0, queryCount: 0, categories: [] };
  const source = object(row, 'Фильтры поисковых запросов');
  const categories = Array.isArray(source.categories) ? source.categories.map((item, index) => text(item, `categories[${index}]`)) : [];
  return { minDate: date(source.min_date, 'min_date', true), maxDate: date(source.max_date, 'max_date', true),
    categoryCount: number(source.category_count, 'category_count') as number, queryCount: number(source.query_count, 'query_count') as number, categories };
}

export function parseSearchQueriesSummary(value: unknown): SearchQueriesSummary {
  const source = object(value, 'Итоги поисковых запросов');
  return {
    requests: number(source.requests, 'requests') as number, requestsPrevious: number(source.requests_previous, 'requests_previous') as number,
    cardClicks: number(source.card_clicks, 'card_clicks') as number, cardClicksPrevious: number(source.card_clicks_previous, 'card_clicks_previous') as number,
    carts: number(source.carts, 'carts') as number, cartsPrevious: number(source.carts_previous, 'carts_previous') as number,
    orders: number(source.orders, 'orders') as number, ordersPrevious: number(source.orders_previous, 'orders_previous') as number,
    orderAmount: number(source.order_amount, 'order_amount') as number, orderAmountPrevious: number(source.order_amount_previous, 'order_amount_previous') as number,
    queryCount: number(source.query_count, 'query_count') as number,
    ownOrders: number(source.own_orders, 'own_orders', true), ownOrdersShare: number(source.own_orders_share, 'own_orders_share', true),
  };
}

export function parseSearchQueriesSeries(value: unknown): SearchQueriesSeriesRow[] {
  if (!Array.isArray(value)) throw new Error('Ряд поисковых запросов: сервер вернул неожиданный ответ');
  return value.map((item, index) => {
    const row = object(item, `Ряд поисковых запросов, строка ${index + 1}`);
    return { date: date(row.period_date, 'period_date') as string,
      requests: number(row.requests, 'requests') as number, requestsPrevious: number(row.requests_previous, 'requests_previous') as number,
      cardClicks: number(row.card_clicks, 'card_clicks') as number, cardClicksPrevious: number(row.card_clicks_previous, 'card_clicks_previous') as number,
      carts: number(row.carts, 'carts') as number, cartsPrevious: number(row.carts_previous, 'carts_previous') as number,
      orders: number(row.orders, 'orders') as number, ordersPrevious: number(row.orders_previous, 'orders_previous') as number,
      products: number(row.products, 'products') as number, productsPrevious: number(row.products_previous, 'products_previous') as number,
      orderAmount: number(row.order_amount, 'order_amount') as number, orderAmountPrevious: number(row.order_amount_previous, 'order_amount_previous') as number };
  });
}

export function parseSearchQueriesRows(value: unknown): SearchQueriesRow[] {
  if (!Array.isArray(value)) throw new Error('Таблица поисковых запросов: сервер вернул неожиданный ответ');
  return value.map((item, index) => {
    const row = object(item, `Таблица поисковых запросов, строка ${index + 1}`);
    return { query: text(row.query, 'query'), category: text(row.category, 'category'),
      requests: number(row.requests, 'requests') as number, requestsPrevious: number(row.requests_previous, 'requests_previous') as number,
      cardClicks: number(row.card_clicks, 'card_clicks') as number, cardClicksPrevious: number(row.card_clicks_previous, 'card_clicks_previous') as number,
      carts: number(row.carts, 'carts') as number, cartsPrevious: number(row.carts_previous, 'carts_previous') as number,
      orders: number(row.orders, 'orders') as number, ordersPrevious: number(row.orders_previous, 'orders_previous') as number,
      products: number(row.products, 'products') as number, productsPrevious: number(row.products_previous, 'products_previous') as number,
      orderAmount: number(row.order_amount, 'order_amount') as number, orderAmountPrevious: number(row.order_amount_previous, 'order_amount_previous') as number,
      cartCr: number(row.cart_cr, 'cart_cr') as number, orderCr: number(row.order_cr, 'order_cr') as number,
      growth: number(row.growth, 'growth') as number, opportunity: number(row.opportunity, 'opportunity') as number,
      totalCount: number(row.total_count, 'total_count') as number };
  });
}
