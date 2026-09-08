import { isSupabaseConfigured, supabase } from '../../lib/supabaseClient';
import {
  assertV5DirectoryPageRequest,
  parseV5DirectoryFilters,
  parseV5DirectorySnapshot,
  type V5DirectoryFilters,
  type V5DirectoryPage,
  type V5DirectoryPageRequest,
} from './directoryDataCore';

const isV5Environment = import.meta.env.VITE_APP_ENV === 'v5-development';
export const isV5DirectoryBackendEnabled = isV5Environment && import.meta.env.VITE_V5_DIRECTORY_BACKEND_ENABLED === 'true';

function assertDirectoryBackendEnabled(): void {
  if (!isV5DirectoryBackendEnabled) throw new Error('Серверное чтение справочника не включено для этого окружения');
  if (!isSupabaseConfigured) throw new Error('Supabase V5 не настроен');
}

export async function loadV5DirectoryPage(request: V5DirectoryPageRequest): Promise<V5DirectoryPage> {
  assertDirectoryBackendEnabled();
  const normalized = assertV5DirectoryPageRequest(request);
  const { data, error } = await supabase.rpc('v5_directory_snapshot', {
    p_as_of: normalized.asOf,
    p_cabinet_id: normalized.cabinetId,
    p_search: normalized.search,
    p_limit: normalized.limit,
    p_offset: normalized.offset,
  });
  if (error) throw new Error(`Не удалось загрузить справочник V5: ${error.message}`);
  return parseV5DirectorySnapshot(data);
}

export async function loadV5DirectoryFilters(): Promise<V5DirectoryFilters> {
  assertDirectoryBackendEnabled();
  const { data, error } = await supabase.rpc('v5_directory_filters');
  if (error) throw new Error(`Не удалось загрузить фильтры справочника V5: ${error.message}`);
  return parseV5DirectoryFilters(data);
}
