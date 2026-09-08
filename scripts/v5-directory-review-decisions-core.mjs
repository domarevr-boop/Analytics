import { fingerprintDirectoryReview } from './v5-directory-review-core.mjs';

function clean(value) {
  return value == null ? '' : String(value).trim();
}

function reviewKey(item) {
  const ids = Array.isArray(item.legacyProductIds) ? [...item.legacyProductIds].map(clean).filter(Boolean).sort() : [];
  return `${clean(item.type) || 'unknown'}:${ids.join('+')}`;
}

function issue(errors, code, reviewIndex = null) {
  errors.push({ code, reviewIndex });
}

function normalizedIdentity(value) {
  return clean(value).toLocaleLowerCase('ru-RU');
}

export function validateDirectoryReviewDecisions(manifest, decisionFile) {
  const errors = [];
  if (!manifest || typeof manifest !== 'object' || !Array.isArray(manifest.reviewQueue)) return [{ code: 'invalid_manifest', reviewIndex: null }];
  if (!decisionFile || typeof decisionFile !== 'object' || decisionFile.schemaVersion !== 1 || !Array.isArray(decisionFile.decisions)) {
    return [{ code: 'invalid_decision_file', reviewIndex: null }];
  }
  if (decisionFile.sourceBackupSha256 !== manifest.source?.sha256) issue(errors, 'source_hash_mismatch');
  if (decisionFile.reviewFingerprint !== fingerprintDirectoryReview(manifest.reviewQueue)) issue(errors, 'review_fingerprint_mismatch');
  if (decisionFile.decisions.length !== manifest.reviewQueue.length) issue(errors, 'decision_count_mismatch');

  const cabinets = new Set((manifest.cabinets || []).map(row => clean(row.externalKey)));
  const brands = new Set((manifest.brands || []).map(row => clean(row.externalKey)));
  const groupCabinet = new Map((manifest.groups || []).map(row => [clean(row.externalKey), clean(row.cabinetExternalKey)]));
  const occupiedIdentities = new Map();
  for (const product of manifest.products || []) {
    for (const identity of [product.sellerSku, product.wbSku]) {
      const normalized = normalizedIdentity(identity);
      if (normalized) occupiedIdentities.set(`${clean(product.cabinetExternalKey)}|${normalized}`, 'accepted');
    }
  }
  for (const alias of manifest.aliases || []) {
    const normalized = normalizedIdentity(alias.value);
    if (normalized) occupiedIdentities.set(`${clean(alias.cabinetExternalKey)}|${normalized}`, 'accepted');
  }

  const decisionsByKey = new Map();
  decisionFile.decisions.forEach((decision, index) => {
    const key = clean(decision?.reviewKey);
    if (!key || decisionsByKey.has(key)) issue(errors, 'duplicate_or_missing_review_key', index + 1);
    else decisionsByKey.set(key, decision);
  });

  manifest.reviewQueue.forEach((reviewItem, index) => {
    const itemIndex = index + 1;
    const key = reviewKey(reviewItem);
    const decision = decisionsByKey.get(key);
    if (!decision) {
      issue(errors, 'missing_decision', itemIndex);
      return;
    }
    if (decision.reviewIndex !== itemIndex || decision.type !== reviewItem.type) issue(errors, 'decision_metadata_mismatch', itemIndex);
    if (!['merge', 'split', 'exclude'].includes(decision.action)) {
      issue(errors, 'unresolved_decision', itemIndex);
      return;
    }
    if (decision.action === 'exclude') {
      if (!clean(decision.note)) issue(errors, 'exclude_note_required', itemIndex);
      if (decision.resolution != null) issue(errors, 'exclude_resolution_must_be_null', itemIndex);
      return;
    }
    const resolvedProducts = decision.resolution?.products;
    if (!Array.isArray(resolvedProducts) || resolvedProducts.length < (decision.action === 'split' ? 2 : 1)) {
      issue(errors, 'invalid_resolution_products', itemIndex);
      return;
    }
    if (decision.action === 'merge' && resolvedProducts.length !== 1) issue(errors, 'merge_requires_one_product', itemIndex);

    const expectedIds = new Set((reviewItem.legacyProductIds || []).map(clean));
    const assignedIds = new Set();
    const targetByLegacyId = new Map();
    resolvedProducts.forEach((product, productIndex) => {
      const cabinet = clean(product?.cabinetExternalKey);
      const legacyIds = Array.isArray(product?.legacyProductIds) ? product.legacyProductIds.map(clean).filter(Boolean) : [];
      if (!cabinet || !cabinets.has(cabinet)) issue(errors, 'unknown_resolution_cabinet', itemIndex);
      if (!clean(product?.name)) issue(errors, 'resolution_name_required', itemIndex);
      if (!['active', 'archived'].includes(product?.status)) issue(errors, 'invalid_resolution_status', itemIndex);
      if (!legacyIds.length) issue(errors, 'resolution_legacy_ids_required', itemIndex);
      for (const legacyId of legacyIds) {
        if (!expectedIds.has(legacyId) || assignedIds.has(legacyId)) issue(errors, 'invalid_legacy_id_partition', itemIndex);
        assignedIds.add(legacyId);
        targetByLegacyId.set(legacyId, productIndex);
      }
      const identities = [product?.sellerSku, product?.wbSku, ...(Array.isArray(product?.aliases) ? product.aliases : [])]
        .map(normalizedIdentity).filter(Boolean);
      if (!identities.length) issue(errors, 'resolution_identity_required', itemIndex);
      const localIdentities = new Set();
      for (const identity of identities) {
        const identityKey = `${cabinet}|${identity}`;
        if (localIdentities.has(identity) || occupiedIdentities.has(identityKey)) issue(errors, 'resolution_identity_conflict', itemIndex);
        localIdentities.add(identity);
        occupiedIdentities.set(identityKey, `${itemIndex}:${productIndex}`);
      }
      const brandExternalKey = clean(product?.brandExternalKey);
      if (brandExternalKey && !brands.has(brandExternalKey) && !clean(product?.brandName)) issue(errors, 'new_brand_name_required', itemIndex);
    });
    if (assignedIds.size !== expectedIds.size || [...expectedIds].some(id => !assignedIds.has(id))) issue(errors, 'incomplete_legacy_id_partition', itemIndex);

    for (const history of reviewItem.groupHistoryCandidates || []) {
      const legacyId = clean(history.legacyProductId);
      const productIndex = targetByLegacyId.get(legacyId);
      if (productIndex == null) continue;
      const targetCabinet = clean(resolvedProducts[productIndex]?.cabinetExternalKey);
      const legacyGroupId = clean(history.legacyGroupId);
      if (!['grp-ungrouped', '__ungrouped__'].includes(legacyGroupId) && groupCabinet.get(legacyGroupId) !== targetCabinet) {
        issue(errors, 'history_group_cabinet_mismatch', itemIndex);
      }
    }
  });

  return errors;
}

export function summarizeDirectoryDecisionErrors(errors) {
  return Object.entries(errors.reduce((summary, error) => {
    summary[error.code] = (summary[error.code] || 0) + 1;
    return summary;
  }, {})).map(([code, count]) => ({ code, count }));
}
