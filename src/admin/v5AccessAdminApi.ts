import { supabase } from '../lib/supabaseClient';
import type { V5AccessRole } from '../auth/v5AccessCore';

export interface V5AccessUserRow {
  userId: string;
  email: string | null;
  createdAt: string;
  lastSignInAt: string | null;
  accessRole: V5AccessRole | null;
  allCabinets: boolean;
  isActive: boolean;
  cabinetIds: string[];
}

function mapDirectoryRow(value: Record<string, unknown>): V5AccessUserRow {
  const role = value.access_role;
  return {
    userId: String(value.user_id || ''),
    email: typeof value.email === 'string' ? value.email : null,
    createdAt: String(value.created_at || ''),
    lastSignInAt: typeof value.last_sign_in_at === 'string' ? value.last_sign_in_at : null,
    accessRole: role === 'viewer' || role === 'importer' || role === 'admin' ? role : null,
    allCabinets: value.all_cabinets === true,
    isActive: value.is_active === true,
    cabinetIds: Array.isArray(value.cabinet_ids)
      ? value.cabinet_ids.filter((id): id is string => typeof id === 'string')
      : [],
  };
}

export async function listV5AccessUsers(): Promise<V5AccessUserRow[]> {
  const { data, error } = await supabase.rpc('v5_admin_user_directory');
  if (error) throw error;
  return Array.isArray(data) ? data.map(row => mapDirectoryRow(row as Record<string, unknown>)) : [];
}

export async function setV5UserAccess(
  userId: string,
  accessRole: V5AccessRole,
  allCabinets: boolean,
  isActive: boolean,
): Promise<void> {
  const { error } = await supabase.rpc('v5_admin_set_user_access', {
    p_user_id: userId,
    p_access_role: accessRole,
    p_all_cabinets: allCabinets,
    p_is_active: isActive,
  });
  if (error) throw error;
}
