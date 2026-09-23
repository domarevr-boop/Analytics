import type { PageName } from '../types';

// The database keeps `admin` as the legacy enum value for the single full-access user.
export type V5AccessRole = 'admin';

export interface V5Access {
  role: V5AccessRole;
  allCabinets: boolean;
  cabinetIds: string[];
}

export interface V5Capabilities {
  canRead: boolean;
  canImport: boolean;
  canManage: boolean;
}

export function normalizeV5Access(value: unknown): V5Access | null {
  const row = Array.isArray(value) ? value[0] : value;
  if (!row || typeof row !== 'object') return null;

  const candidate = row as Record<string, unknown>;
  const role = candidate.access_role;
  if (role !== 'admin' || candidate.all_cabinets !== true) return null;

  return {
    role: 'admin',
    allCabinets: true,
    cabinetIds: [],
  };
}

export function getV5Capabilities(access: V5Access | null): V5Capabilities {
  const allowed = access?.role === 'admin' && access.allCabinets;
  return {
    canRead: allowed,
    canImport: allowed,
    canManage: allowed,
  };
}

export function isV5PageAllowed(access: V5Access | null, page: PageName): boolean {
  return Boolean(page && access?.role === 'admin' && access.allCabinets);
}
