import assert from 'node:assert/strict';
import test from 'node:test';

import { getV5Capabilities, isV5PageAllowed, normalizeV5Access } from './v5AccessCore.ts';

test('normalizes the current V5 access row', () => {
  assert.deepEqual(normalizeV5Access([{
    access_role: 'importer',
    all_cabinets: false,
    cabinet_ids: ['cabinet-a', null, 42],
  }]), {
    role: 'importer',
    allCabinets: false,
    cabinetIds: ['cabinet-a'],
  });
});

test('rejects missing and unknown V5 roles', () => {
  assert.equal(normalizeV5Access([]), null);
  assert.equal(normalizeV5Access([{ access_role: 'owner' }]), null);
});

test('maps viewer, importer and admin to least-privilege UI capabilities', () => {
  assert.deepEqual(getV5Capabilities({ role: 'viewer', allCabinets: true, cabinetIds: [] }), {
    canRead: true,
    canImport: false,
    canManage: false,
  });
  assert.deepEqual(getV5Capabilities({ role: 'importer', allCabinets: true, cabinetIds: [] }), {
    canRead: true,
    canImport: true,
    canManage: false,
  });
  assert.deepEqual(getV5Capabilities({ role: 'admin', allCabinets: true, cabinetIds: [] }), {
    canRead: true,
    canImport: true,
    canManage: true,
  });
  assert.deepEqual(getV5Capabilities(null), {
    canRead: false,
    canImport: false,
    canManage: false,
  });
});

test('exposes only migrated server scenarios to non-admin V5 roles', () => {
  const viewer = { role: 'viewer' as const, allCabinets: true, cabinetIds: [] };
  const importer = { role: 'importer' as const, allCabinets: true, cabinetIds: [] };
  const admin = { role: 'admin' as const, allCabinets: true, cabinetIds: [] };

  assert.equal(isV5PageAllowed(viewer, 'market'), true);
  assert.equal(isV5PageAllowed(viewer, 'import'), false);
  assert.equal(isV5PageAllowed(viewer, 'dashboard'), false);
  assert.equal(isV5PageAllowed(importer, 'market'), true);
  assert.equal(isV5PageAllowed(importer, 'import'), true);
  assert.equal(isV5PageAllowed(importer, 'client-experience'), false);
  assert.equal(isV5PageAllowed(admin, 'dashboard'), true);
  assert.equal(isV5PageAllowed(admin, 'dictionary'), true);
});
