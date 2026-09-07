import { supabase } from '../lib/supabaseClient';
import { normalizeV5Access } from './v5AccessCore';
import type { V5Access } from './v5AccessCore';

export { getV5Capabilities, isV5PageAllowed, normalizeV5Access } from './v5AccessCore';
export type { V5Access, V5AccessRole, V5Capabilities } from './v5AccessCore';

export async function fetchV5Access(): Promise<V5Access | null> {
  const { data, error } = await supabase.rpc('v5_my_access');
  if (error) throw error;
  return normalizeV5Access(data);
}
