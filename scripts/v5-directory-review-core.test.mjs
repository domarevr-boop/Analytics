import test from 'node:test';
import assert from 'node:assert/strict';
import { buildDirectoryReviewArtifacts } from './v5-directory-review-core.mjs';

const manifest = {
  source: { sha256: 'a'.repeat(64) },
  reviewQueue: [{
    type: 'product_identity',
    legacyProductIds: ['legacy-2', 'legacy-1'],
    reasons: ['multiple_wb_sku'],
    candidates: [{
      legacyProductId: 'legacy-1', cabinetExternalKey: 'cabinet-1', sellerSku: '40|001', wbSku: '223155786',
      name: 'Люстра\nпотолочная', category: 'Люстры', brandExternalKey: null, aliases: ['old-1'], status: 'active',
    }],
  }],
};

test('builds a local review report and a blank machine-readable decision', () => {
  const artifacts = buildDirectoryReviewArtifacts(manifest);
  assert.match(artifacts.report, /несколько WB ID/u);
  assert.match(artifacts.report, /40\\\|001/u);
  assert.doesNotMatch(artifacts.report, /Люстра\nпотолочная/u);
  assert.equal(artifacts.decisions.sourceManifestSha256, 'a'.repeat(64));
  assert.deepEqual(artifacts.decisions.decisions[0], {
    reviewKey: 'product_identity:legacy-1+legacy-2',
    reviewIndex: 1,
    type: 'product_identity',
    legacyProductIds: ['legacy-2', 'legacy-1'],
    reasons: ['multiple_wb_sku'],
    action: null,
    note: '',
    resolution: null,
  });
});

test('rejects a manifest without trusted source lineage', () => {
  assert.throws(() => buildDirectoryReviewArtifacts({ reviewQueue: [] }), /source hash/);
});
