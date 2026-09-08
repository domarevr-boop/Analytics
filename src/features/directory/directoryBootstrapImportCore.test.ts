import assert from 'node:assert/strict';
import test from 'node:test';
import { parseDirectoryBootstrapManifest } from './directoryBootstrapImportCore.ts';

function manifest(overrides: Record<string, unknown> = {}) {
  return JSON.stringify({
    schemaVersion: 1,
    source: { version: 'v4.0', exportedAt: '2026-09-06T00:00:00Z', sizeBytes: 10, sha256: 'a'.repeat(64) },
    summary: { sourceProducts: 1, acceptedProducts: 1, acceptedAliases: 0, acceptedGroups: 1, acceptedHistoryRows: 1, queuedProductComponents: 0 },
    cabinets: [{}],
    brands: [],
    categories: [],
    groups: [{}],
    products: [{}],
    aliases: [],
    groupHistory: [{}],
    legacyProductMap: [{}],
    reviewQueue: [],
    ...overrides,
  });
}

test('accepts the bounded V4 directory bootstrap contract', () => {
  const parsed = parseDirectoryBootstrapManifest(manifest());
  assert.equal(parsed.schemaVersion, 1);
  assert.equal(parsed.summary.acceptedProducts, 1);
  assert.equal(parsed.source.sha256, 'a'.repeat(64));
});

test('rejects malformed sources, missing arrays and inconsistent summary counts', () => {
  assert.throws(() => parseDirectoryBootstrapManifest('{'), /некорректный JSON/);
  assert.throws(() => parseDirectoryBootstrapManifest(manifest({ source: { version: 'v3.0' } })), /backup V4/);
  assert.throws(() => parseDirectoryBootstrapManifest(manifest({ products: null })), /products должен быть массивом/);
  assert.throws(() => parseDirectoryBootstrapManifest(manifest({ products: [{}, {}] })), /acceptedProducts/);
});
