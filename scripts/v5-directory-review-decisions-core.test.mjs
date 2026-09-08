import test from 'node:test';
import assert from 'node:assert/strict';
import { buildDirectoryReviewArtifacts } from './v5-directory-review-core.mjs';
import { summarizeDirectoryDecisionErrors, validateDirectoryReviewDecisions } from './v5-directory-review-decisions-core.mjs';

function fixture() {
  const manifest = {
    source: { sha256: 'b'.repeat(64) },
    cabinets: [{ externalKey: 'cab-1' }],
    brands: [], categories: [], aliases: [], products: [],
    groups: [{ externalKey: 'g1', cabinetExternalKey: 'cab-1' }],
    reviewQueue: [{
      type: 'product_identity', legacyProductIds: ['p1', 'p2'], reasons: ['multiple_seller_sku'], candidates: [],
      groupHistoryCandidates: [{ legacyProductId: 'p1', date: '2026-08-25', legacyGroupId: 'g1', source: 'import' }],
    }],
  };
  const decisions = buildDirectoryReviewArtifacts(manifest).decisions;
  return { manifest, decisions };
}

test('accepts an explicit merge that assigns every legacy id once', () => {
  const { manifest, decisions } = fixture();
  decisions.decisions[0].action = 'merge';
  decisions.decisions[0].resolution = { products: [{
    legacyProductIds: ['p1', 'p2'], cabinetExternalKey: 'cab-1', sellerSku: '40001', wbSku: '223155786',
    name: 'Люстра', category: 'Люстры', brandExternalKey: null, brandName: null, aliases: [], status: 'active',
  }] };
  assert.deepEqual(validateDirectoryReviewDecisions(manifest, decisions), []);
});

test('rejects unresolved, stale and incomplete decisions without exposing row data', () => {
  const { manifest, decisions } = fixture();
  decisions.reviewFingerprint = 'c'.repeat(64);
  let summary = summarizeDirectoryDecisionErrors(validateDirectoryReviewDecisions(manifest, decisions));
  assert.deepEqual(summary, [
    { code: 'review_fingerprint_mismatch', count: 1 },
    { code: 'unresolved_decision', count: 1 },
  ]);

  decisions.reviewFingerprint = buildDirectoryReviewArtifacts(manifest).decisions.reviewFingerprint;
  decisions.decisions[0].action = 'split';
  decisions.decisions[0].resolution = { products: [
    { legacyProductIds: ['p1'], cabinetExternalKey: 'cab-1', sellerSku: '40001', name: 'One', status: 'active', aliases: [] },
    { legacyProductIds: ['p1'], cabinetExternalKey: 'cab-1', sellerSku: '40001', name: 'Two', status: 'active', aliases: [] },
  ] };
  summary = summarizeDirectoryDecisionErrors(validateDirectoryReviewDecisions(manifest, decisions));
  assert.ok(summary.some(error => error.code === 'invalid_legacy_id_partition'));
  assert.ok(summary.some(error => error.code === 'incomplete_legacy_id_partition'));
  assert.ok(summary.some(error => error.code === 'resolution_identity_conflict'));
});
