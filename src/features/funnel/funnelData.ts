import { isSupabaseConfigured, supabase } from '../../lib/supabaseClient';
import {
  assertFunnelFilters, assertFunnelSort, parseFunnelBounds, parseFunnelFilterOptions, parseFunnelRows, parseFunnelSeries, parseFunnelSummary,
  type FunnelBounds, type FunnelFilterOptions, type FunnelFilters, type FunnelRow, type FunnelSeriesRow, type FunnelSort, type FunnelSummary,
} from './funnelDataCore';

const isV5Environment = import.meta.env.VITE_APP_ENV === 'v5-development';
export const isV5FunnelBackendEnabled = isV5Environment && import.meta.env.VITE_V5_FUNNEL_BACKEND_ENABLED === 'true';

function assertEnabled() {
  if (!isV5FunnelBackendEnabled) throw new Error('Серверное чтение «Воронки» не включено для этого окружения');
  if (!isSupabaseConfigured) throw new Error('Supabase V5 не настроен');
}
async function rpc(name: string, parameters: Record<string, unknown> = {}): Promise<unknown> {
  assertEnabled(); const { data, error } = await supabase.rpc(name, parameters);
  if (error) throw new Error(`Не удалось загрузить V5 «Воронку»: ${error.message}`);
  return data;
}
function params(filters: FunnelFilters) {
  const value = assertFunnelFilters(filters);
  return { p_start: value.start, p_end: value.end,
    p_cabinet_ids: value.cabinetIds?.length ? value.cabinetIds : null,
    p_product_ids: value.productIds?.length ? value.productIds : null,
    p_category_ids: value.categoryIds?.length ? value.categoryIds : null,
    p_brand_ids: value.brandIds?.length ? value.brandIds : null,
    p_group_ids: value.groupIds?.length ? value.groupIds : null,
    p_search: value.search?.trim() || null };
}

export async function loadFunnelBounds(): Promise<FunnelBounds> { return parseFunnelBounds(await rpc('v5_funnel_bounds')); }
export async function loadFunnelFilterOptions(filters: Pick<FunnelFilters, 'start' | 'end'>, limit = 500): Promise<FunnelFilterOptions> {
  const value = assertFunnelFilters(filters);
  if (!Number.isInteger(limit) || limit < 1 || limit > 500) throw new Error('V5 «Воронка»: лимит фильтров должен быть от 1 до 500');
  return parseFunnelFilterOptions(await rpc('v5_funnel_filter_options', { p_start: value.start, p_end: value.end, p_limit: limit }));
}
export async function loadFunnelSummary(filters: FunnelFilters): Promise<FunnelSummary> { return parseFunnelSummary(await rpc('v5_funnel_summary', params(filters))); }
export async function loadFunnelSeries(filters: FunnelFilters): Promise<FunnelSeriesRow[]> { return parseFunnelSeries(await rpc('v5_funnel_series', params(filters))); }
export async function loadFunnelRows(filters: FunnelFilters, sort: FunnelSort, offset = 0, limit = 100): Promise<FunnelRow[]> {
  if (!Number.isInteger(offset) || offset < 0 || offset > 100000) throw new Error('V5 «Воронка»: некорректное смещение');
  if (!Number.isInteger(limit) || limit < 1 || limit > 1000) throw new Error('V5 «Воронка»: лимит строк должен быть от 1 до 1000');
  return parseFunnelRows(await rpc('v5_funnel_rows', { ...params(filters), p_sort: assertFunnelSort(sort), p_offset: offset, p_limit: limit }));
}
