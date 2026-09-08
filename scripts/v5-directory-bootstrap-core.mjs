function clean(value) {
  return String(value ?? '').replace(/\u00a0/gu, ' ').trim().replace(/\.0+$/u, '');
}

function distinct(values) {
  return [...new Set(values.map(clean).filter(Boolean))].sort((left, right) => left.localeCompare(right));
}

function slug(value) {
  return clean(value).toLocaleLowerCase('ru-RU').replace(/[^a-zа-яё0-9]+/gui, '-').replace(/^-|-$/gu, '') || 'unknown';
}

function buildComponents(products) {
  const parent = new Map(products.map(row => [row.id, row.id]));
  const ownerByIdentity = new Map();
  const find = id => {
    const current = parent.get(id);
    if (!current || current === id) return id;
    const root = find(current);
    parent.set(id, root);
    return root;
  };
  const union = (left, right) => {
    const leftRoot = find(left);
    const rightRoot = find(right);
    if (leftRoot !== rightRoot) parent.set(rightRoot, leftRoot);
  };
  for (const product of products) {
    const cabinet = clean(product.cabinet_id);
    const identities = distinct([product.sku, product.wb_sku, ...(Array.isArray(product.aliases) ? product.aliases : [])]);
    for (const identity of identities) {
      const key = `${cabinet}|${identity}`;
      const owner = ownerByIdentity.get(key);
      if (owner) union(product.id, owner);
      else ownerByIdentity.set(key, product.id);
    }
  }
  const result = new Map();
  for (const product of products) {
    const root = find(product.id);
    const rows = result.get(root) || [];
    rows.push(product);
    result.set(root, rows);
  }
  return [...result.values()];
}

function chooseCanonical(rows) {
  return [...rows].sort((left, right) => {
    const score = row => (
      (clean(row.sku) ? 8 : 0)
      + (clean(row.wb_sku) ? 8 : 0)
      + (clean(row.name) && clean(row.name) !== clean(row.sku) ? 4 : 0)
      + (clean(row.category) ? 2 : 0)
      + (clean(row.brand_id) ? 2 : 0)
      + (Array.isArray(row.aliases) ? row.aliases.length : 0)
    );
    return score(right) - score(left) || clean(left.id).localeCompare(clean(right.id));
  })[0];
}

function duplicateCount(rows, keyOf) {
  const seen = new Set();
  let duplicates = 0;
  for (const row of rows) {
    const key = keyOf(row);
    if (!key) continue;
    if (seen.has(key)) duplicates += 1;
    else seen.add(key);
  }
  return duplicates;
}

export function validateDirectoryBootstrap(bootstrap) {
  const errors = [];
  const cabinetKeys = new Set(bootstrap.cabinets.map(row => row.externalKey));
  const brandKeys = new Set(bootstrap.brands.map(row => row.externalKey));
  const categoryKeys = new Set(bootstrap.categories.map(row => row.externalKey));
  const productKeys = new Set(bootstrap.products.map(row => `${row.cabinetExternalKey}|${row.externalKey}`));
  const productByExternalKey = new Map(bootstrap.products.map(row => [`${row.cabinetExternalKey}|${row.externalKey}`, row]));
  const groupKeys = new Set(bootstrap.groups.map(row => `${row.cabinetExternalKey}|${row.externalKey}`));

  const addDuplicate = (code, rows, keyOf) => {
    const count = duplicateCount(rows, keyOf);
    if (count > 0) errors.push({ code, count });
  };
  addDuplicate('duplicate_cabinet', bootstrap.cabinets, row => row.externalKey);
  addDuplicate('duplicate_brand', bootstrap.brands, row => row.externalKey);
  addDuplicate('duplicate_category', bootstrap.categories, row => row.externalKey);
  addDuplicate('duplicate_product', bootstrap.products, row => `${row.cabinetExternalKey}|${row.externalKey}`);
  addDuplicate('duplicate_seller_sku', bootstrap.products, row => row.sellerSku ? `${row.cabinetExternalKey}|${row.sellerSku}` : '');
  addDuplicate('duplicate_wb_sku', bootstrap.products, row => row.wbSku ? `${row.cabinetExternalKey}|${row.wbSku}` : '');
  addDuplicate('duplicate_alias', bootstrap.aliases, row => `${row.cabinetExternalKey}|${row.value}`);
  addDuplicate('duplicate_group', bootstrap.groups, row => `${row.cabinetExternalKey}|${row.externalKey}`);
  addDuplicate('duplicate_history', bootstrap.groupHistory, row => `${row.productExternalKey}|${row.effectiveDate}`);
  addDuplicate('duplicate_legacy_product_map', bootstrap.legacyProductMap, row => row.legacyProductId);

  const identityOwners = new Map();
  let conflictingIdentities = 0;
  for (const row of bootstrap.products) {
    for (const value of [row.sellerSku, row.wbSku].filter(Boolean)) {
      const key = `${row.cabinetExternalKey}|${value}`;
      const owner = identityOwners.get(key);
      if (owner && owner !== row.externalKey) conflictingIdentities += 1;
      else identityOwners.set(key, row.externalKey);
    }
  }
  for (const row of bootstrap.aliases) {
    const key = `${row.cabinetExternalKey}|${row.value}`;
    const owner = identityOwners.get(key);
    if (owner && owner !== row.productExternalKey) conflictingIdentities += 1;
    else identityOwners.set(key, row.productExternalKey);
  }
  if (conflictingIdentities > 0) errors.push({ code: 'identity_owned_by_multiple_products', count: conflictingIdentities });

  const counts = {
    productUnknownCabinet: bootstrap.products.filter(row => !cabinetKeys.has(row.cabinetExternalKey)).length,
    productUnknownBrand: bootstrap.products.filter(row => row.brandExternalKey && !brandKeys.has(row.brandExternalKey)).length,
    productUnknownCategory: bootstrap.products.filter(row => row.categoryExternalKey && !categoryKeys.has(row.categoryExternalKey)).length,
    aliasUnknownProduct: bootstrap.aliases.filter(row => !productKeys.has(`${row.cabinetExternalKey}|${row.productExternalKey}`)).length,
    groupUnknownCabinet: bootstrap.groups.filter(row => !cabinetKeys.has(row.cabinetExternalKey)).length,
    historyUnknownProduct: bootstrap.groupHistory.filter(row => {
      const product = productByExternalKey.get(`${row.cabinetExternalKey}|${row.productExternalKey}`);
      return !product || product.cabinetExternalKey !== row.cabinetExternalKey;
    }).length,
    historyUnknownGroup: bootstrap.groupHistory.filter(row => !groupKeys.has(`${row.cabinetExternalKey}|${row.groupExternalKey}`)).length,
    historyInvalidDate: bootstrap.groupHistory.filter(row => !/^\d{4}-\d{2}-\d{2}$/u.test(row.effectiveDate)).length,
    mapUnknownProduct: bootstrap.legacyProductMap.filter(row => !productByExternalKey.has(`${row.cabinetExternalKey}|${row.productExternalKey}`)).length,
  };
  for (const [code, count] of Object.entries(counts)) {
    if (count > 0) errors.push({ code, count });
  }
  return errors;
}

export function buildDirectoryBootstrap(catalog) {
  const cabinets = catalog.cabinets.map(row => ({ externalKey: clean(row.id), name: clean(row.name) }));
  const cabinetIds = new Set(cabinets.map(row => row.externalKey));
  const brandByLegacyId = new Map(catalog.brands.map(row => [clean(row.id), { externalKey: clean(row.id), name: clean(row.name) }]));
  const components = buildComponents(catalog.products);
  const products = [];
  const aliases = [];
  const legacyProductMap = [];
  const reviewQueue = [];
  const categoryNamesByExternalKey = new Map();

  for (const rows of components) {
    const legacyProductIds = rows.map(row => clean(row.id)).sort();
    const cabinetIdsInComponent = distinct(rows.map(row => row.cabinet_id));
    const wbSkus = distinct(rows.map(row => row.wb_sku));
    const sellerSkus = distinct(rows.map(row => row.sku)).filter(value => !wbSkus.includes(value));
    const categories = distinct(rows.map(row => row.category));
    const brandIds = distinct(rows.map(row => row.brand_id));
    const reasons = [];
    if (cabinetIdsInComponent.length !== 1 || !cabinetIds.has(cabinetIdsInComponent[0])) reasons.push('missing_or_ambiguous_cabinet');
    if (wbSkus.length > 1) reasons.push('multiple_wb_sku');
    if (sellerSkus.length > 1) reasons.push('multiple_seller_sku');
    if (categories.length > 1) reasons.push('multiple_categories');
    if (brandIds.length > 1) reasons.push('multiple_brands');
    if (brandIds.length === 1 && !brandByLegacyId.has(brandIds[0])) reasons.push('unknown_brand');
    if (sellerSkus.length === 0 && wbSkus.length === 0) reasons.push('missing_identity');
    if (reasons.length > 0) {
      reviewQueue.push({
        type: 'product_identity',
        legacyProductIds,
        reasons,
        candidates: rows.map(row => ({
          legacyProductId: clean(row.id),
          cabinetExternalKey: clean(row.cabinet_id) || null,
          sellerSku: clean(row.sku) || null,
          wbSku: clean(row.wb_sku) || null,
          name: clean(row.name) || null,
          category: clean(row.category) || null,
          brandExternalKey: clean(row.brand_id) || null,
          aliases: distinct(Array.isArray(row.aliases) ? row.aliases : []),
          status: row.status === 'archived' ? 'archived' : 'active',
        })),
      });
      continue;
    }

    const canonical = chooseCanonical(rows);
    const productExternalKey = `v4:${clean(canonical.id)}`;
    const cabinetExternalKey = cabinetIdsInComponent[0];
    const sellerSku = sellerSkus[0] || null;
    const wbSku = wbSkus[0] || null;
    const allIdentities = distinct(rows.flatMap(row => [row.sku, row.wb_sku, ...(Array.isArray(row.aliases) ? row.aliases : [])]));
    const categoryName = categories[0] || null;
    const categoryExternalKey = categoryName ? `category:${slug(categoryName)}` : null;
    if (categoryExternalKey) categoryNamesByExternalKey.set(categoryExternalKey, categoryName);
    products.push({
      externalKey: productExternalKey,
      cabinetExternalKey,
      sellerSku,
      wbSku,
      name: clean(canonical.name) || sellerSku || wbSku,
      categoryExternalKey,
      brandExternalKey: brandIds[0] || null,
      status: rows.every(row => row.status === 'archived') ? 'archived' : 'active',
      dataSource: 'seed',
      legacyProductIds,
    });
    for (const value of allIdentities.filter(item => item !== sellerSku && item !== wbSku)) {
      aliases.push({ productExternalKey, cabinetExternalKey, value, type: 'historical' });
    }
    for (const legacyProductId of legacyProductIds) legacyProductMap.push({ legacyProductId, productExternalKey, cabinetExternalKey });
  }

  const categories = [...categoryNamesByExternalKey]
    .map(([externalKey, name]) => ({ externalKey, name }))
    .sort((left, right) => left.name.localeCompare(right.name));
  const usedBrands = new Set(products.map(row => row.brandExternalKey).filter(Boolean));
  const brands = [...brandByLegacyId.values()].filter(row => usedBrands.has(row.externalKey));

  const groups = [];
  const groupByLegacyId = new Map();
  const explicitUngroupedLegacyIds = new Set(['grp-ungrouped']);
  for (const cabinet of cabinets) {
    const group = { externalKey: '__ungrouped__', cabinetExternalKey: cabinet.externalKey, name: 'Без склейки', isUngrouped: true };
    groups.push(group);
  }
  for (const row of catalog.groups) {
    const legacyId = clean(row.id);
    const cabinetExternalKey = clean(row.cabinet_id);
    if (clean(row.name).toLocaleLowerCase('ru-RU') === 'без склейки') {
      if (legacyId) explicitUngroupedLegacyIds.add(legacyId);
      continue;
    }
    if (!cabinetIds.has(cabinetExternalKey)) continue;
    const group = { externalKey: legacyId, cabinetExternalKey, name: clean(row.name), isUngrouped: false };
    groups.push(group);
    groupByLegacyId.set(legacyId, group);
  }

  const productMap = new Map(legacyProductMap.map(row => [row.legacyProductId, row]));
  const productByExternalKey = new Map(products.map(row => [`${row.cabinetExternalKey}|${row.externalKey}`, row]));
  const historyByKey = new Map();
  const conflictedHistoryKeys = new Set();
  let skippedHistoryForQueuedProducts = 0;
  let skippedHistoryForInvalidGroupReference = 0;
  for (const row of catalog.groupHistory) {
    const legacyProductId = clean(row.product_id);
    const mappedProduct = productMap.get(legacyProductId);
    if (!mappedProduct) {
      skippedHistoryForQueuedProducts += 1;
      continue;
    }
    const productExternalKey = mappedProduct.productExternalKey;
    const product = productByExternalKey.get(`${mappedProduct.cabinetExternalKey}|${productExternalKey}`);
    const legacyGroupId = clean(row.group_id);
    const sourceGroup = groupByLegacyId.get(legacyGroupId);
    const key = `${productExternalKey}|${clean(row.date)}`;
    if (conflictedHistoryKeys.has(key)) continue;
    const isUngrouped = explicitUngroupedLegacyIds.has(legacyGroupId);
    if (!isUngrouped && !sourceGroup) {
      skippedHistoryForInvalidGroupReference += 1;
      reviewQueue.push({
        type: 'group_history_reference',
        legacyProductIds: product.legacyProductIds,
        date: clean(row.date),
        legacyGroupId,
        reasons: ['unknown_group'],
      });
      continue;
    }
    if (sourceGroup && sourceGroup.cabinetExternalKey !== product.cabinetExternalKey) {
      skippedHistoryForInvalidGroupReference += 1;
      reviewQueue.push({
        type: 'group_history_reference',
        legacyProductIds: product.legacyProductIds,
        date: clean(row.date),
        legacyGroupId,
        reasons: ['group_cabinet_mismatch'],
      });
      continue;
    }
    const groupExternalKey = isUngrouped ? '__ungrouped__' : sourceGroup.externalKey;
    const existing = historyByKey.get(key);
    if (existing && existing.groupExternalKey !== groupExternalKey) {
      reviewQueue.push({ type: 'group_history_conflict', legacyProductIds: product.legacyProductIds, date: clean(row.date), reasons: ['different_groups_after_identity_merge'] });
      historyByKey.delete(key);
      conflictedHistoryKeys.add(key);
      continue;
    }
    if (!existing) historyByKey.set(key, {
      productExternalKey,
      cabinetExternalKey: product.cabinetExternalKey,
      effectiveDate: clean(row.date),
      groupExternalKey,
      source: ['import', 'manual', 'legacy'].includes(row.source) ? row.source : 'legacy',
    });
  }

  const groupHistory = [...historyByKey.values()].sort((left, right) => left.effectiveDate.localeCompare(right.effectiveDate) || left.productExternalKey.localeCompare(right.productExternalKey));
  const productsWithHistory = new Set(groupHistory.map(row => row.productExternalKey));
  return {
    schemaVersion: 1,
    summary: {
      sourceProducts: catalog.products.length,
      identityComponents: components.length,
      acceptedProducts: products.length,
      queuedProductComponents: reviewQueue.filter(row => row.type === 'product_identity').length,
      acceptedAliases: aliases.length,
      acceptedGroups: groups.length,
      acceptedHistoryRows: groupHistory.length,
      skippedHistoryForQueuedProducts,
      skippedHistoryForInvalidGroupReference,
      productsWithoutDatedHistory: products.filter(row => !productsWithHistory.has(row.externalKey)).length,
      historyConflictsAfterMerge: reviewQueue.filter(row => row.type === 'group_history_conflict').length,
    },
    cabinets,
    brands,
    categories,
    groups,
    products,
    aliases,
    groupHistory,
    legacyProductMap,
    reviewQueue,
  };
}
