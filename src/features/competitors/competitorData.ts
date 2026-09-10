import { isSupabaseConfigured, supabase } from '../../lib/supabaseClient';
import {
  assertV5CompetitorPage,
  assertV5CompetitorRange,
  assertV5CompetitorTop,
  parseV5CompetitorArticles,
  parseV5CompetitorBrands,
  parseV5CompetitorFilters,
  parseV5CompetitorOverview,
  parseV5CompetitorQueries,
  parseV5CompetitorStock,
  parseV5CompetitorTopMovements,
  parseV5CompetitorTopSummary,
  type V5CompetitorArticleRow,
  type V5CompetitorBrandRow,
  type V5CompetitorFilters,
  type V5CompetitorMovementStatus,
  type V5CompetitorOverviewRow,
  type V5CompetitorPage,
  type V5CompetitorQueryLeader,
  type V5CompetitorRangeRequest,
  type V5CompetitorStockSlice,
  type V5CompetitorTopMovement,
  type V5CompetitorTopSummary,
} from './competitorDataCore';

const isV5Environment = import.meta.env.VITE_APP_ENV === 'v5-development';
export const isV5CompetitorBackendEnabled = isV5Environment && import.meta.env.VITE_V5_COMPETITORS_BACKEND_ENABLED === 'true';

function assertBackendEnabled(): void {
  if (!isV5CompetitorBackendEnabled) throw new Error('Серверное чтение «Конкурентов» не включено для этого окружения');
  if (!isSupabaseConfigured) throw new Error('Supabase V5 не настроен');
}

async function rpc(name: string, parameters?: Record<string, unknown>): Promise<unknown> {
  assertBackendEnabled();
  const { data, error } = await supabase.rpc(name, parameters);
  if (error) throw new Error(`Не удалось загрузить V5 «Конкуренты»: ${error.message}`);
  return data;
}

export async function loadV5CompetitorFilters(): Promise<V5CompetitorFilters> {
  return parseV5CompetitorFilters(await rpc('v5_competitor_filters'));
}

export async function loadV5CompetitorOverview(request: V5CompetitorRangeRequest): Promise<V5CompetitorOverviewRow[]> {
  const range = assertV5CompetitorRange(request);
  return parseV5CompetitorOverview(await rpc('v5_competitor_overview_series', {
    p_start: range.start, p_end: range.end, p_brand: range.brand, p_search: range.search,
  }));
}

export async function loadV5CompetitorBrands(request: V5CompetitorRangeRequest & { limit?: number; offset?: number }): Promise<V5CompetitorPage<V5CompetitorBrandRow>> {
  const range = assertV5CompetitorRange(request);
  const limit = request.limit ?? 50;
  const offset = request.offset ?? 0;
  assertV5CompetitorPage(limit, offset, 10_000);
  return parseV5CompetitorBrands(await rpc('v5_competitor_brand_summary', {
    p_start: range.start, p_end: range.end, p_brand: range.brand, p_search: range.search, p_limit: limit, p_offset: offset,
  }));
}

export async function loadV5CompetitorArticles(request: V5CompetitorRangeRequest & { limit?: number; offset?: number }): Promise<V5CompetitorPage<V5CompetitorArticleRow>> {
  const range = assertV5CompetitorRange(request);
  const limit = request.limit ?? 25;
  const offset = request.offset ?? 0;
  assertV5CompetitorPage(limit, offset, 100_000);
  return parseV5CompetitorArticles(await rpc('v5_competitor_article_page', {
    p_start: range.start, p_end: range.end, p_brand: range.brand, p_search: range.search, p_limit: limit, p_offset: offset,
  }));
}

export async function loadV5CompetitorQueries(request: Pick<V5CompetitorRangeRequest, 'start' | 'end'> & { limit?: number }): Promise<V5CompetitorQueryLeader[]> {
  const range = assertV5CompetitorRange(request);
  const limit = request.limit ?? 10;
  if (!Number.isInteger(limit) || limit < 1 || limit > 50) throw new Error('V5 «Конкуренты»: число поисковых лидеров должно быть от 1 до 50');
  return parseV5CompetitorQueries(await rpc('v5_competitor_query_leaders', { p_start: range.start, p_end: range.end, p_limit: limit }));
}

export async function loadV5CompetitorStock(request: Pick<V5CompetitorRangeRequest, 'start' | 'end'> & { brands?: string[]; warehouses?: string[] }): Promise<V5CompetitorStockSlice> {
  const range = assertV5CompetitorRange(request);
  const brands = request.brands ?? [];
  const warehouses = request.warehouses ?? [];
  if (brands.length > 12 || warehouses.length > 20 || [...brands, ...warehouses].some(value => typeof value !== 'string' || !value.trim())) {
    throw new Error('V5 «Конкуренты»: превышен лимит или повреждены фильтры остатков');
  }
  return parseV5CompetitorStock(await rpc('v5_competitor_stock_slice', {
    p_start: range.start, p_end: range.end, p_brands: brands, p_warehouses: warehouses,
  }));
}

export async function loadV5CompetitorTopSummary(request: Pick<V5CompetitorRangeRequest, 'start' | 'end'> & { depth?: number }): Promise<V5CompetitorTopSummary> {
  const range = assertV5CompetitorRange(request, 366);
  const depth = request.depth ?? 50;
  assertV5CompetitorTop(depth);
  return parseV5CompetitorTopSummary(await rpc('v5_competitor_top_summary', { p_start: range.start, p_end: range.end, p_depth: depth }));
}

export async function loadV5CompetitorTopMovements(request: Pick<V5CompetitorRangeRequest, 'start' | 'end'> & { depth?: number; status?: V5CompetitorMovementStatus; limit?: number; offset?: number }): Promise<V5CompetitorPage<V5CompetitorTopMovement>> {
  const range = assertV5CompetitorRange(request, 366);
  const depth = request.depth ?? 50;
  const status = request.status ?? 'all';
  const limit = request.limit ?? 25;
  const offset = request.offset ?? 0;
  assertV5CompetitorTop(depth, status);
  assertV5CompetitorPage(limit, offset, 100_000);
  return parseV5CompetitorTopMovements(await rpc('v5_competitor_top_movements', {
    p_start: range.start, p_end: range.end, p_depth: depth, p_status: status, p_limit: limit, p_offset: offset,
  }));
}
