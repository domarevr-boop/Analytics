import assert from 'node:assert/strict';
import test from 'node:test';

import { getV5Capabilities, isV5PageAllowed, normalizeV5Access } from './v5AccessCore.ts';

test('active V5 user receives one full-access capability set', () => {
  const access = normalizeV5Access([{
    access_role: 'admin',
    all_cabinets: true,
    cabinet_ids: [],
  }]);

  assert.deepEqual(access, { role: 'admin', allCabinets: true, cabinetIds: [] });
  assert.deepEqual(getV5Capabilities(access), {
    canRead: true,
    canImport: true,
    canManage: true,
  });
  for (const page of ['dashboard', 'market', 'import', 'admin', 'dictionary'] as const) {
    assert.equal(isV5PageAllowed(access, page), true);
  }
});

test('missing and legacy limited roles cannot enter V5', () => {
  assert.equal(normalizeV5Access([]), null);
  assert.equal(normalizeV5Access([{ access_role: 'viewer', all_cabinets: true }]), null);
  assert.equal(normalizeV5Access([{ access_role: 'importer', all_cabinets: true }]), null);
  assert.equal(normalizeV5Access([{ access_role: 'admin', all_cabinets: false }]), null);
  assert.deepEqual(getV5Capabilities(null), {
    canRead: false,
    canImport: false,
    canManage: false,
  });
  assert.equal(isV5PageAllowed(null, 'market'), false);
});
