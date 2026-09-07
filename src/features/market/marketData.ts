import { isSupabaseConfigured, supabase } from '../../lib/supabaseClient';
import type { MarketDynamicsRecord } from '../../types';
import { assertV5MarketRange, mapV5MarketSeries, parseV5MarketBounds, type V5MarketBounds } from './marketDataCore';

export interface V5MarketData {
  bounds: V5MarketBounds;
  records: MarketDynamicsRecord[];
}

const isV5Environment = import.meta.env.VITE_APP_ENV === 'v5-development';
export const isV5MarketBackendEnabled = isV5Environment && import.meta.env.VITE_V5_MARKET_BACKEND_ENABLED === 'true';

export async function loadV5MarketData(): Promise<V5MarketData> {
  if (!isV5MarketBackendEnabled) throw new Error('Серверное чтение «Рынка» не включено для этого окружения');
  if (!isSupabaseConfigured) throw new Error('Supabase V5 не настроен');

  const { data: boundsData, error: boundsError } = await supabase.rpc('v5_market_date_bounds');
  if (boundsError) throw new Error(`Не удалось получить период V5 «Рынка»: ${boundsError.message}`);
  const bounds = parseV5MarketBounds(boundsData);
  assertV5MarketRange(bounds);
  if (!bounds.minDate || !bounds.maxDate) return { bounds, records: [] };

  const { data: seriesData, error: seriesError } = await supabase.rpc('v5_market_series', {
    p_start: bounds.minDate,
    p_end: bounds.maxDate,
    p_granularity: 'day',
  });
  if (seriesError) throw new Error(`Не удалось загрузить V5 «Рынок»: ${seriesError.message}`);

  const records = mapV5MarketSeries(seriesData);
  if (records.length !== bounds.dayCount) {
    throw new Error(`V5 «Рынок»: ожидалось ${bounds.dayCount} дней, получено ${records.length}`);
  }
  return { bounds, records };
}
