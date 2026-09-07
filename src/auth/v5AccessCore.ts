import type { PageName } from '../types';

export type V5AccessRole = 'viewer' | 'importer' | 'admin';

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

const V5_ROLES = new Set<V5AccessRole>(['viewer', 'importer', 'admin']);

export function normalizeV5Access(value: unknown): V5Access | null {
  const row = Array.isArray(value) ? value[0] : value;
  if (!row || typeof row !== 'object') return null;

  const candidate = row as Record<string, unknown>;
  const role = candidate.access_role;
  if (typeof role !== 'string' || !V5_ROLES.has(role as V5AccessRole)) return null;

  return {
    role: role as V5AccessRole,
    allCabinets: candidate.all_cabinets === true,
    cabinetIds: Array.isArray(candidate.cabinet_ids)
      ? candidate.cabinet_ids.filter((id): id is string => typeof id === 'string')
      : [],
  };
}

export function getV5Capabilities(access: V5Access | null): V5Capabilities {
  const role = access?.role;
  return {
    canRead: role === 'viewer' || role === 'importer' || role === 'admin',
    canImport: role === 'importer' || role === 'admin',
    canManage: role === 'admin',
  };
}

export function isV5PageAllowed(access: V5Access | null, page: PageName): boolean {
  if (access?.role === 'admin') return true;
  if (page === 'market') return access?.role === 'viewer' || access?.role === 'importer';
  if (page === 'import') return access?.role === 'importer';
  return false;
}
