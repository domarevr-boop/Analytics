import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const DATA_ARRAYS = new Set([
  'cabinets', 'brands', 'groups', 'products', 'memberships', 'groupHistory',
  'metrics', 'plans', 'monthlyPlans', 'aggregatePlans', 'planningSettings',
  'profitability', 'geography', 'geographyPlans', 'entryPoints', 'searchQueries',
  'nicheDynamics', 'marketDynamics', 'competitorFunnel', 'competitorSearch',
  'competitorStocks', 'competitorPositions', 'importLogs',
]);

const CATALOG_ARRAYS = new Set([
  'cabinets', 'brands', 'groups', 'products', 'memberships', 'groupHistory',
  'competitorFunnel', 'competitorSearch', 'competitorStocks', 'competitorPositions',
]);

function normalizeIdentity(value) {
  return String(value ?? '').replace(/\u00a0/gu, ' ').trim().replace(/\.0+$/u, '');
}

function countCollisions(rows, keyOf) {
  const seen = new Map();
  let collisions = 0;
  for (const row of rows) {
    const key = keyOf(row);
    if (!key) continue;
    const previous = seen.get(key);
    if (previous && previous !== row.id) collisions += 1;
    else seen.set(key, row.id);
  }
  return collisions;
}

function inspectIdentityComponents(products) {
  const parent = new Map(products.map(row => [row.id, row.id]));
  const ownerByIdentity = new Map();
  const cabinetsByIdentity = new Map();

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
    const cabinet = normalizeIdentity(product.cabinet_id);
    const values = [...new Set([product.sku, product.wb_sku, ...(Array.isArray(product.aliases) ? product.aliases : [])].map(normalizeIdentity).filter(Boolean))];
    for (const value of values) {
      const scopedKey = `${cabinet}|${value}`;
      const owner = ownerByIdentity.get(scopedKey);
      if (owner) union(product.id, owner);
      else ownerByIdentity.set(scopedKey, product.id);
      const cabinets = cabinetsByIdentity.get(value) || new Set();
      if (cabinet) cabinets.add(cabinet);
      cabinetsByIdentity.set(value, cabinets);
    }
  }

  const components = new Map();
  for (const product of products) {
    const root = find(product.id);
    const rows = components.get(root) || [];
    rows.push(product);
    components.set(root, rows);
  }
  const colliding = [...components.values()].filter(rows => rows.length > 1);
  let ambiguousMultipleWbSku = 0;
  let ambiguousMultipleCredibleSellerSku = 0;
  for (const rows of colliding) {
    const wbValues = new Set(rows.map(row => normalizeIdentity(row.wb_sku)).filter(Boolean));
    const sellerValues = new Set(rows.map(row => normalizeIdentity(row.sku)).filter(value => value && !wbValues.has(value)));
    if (wbValues.size > 1) ambiguousMultipleWbSku += 1;
    if (sellerValues.size > 1) ambiguousMultipleCredibleSellerSku += 1;
  }

  return {
    canonicalProductsAfterExactIdentityMerge: components.size,
    collisionComponents: colliding.length,
    productsInCollisionComponents: colliding.reduce((sum, rows) => sum + rows.length, 0),
    largestCollisionComponent: Math.max(0, ...colliding.map(rows => rows.length)),
    ambiguousComponentsWithMultipleWbSku: ambiguousMultipleWbSku,
    ambiguousComponentsWithMultipleCredibleSellerSku: ambiguousMultipleCredibleSellerSku,
    identitiesUsedAcrossCabinets: [...cabinetsByIdentity.values()].filter(cabinets => cabinets.size > 1).length,
  };
}

function inspectCatalog(catalog) {
  const cabinetIds = new Set(catalog.cabinets.map(row => normalizeIdentity(row.id)).filter(Boolean));
  const groupById = new Map(catalog.groups.map(row => [normalizeIdentity(row.id), row]));
  const productById = new Map(catalog.products.map(row => [normalizeIdentity(row.id), row]));
  const membershipKeys = new Set();
  const historyKeys = new Set();
  let duplicateMemberships = 0;
  let duplicateHistoryRows = 0;
  let membershipUnknownProduct = 0;
  let membershipUnknownGroup = 0;
  let membershipCabinetMismatch = 0;
  let historyUnknownProduct = 0;
  let historyUnknownGroup = 0;
  let historyCabinetMismatch = 0;

  for (const row of catalog.memberships) {
    const productId = normalizeIdentity(row.product_id);
    const groupId = normalizeIdentity(row.group_id);
    const key = `${productId}|${groupId}`;
    if (membershipKeys.has(key)) duplicateMemberships += 1;
    membershipKeys.add(key);
    const product = productById.get(productId);
    const group = groupById.get(groupId);
    if (!product) membershipUnknownProduct += 1;
    if (!group) membershipUnknownGroup += 1;
    if (product && group && normalizeIdentity(group.cabinet_id) && normalizeIdentity(product.cabinet_id) !== normalizeIdentity(group.cabinet_id)) membershipCabinetMismatch += 1;
  }

  for (const row of catalog.groupHistory) {
    const productId = normalizeIdentity(row.product_id);
    const groupId = normalizeIdentity(row.group_id);
    const key = `${normalizeIdentity(row.date)}|${productId}`;
    if (historyKeys.has(key)) duplicateHistoryRows += 1;
    historyKeys.add(key);
    const product = productById.get(productId);
    const group = groupById.get(groupId);
    if (!product) historyUnknownProduct += 1;
    if (!group && groupId !== 'grp-ungrouped') historyUnknownGroup += 1;
    if (product && group && normalizeIdentity(group.cabinet_id) && normalizeIdentity(product.cabinet_id) !== normalizeIdentity(group.cabinet_id)) historyCabinetMismatch += 1;
  }

  const identityRows = catalog.products.flatMap(product => {
    const cabinet = normalizeIdentity(product.cabinet_id);
    const values = [product.sku, product.wb_sku, ...(Array.isArray(product.aliases) ? product.aliases : [])];
    return [...new Set(values.map(normalizeIdentity).filter(Boolean))].map(value => ({ id: product.id, key: `${cabinet}|${value}` }));
  });

  return {
    cabinetsWithUnknownId: catalog.cabinets.filter(row => !normalizeIdentity(row.id)).length,
    groupsWithoutCabinet: catalog.groups.filter(row => !normalizeIdentity(row.cabinet_id)).length,
    groupsWithUnknownCabinet: catalog.groups.filter(row => normalizeIdentity(row.cabinet_id) && !cabinetIds.has(normalizeIdentity(row.cabinet_id))).length,
    productsWithoutCabinet: catalog.products.filter(row => !normalizeIdentity(row.cabinet_id)).length,
    productsWithUnknownCabinet: catalog.products.filter(row => normalizeIdentity(row.cabinet_id) && !cabinetIds.has(normalizeIdentity(row.cabinet_id))).length,
    productsWithoutIdentity: catalog.products.filter(row => !normalizeIdentity(row.sku) && !normalizeIdentity(row.wb_sku)).length,
    duplicateSellerSkuWithinCabinet: countCollisions(catalog.products, row => {
      const value = normalizeIdentity(row.sku);
      return value ? `${normalizeIdentity(row.cabinet_id)}|${value}` : '';
    }),
    duplicateWbSkuWithinCabinet: countCollisions(catalog.products, row => {
      const value = normalizeIdentity(row.wb_sku);
      return value ? `${normalizeIdentity(row.cabinet_id)}|${value}` : '';
    }),
    collidingIdentityOrAliasWithinCabinet: countCollisions(identityRows, row => row.key),
    duplicateMemberships,
    membershipUnknownProduct,
    membershipUnknownGroup,
    membershipCabinetMismatch,
    duplicateHistoryRows,
    historyUnknownProduct,
    historyUnknownGroup,
    historyCabinetMismatch,
    explicitUngroupedHistoryRows: catalog.groupHistory.filter(row => normalizeIdentity(row.group_id) === 'grp-ungrouped').length,
    ...inspectIdentityComponents(catalog.products),
  };
}

async function scanV4Backup(filePath, includeCatalog = false, extraCatalogArrays = []) {
  const file = await stat(filePath);
  if (!file.isFile()) throw new Error('V4 backup path is not a file');

  const counts = Object.fromEntries([...DATA_ARRAYS].map(key => [key, 0]));
  const capturedArrays = new Set([...CATALOG_ARRAYS, ...extraCatalogArrays]);
  const catalog = Object.fromEntries([...capturedArrays].map(key => [key, []]));
  const metadata = { version: '', exportedAt: '' };
  const stack = [];
  let inString = false;
  let escaped = false;
  let capture = false;
  let token = '';
  let objectCapture = '';
  let objectCaptureDepth = 0;
  let objectCaptureTarget = '';

  const currentObject = () => {
    for (let index = stack.length - 1; index >= 0; index -= 1) {
      if (stack[index].type === 'object') return stack[index];
    }
    return null;
  };

  for await (const chunk of createReadStream(filePath, { encoding: 'utf8', highWaterMark: 1024 * 1024 })) {
    for (const char of chunk) {
      if (objectCapture) objectCapture += char;
      if (inString) {
        if (escaped) {
          escaped = false;
          if (capture) token += char;
        } else if (char === '\\') {
          escaped = true;
          if (capture) token += char;
        } else if (char === '"') {
          inString = false;
          const object = currentObject();
          if (capture && object) {
            if (object.expectingKey) {
              object.pendingKey = token;
              object.expectingKey = false;
              object.keyAwaitingValue = true;
            } else if (object.path === '' && object.currentKey && Object.hasOwn(metadata, object.currentKey)) {
              metadata[object.currentKey] = token;
            }
          }
          capture = false;
          token = '';
        } else if (capture) {
          token += char;
        }
        continue;
      }

      if (char === '"') {
        inString = true;
        const object = currentObject();
        capture = Boolean(object?.expectingKey || (object?.path === '' && object?.currentKey && Object.hasOwn(metadata, object.currentKey)));
        token = '';
        continue;
      }

      const parent = stack.at(-1);
      if (char === ':') {
        if (parent?.type === 'object' && parent.keyAwaitingValue) {
          parent.currentKey = parent.pendingKey;
          parent.pendingKey = '';
          parent.keyAwaitingValue = false;
        }
      } else if (char === '{') {
        if (objectCapture) objectCaptureDepth += 1;
        if (parent?.type === 'array' && parent.targetName) {
          counts[parent.targetName] += 1;
          if (capturedArrays.has(parent.targetName)) {
            objectCapture = '{';
            objectCaptureDepth = 1;
            objectCaptureTarget = parent.targetName;
          }
        }
        const childKey = parent?.type === 'object' ? parent.currentKey : '';
        const path = parent?.type === 'object'
          ? [parent.path, childKey].filter(Boolean).join('.')
          : parent?.path || '';
        stack.push({ type: 'object', path, expectingKey: true, pendingKey: '', currentKey: '', keyAwaitingValue: false });
      } else if (char === '[') {
        if (objectCapture) objectCaptureDepth += 1;
        const childKey = parent?.type === 'object' ? parent.currentKey : '';
        const path = parent?.type === 'object'
          ? [parent.path, childKey].filter(Boolean).join('.')
          : parent?.path || '';
        const targetName = parent?.type === 'object' && parent.path === 'data' && DATA_ARRAYS.has(childKey) ? childKey : '';
        stack.push({ type: 'array', path, targetName });
      } else if (char === '}' || char === ']') {
        if (objectCapture) {
          objectCaptureDepth -= 1;
          if (objectCaptureDepth === 0) {
            catalog[objectCaptureTarget].push(JSON.parse(objectCapture));
            objectCapture = '';
            objectCaptureTarget = '';
          }
        }
        stack.pop();
      } else if (char === ',') {
        const active = stack.at(-1);
        if (active?.type === 'object') {
          active.expectingKey = true;
          active.pendingKey = '';
          active.currentKey = '';
          active.keyAwaitingValue = false;
        }
      }
    }
  }

  if (inString || stack.length !== 0) throw new Error('V4 backup is incomplete or malformed');
  if (metadata.version !== 'v4.0' || !metadata.exportedAt) throw new Error('File is not a supported V4 backup');

  const result = { ...metadata, sizeBytes: file.size, counts, catalogDiagnostics: inspectCatalog(catalog) };
  return includeCatalog ? { ...result, catalog } : result;
}

export async function inspectV4Backup(filePath) {
  return scanV4Backup(filePath, false);
}

export async function readV4BackupCatalog(filePath) {
  return scanV4Backup(filePath, true);
}

export async function readV4BackupCompetitors(filePath) {
  const result = await scanV4Backup(filePath, true);
  return {
    version: result.version,
    exportedAt: result.exportedAt,
    sizeBytes: result.sizeBytes,
    competitors: {
      funnel: result.catalog.competitorFunnel,
      search: result.catalog.competitorSearch,
      stocks: result.catalog.competitorStocks,
      positions: result.catalog.competitorPositions,
    },
  };
}

export async function readV4BackupGeography(filePath) {
  const result = await scanV4Backup(filePath, true, ['geography']);
  return {
    version: result.version,
    exportedAt: result.exportedAt,
    sizeBytes: result.sizeBytes,
    products: result.catalog.products,
    geography: result.catalog.geography,
  };
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const filePath = process.argv[2];
  if (!filePath) {
    console.error('Usage: node scripts/inspect-v4-backup.mjs <backup.json>');
    process.exitCode = 1;
  } else {
    inspectV4Backup(filePath)
      .then(result => console.log(JSON.stringify(result, null, 2)))
      .catch(error => {
        console.error(error instanceof Error ? error.message : String(error));
        process.exitCode = 1;
      });
  }
}
