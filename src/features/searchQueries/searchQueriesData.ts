import { isSupabaseConfigured, supabase } from '../../lib/supabaseClient';
import { assertSearchQueriesFilters, parseSearchQueriesOptions, parseSearchQueriesRows, parseSearchQueriesSeries, parseSearchQueriesSummary } from './searchQueriesDataCore';
import type { SearchQueriesFilters, SearchQueriesOptions, SearchQueriesRow, SearchQueriesSeriesRow, SearchQueriesSort, SearchQueriesSummary } from './searchQueriesDataCore';

const isV5Environment = import.meta.env.VITE_APP_ENV === 'v5-development';
export const isV5SearchQueriesBackendEnabled = isV5Environment && import.meta.env.VITE_V5_SEARCH_QUERIES_BACKEND_ENABLED === 'true';

function enabled() {
  if (!isV5SearchQueriesBackendEnabled) throw new Error('Серверное чтение «Поисковых запросов» не включено для этого окружения');
  if (!isSupabaseConfigured) throw new Error('Supabase V5 не настроен');
}
function params(filters: SearchQueriesFilters) {
  const value = assertSearchQueriesFilters(filters);
  return { p_start: value.start, p_end: value.end, p_category: value.category?.trim() || null, p_search: value.search?.trim() || null };
}
async function rpc(name: string, parameters: Record<string, unknown>): Promise<unknown> {
  enabled();
  const { data, error } = await supabase.rpc(name, parameters);
  if (error) throw new Error(`Не удалось загрузить V5 «Поисковые запросы»: ${error.message}`);
  return data;
}
export async function loadSearchQueriesOptions(limit = 500): Promise<SearchQueriesOptions> {
  return parseSearchQueriesOptions(await rpc('v5_search_queries_filter_options', { p_limit: limit }));
}
export async function loadSearchQueriesSummary(filters: SearchQueriesFilters): Promise<SearchQueriesSummary> {
  return parseSearchQueriesSummary(await rpc('v5_search_queries_summary', params(filters)));
}
export async function loadSearchQueriesSeries(filters: SearchQueriesFilters, query?: string | null): Promise<SearchQueriesSeriesRow[]> {
  return parseSearchQueriesSeries(await rpc('v5_search_queries_series', { ...params(filters), p_query: query?.trim() || null }));
}
export async function loadSearchQueriesRows(filters: SearchQueriesFilters, sort: SearchQueriesSort, offset: number, limit: number): Promise<SearchQueriesRow[]> {
  if (!Number.isInteger(offset) || offset < 0 || !Number.isInteger(limit) || limit < 1 || limit > 1000) throw new Error('V5 «Поисковые запросы»: некорректная страница');
  return parseSearchQueriesRows(await rpc('v5_search_queries_rows', { ...params(filters), p_sort: sort, p_offset: offset, p_limit: limit }));
}
