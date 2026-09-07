import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { inspectV4Backup } from './inspect-v4-backup.mjs';

test('counts V4 backup sections without returning row contents', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'analytics-v4-inspect-'));
  const filePath = join(directory, 'backup.json');
  try {
    await writeFile(filePath, JSON.stringify({
      version: 'v4.0',
      exportedAt: '2026-09-06T15:49:11.425Z',
      data: {
        cabinets: [{ id: 'cab-1', name: 'Cabinet' }],
        products: [
          { id: 'p1', cabinet_id: 'cab-1', sku: '100', wb_sku: '900', aliases: ['old-100'], name: 'A string with escaped quote: \\"' },
          { id: 'p2', cabinet_id: 'cab-1', sku: '101', wb_sku: '901', nested: { value: 1 }, tags: ['a', 'b'] },
        ],
        groups: [{ id: 'g1', cabinet_id: 'cab-1', name: 'Group' }],
        memberships: [{ product_id: 'p1', group_id: 'g1' }],
        groupHistory: [{ date: '2026-08-25', product_id: 'p1', group_id: 'g1' }],
      },
    }));
    const result = await inspectV4Backup(filePath);
    assert.equal(result.version, 'v4.0');
    assert.equal(result.counts.cabinets, 1);
    assert.equal(result.counts.products, 2);
    assert.equal(result.counts.groupHistory, 1);
    assert.equal(result.counts.metrics, 0);
    assert.deepEqual(result.catalogDiagnostics, {
      cabinetsWithUnknownId: 0,
      groupsWithoutCabinet: 0,
      groupsWithUnknownCabinet: 0,
      productsWithoutCabinet: 0,
      productsWithUnknownCabinet: 0,
      productsWithoutIdentity: 0,
      duplicateSellerSkuWithinCabinet: 0,
      duplicateWbSkuWithinCabinet: 0,
      collidingIdentityOrAliasWithinCabinet: 0,
      duplicateMemberships: 0,
      membershipUnknownProduct: 0,
      membershipUnknownGroup: 0,
      membershipCabinetMismatch: 0,
      duplicateHistoryRows: 0,
      historyUnknownProduct: 0,
      historyUnknownGroup: 0,
      historyCabinetMismatch: 0,
      explicitUngroupedHistoryRows: 0,
      canonicalProductsAfterExactIdentityMerge: 2,
      collisionComponents: 0,
      productsInCollisionComponents: 0,
      largestCollisionComponent: 0,
      ambiguousComponentsWithMultipleWbSku: 0,
      ambiguousComponentsWithMultipleCredibleSellerSku: 0,
      identitiesUsedAcrossCabinets: 0,
    });
    assert.equal('data' in result, false);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('rejects another backup version', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'analytics-v4-inspect-'));
  const filePath = join(directory, 'backup.json');
  try {
    await writeFile(filePath, JSON.stringify({ version: 'v3.0', exportedAt: '2026-09-06', data: {} }));
    await assert.rejects(() => inspectV4Backup(filePath), /not a supported V4 backup/iu);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
