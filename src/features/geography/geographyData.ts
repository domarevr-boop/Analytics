import { isSupabaseConfigured, supabase } from '../../lib/supabaseClient';
import {
  assertGeographyFilters,
  assertGeographyFulfillment,
  assertGeographyLevel,
  parseGeographyFilterOptions,
  parseGeographyLocations,
  parseGeographyProductLeaders,
  parseGeographySeries,
  parseGeographySummary,
  type GeographyDataFilters,
  type GeographyFilterOptions,
  type GeographyFulfillment,
  type GeographyLevel,
  type GeographyLocationPage,
  type GeographyProductLeader,
  type GeographySeriesRow,
  type GeographySummaryRow,
} from './geographyDataCore';

const isV5Environment = import.meta.env.VITE_APP_ENV === 'v5-development';
export const isV5GeographyBackendEnabled = isV5Environment && import.meta.env.VITE_V5_GEOGRAPHY_BACKEND_ENABLED === 'true';

function assertEnabled(): void {
  if (!isV5GeographyBackendEnabled) throw new Error('Серверное чтение «Географии» не включено для этого окружения');
  if (!isSupabaseConfigured) throw new Error('Supabase V5 не настроен');
}

function params(filters: GeographyDataFilters) {
  const value = assertGeographyFilters(filters);
  return {
    p_start: value.start, p_end: value.end,
    p_cabinet_ids: value.cabinetIds?.length ? value.cabinetIds : null,
    p_product_ids: value.productIds?.length ? value.productIds : null,
    p_region: value.region?.trim() || null, p_area: value.area?.trim() || null, p_city: value.city?.trim() || null,
  };
}

export async function loadGeographyFilterOptions(filters: GeographyDataFilters, limit = 500): Promise<GeographyFilterOptions> {
  assertEnabled();
  const request = params(filters);
  if (!Number.isInteger(limit) || limit < 1 || limit > 500) throw new Error('V5 «География»: лимит фильтров должен быть от 1 до 500');
  const { data, error } = await supabase.rpc('v5_geography_filter_options', { p_start: request.p_start, p_end: request.p_end, p_region: request.p_region, p_area: request.p_area, p_limit: limit });
  if (error) throw new Error(`Не удалось загрузить фильтры «Географии» V5: ${error.message}`);
  return parseGeographyFilterOptions(data);
}

export async function loadGeographySummary(filters: GeographyDataFilters): Promise<GeographySummaryRow[]> {
  assertEnabled();
  const { data, error } = await supabase.rpc('v5_geography_summary', params(filters));
  if (error) throw new Error(`Не удалось загрузить сводку «Географии» V5: ${error.message}`);
  return parseGeographySummary(data);
}

export async function loadGeographySeries(filters: GeographyDataFilters): Promise<GeographySeriesRow[]> {
  assertEnabled();
  const { data, error } = await supabase.rpc('v5_geography_series', params(filters));
  if (error) throw new Error(`Не удалось загрузить динамику «Географии» V5: ${error.message}`);
  return parseGeographySeries(data);
}

export async function loadGeographyLocations(
  filters: GeographyDataFilters,
  level: GeographyLevel,
  fulfillment: GeographyFulfillment,
  limit = 100,
  offset = 0,
): Promise<GeographyLocationPage> {
  assertEnabled();
  const request = params(filters);
  if (!Number.isInteger(limit) || limit < 1 || limit > 200) throw new Error('V5 «География»: размер страницы должен быть от 1 до 200');
  if (!Number.isInteger(offset) || offset < 0 || offset > 100_000) throw new Error('V5 «География»: смещение должно быть от 0 до 100000');
  const { data, error } = await supabase.rpc('v5_geography_locations', {
    ...request, p_level: assertGeographyLevel(level), p_fulfillment: assertGeographyFulfillment(fulfillment), p_limit: limit, p_offset: offset,
  });
  if (error) throw new Error(`Не удалось загрузить локации «Географии» V5: ${error.message}`);
  return parseGeographyLocations(data);
}

export async function loadGeographyProductLeaders(
  filters: GeographyDataFilters,
  fulfillment: GeographyFulfillment,
  limit = 20,
): Promise<GeographyProductLeader[]> {
  assertEnabled();
  const request = params(filters);
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error('V5 «География»: лимит товаров должен быть от 1 до 100');
  const { data, error } = await supabase.rpc('v5_geography_product_leaders', {
    p_start: request.p_start, p_end: request.p_end, p_fulfillment: assertGeographyFulfillment(fulfillment),
    p_region: request.p_region, p_area: request.p_area, p_city: request.p_city, p_limit: limit,
  });
  if (error) throw new Error(`Не удалось загрузить товары «Географии» V5: ${error.message}`);
  return parseGeographyProductLeaders(data);
}
