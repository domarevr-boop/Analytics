import { isSupabaseConfigured, supabase } from '../../lib/supabaseClient';
import {
  assertEntryPointsFilters,
  assertEntryPointsMetric,
  parseEntryPointsFilterOptions,
  parseEntryPointsMatrix,
  parseEntryPointsProductLeaders,
  parseEntryPointsSeries,
  parseEntryPointsSummary,
  type EntryPointsFilterOptions,
  type EntryPointsFilters,
  type EntryPointsMatrixRow,
  type EntryPointsMetric,
  type EntryPointsProductLeader,
  type EntryPointsSeriesRow,
  type EntryPointsSummary,
} from './entryPointsDataCore';

const isV5Environment = import.meta.env.VITE_APP_ENV === 'v5-development';
export const isV5EntryPointsBackendEnabled = isV5Environment && import.meta.env.VITE_V5_ENTRY_POINTS_BACKEND_ENABLED === 'true';

function assertEnabled(): void {
  if (!isV5EntryPointsBackendEnabled) throw new Error('Серверное чтение «Точек входа» не включено для этого окружения');
  if (!isSupabaseConfigured) throw new Error('Supabase V5 не настроен');
}

function params(filters: EntryPointsFilters) {
  const value = assertEntryPointsFilters(filters);
  return {
    p_start: value.start, p_end: value.end,
    p_cabinet_ids: value.cabinetIds?.length ? value.cabinetIds : null,
    p_product_ids: value.productIds?.length ? value.productIds : null,
    p_category_ids: value.categoryIds?.length ? value.categoryIds : null,
    p_brand_ids: value.brandIds?.length ? value.brandIds : null,
    p_group_ids: value.groupIds?.length ? value.groupIds : null,
    p_search: value.search?.trim() || null,
    p_section: value.section?.trim() || null,
    p_entry_point: value.entryPoint?.trim() || null,
  };
}

async function rpc(name: string, parameters: Record<string, unknown>): Promise<unknown> {
  assertEnabled();
  const { data, error } = await supabase.rpc(name, parameters);
  if (error) throw new Error(`Не удалось загрузить V5 «Точки входа»: ${error.message}`);
  return data;
}

export async function loadEntryPointsFilterOptions(filters: Pick<EntryPointsFilters, 'start' | 'end' | 'section'>, limit = 500): Promise<EntryPointsFilterOptions> {
  const request = assertEntryPointsFilters({ start: filters.start, end: filters.end, section: filters.section });
  if (!Number.isInteger(limit) || limit < 1 || limit > 500) throw new Error('V5 «Точки входа»: лимит фильтров должен быть от 1 до 500');
  return parseEntryPointsFilterOptions(await rpc('v5_entry_points_filter_options', {
    p_start: request.start, p_end: request.end, p_section: request.section?.trim() || null, p_limit: limit,
  }));
}

export async function loadEntryPointsSummary(filters: EntryPointsFilters): Promise<EntryPointsSummary> {
  return parseEntryPointsSummary(await rpc('v5_entry_points_summary', params(filters)));
}

export async function loadEntryPointsSeries(filters: EntryPointsFilters): Promise<EntryPointsSeriesRow[]> {
  return parseEntryPointsSeries(await rpc('v5_entry_points_series', params(filters)));
}

export async function loadEntryPointsMatrix(filters: EntryPointsFilters, metric: EntryPointsMetric = 'orders', limit = 100): Promise<EntryPointsMatrixRow[]> {
  if (!Number.isInteger(limit) || limit < 1 || limit > 200) throw new Error('V5 «Точки входа»: лимит матрицы должен быть от 1 до 200');
  return parseEntryPointsMatrix(await rpc('v5_entry_points_matrix', { ...params(filters), p_metric: assertEntryPointsMetric(metric), p_limit: limit }));
}

export async function loadEntryPointsProductLeaders(
  filters: Pick<EntryPointsFilters, 'start' | 'end' | 'cabinetIds' | 'categoryIds' | 'groupIds'>,
  sectionQuery: string,
  metric: EntryPointsMetric = 'orders',
  limit = 5,
): Promise<EntryPointsProductLeader[]> {
  const request = assertEntryPointsFilters(filters);
  const query = sectionQuery.trim();
  if (!query || query.length > 100) throw new Error('V5 «Точки входа»: запрос раздела должен содержать от 1 до 100 символов');
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error('V5 «Точки входа»: лимит товаров должен быть от 1 до 100');
  return parseEntryPointsProductLeaders(await rpc('v5_entry_points_product_leaders', {
    p_start: request.start, p_end: request.end, p_section_query: query, p_metric: assertEntryPointsMetric(metric),
    p_cabinet_ids: request.cabinetIds?.length ? request.cabinetIds : null,
    p_category_ids: request.categoryIds?.length ? request.categoryIds : null,
    p_group_ids: request.groupIds?.length ? request.groupIds : null,
    p_limit: limit,
  }));
}
