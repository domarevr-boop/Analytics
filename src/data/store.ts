import type { Cabinet, Brand, ProductGroup, Product, GroupMembership, DailyMetrics, ImportFileLog, ImportSource, PlanRecord, MonthlyPlanRecord, ProfitabilityRecord, GeographyOrderRecord, GeographyPlanRecord, EntryPointRecord, SearchQueryRecord, NicheDynamicsRecord } from '../types';
import { classifySku, getRules } from './rules';
import { loadSeed, createSeedPlans, getUngroupedGroupId } from './seedLoader';
import { repository } from '../database/db';
import { isCloudStorage } from '../database/db';
import { createDataChanges, DATA_STORE_NAMES, hasDataChanges } from '../database/snapshotDelta';
import type { DataSnapshot } from '../types';
import { normalizeImportDate, addDays } from './dateUtils';
import { getAllExtraExpenses, getCabinetExtraExpense, initializeExtraExpenses, replaceExtraExpenses } from './profitStore';
import { getReportNetProfit } from './profitabilityCalculations';

let _version = 0;
const _listeners = new Set<() => void>();
let _initCalled = false;
let _suppressPersist = false;
let _persistQueue: Promise<void> = Promise.resolve();
const DEV = import.meta.env.DEV;
const MONTHLY_PLANS_BACKUP_KEY = 'analytics_monthly_plans_v1';
type DataStoreName = keyof DataSnapshot;
const _readCache = new Map<DataStoreName, { source: unknown[]; snapshot: unknown[] }>();

function invalidateReadCache(stores: Iterable<DataStoreName>) {
  for (const store of stores) _readCache.delete(store);
}

function notify(persist = true, stores: Iterable<DataStoreName> = DATA_STORE_NAMES) {
  if (_suppressPersist && persist) return;
  const changedStores = [...stores];
  invalidateReadCache(changedStores);
  _version++;
  if (DEV) console.log('[notify] _version=' + _version + ' _metrics.length=' + _metrics.length);
  _listeners.forEach(fn => fn());
  if (persist && _initCalled) persistStores(changedStores);
}

export function subscribe(fn: () => void) {
  _listeners.add(fn);
  return () => _listeners.delete(fn);
}

export function getVersion() { return _version; }

let _cabinets: Cabinet[] = [];
let _brands: Brand[] = [];
let _groups: ProductGroup[] = [];
let _products: Product[] = [];
let _memberships: GroupMembership[] = [];
let _metrics: DailyMetrics[] = [];
let _importLog: ImportFileLog[] = [];
let _plans: PlanRecord[] = [];
let _monthlyPlans: MonthlyPlanRecord[] = [];
let _profitability: ProfitabilityRecord[] = [];
let _geography: GeographyOrderRecord[] = [];
let _geographyPlans: GeographyPlanRecord[] = [];
let _entryPoints: EntryPointRecord[] = [];
let _searchQueries: SearchQueryRecord[] = [];
let _nicheDynamics: NicheDynamicsRecord[] = [];
let _skuAliases = new Map<string, string>();
let _lastPersistedSnapshot: DataSnapshot | null = null;
function genId(prefix: string) { return `${prefix}-${crypto.randomUUID().slice(0, 8)}`; }

function cachedRows<T>(store: DataStoreName, rows: T[], clone: (row: T) => T = row => ({ ...row })) {
  const cached = _readCache.get(store);
  if (cached?.source === rows) return cached.snapshot as T[];
  const snapshot = rows.map(clone);
  _readCache.set(store, { source: rows as unknown[], snapshot: snapshot as unknown[] });
  return snapshot;
}

function saveMonthlyPlansBackup() {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(MONTHLY_PLANS_BACKUP_KEY, JSON.stringify(_monthlyPlans));
  } catch (error) {
    console.error('[monthly-plans] backup failed', error);
  }
}

function loadMonthlyPlansBackup(): MonthlyPlanRecord[] {
  if (typeof localStorage === 'undefined') return [];
  try {
    const raw = localStorage.getItem(MONTHLY_PLANS_BACKUP_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    console.error('[monthly-plans] backup restore failed', error);
    return [];
  }
}

function seed() {
  const seed = loadSeed();
  _cabinets.push(...seed.cabinets);
  _brands.push(...seed.brands);
  _groups.push(...seed.groups);

  // Ungrouped group
  _groups.push({ id: getUngroupedGroupId(), name: 'Без склейки', cabinet_id: '' });

  // Auto-create products from classification rules
  const rules = getRules();
  const seen = new Set<string>();
  for (const rule of rules.groupRules) {
    for (const sku of rule.skus) {
      if (!seen.has(sku)) {
        seen.add(sku);
        findOrCreateProduct(sku);
      }
    }
  }

  // Create default plans for all entities
  const newPlans = createSeedPlans(_cabinets, _groups, _products, _memberships);
  for (const p of newPlans) {
    if (!_plans.some(ex => ex.entityId === p.entityId && ex.entityType === p.entityType)) {
      _plans.push(p);
    }
  }
}

export function getCabinets() { return cachedRows('cabinets', _cabinets); }
export function getBrands() { return cachedRows('brands', _brands); }
export function getGroups() { return cachedRows('groups', _groups); }
export function getProducts() { return cachedRows('products', _products, product => ({ ...product, aliases: product.aliases ? [...product.aliases] : [] })); }
export function getMemberships() { return cachedRows('memberships', _memberships); }
export function getMetrics() { return cachedRows('metrics', _metrics); }
export function getGeographyOrders() { return cachedRows('geography', _geography); }
export function getGeographyPlans() { return cachedRows('geographyPlans', _geographyPlans); }
export function getEntryPoints() { return cachedRows('entryPoints', _entryPoints); }
export function getSearchQueries() { return cachedRows('searchQueries', _searchQueries); }
export function getNicheDynamics() { return cachedRows('nicheDynamics', _nicheDynamics); }
export function getImportLog() { return [...cachedRows('importLogs', _importLog)].reverse(); }

export function exportV4Backup() {
  return {
    version: 'v4.0',
    exportedAt: new Date().toISOString(),
    fixedExpenses: getAllExtraExpenses(),
    data: {
      cabinets: _cabinets.map(item => ({ ...item })),
      brands: _brands.map(item => ({ ...item })),
      groups: _groups.map(item => ({ ...item })),
      products: _products.map(item => ({ ...item, aliases: item.aliases ? [...item.aliases] : [] })),
      memberships: _memberships.map(item => ({ ...item })),
      metrics: _metrics.map(item => ({ ...item })),
      plans: _plans.map(item => ({ ...item })),
      monthlyPlans: _monthlyPlans.map(item => ({ ...item })),
      profitability: _profitability.map(item => ({ ...item })),
      geography: _geography.map(item => ({ ...item })),
      geographyPlans: _geographyPlans.map(item => ({ ...item })),
      entryPoints: _entryPoints.map(item => ({ ...item })),
      searchQueries: _searchQueries.map(item => ({ ...item })),
      nicheDynamics: _nicheDynamics.map(item => ({ ...item })),
      importLogs: _importLog.map(item => ({ ...item, productIds: item.productIds ? [...item.productIds] : undefined })),
    },
  };
}

export async function importV4Backup(backup: unknown): Promise<{ metrics: number; products: number }> {
  const parsed = backup as { version?: string; data?: Partial<DataSnapshot>; fixedExpenses?: Record<string, Record<string, number>> };
  const data = parsed.data;
  if (!data || !Array.isArray(data.cabinets) || !Array.isArray(data.products) || !Array.isArray(data.metrics)) {
    throw new Error('Файл не похож на резервную копию Analytics V4.');
  }

  const snapshot: DataSnapshot = {
    cabinets: data.cabinets,
    brands: data.brands || [],
    groups: data.groups || [],
    products: data.products,
    memberships: data.memberships || [],
    metrics: data.metrics,
    plans: data.plans || [],
    monthlyPlans: data.monthlyPlans || [],
    profitability: data.profitability || [],
    geography: data.geography || [],
    geographyPlans: data.geographyPlans || [],
    entryPoints: data.entryPoints || [],
    searchQueries: data.searchQueries || [],
    nicheDynamics: data.nicheDynamics || [],
    importLogs: data.importLogs || [],
  };

  const result = await repository.saveAll(snapshot);
  if (!result.ok) throw new Error(result.errors.join('; '));
  await replaceExtraExpenses(parsed.fixedExpenses || {});

  _cabinets = snapshot.cabinets;
  _brands = snapshot.brands;
  _groups = snapshot.groups;
  _products = snapshot.products;
  _memberships = snapshot.memberships;
  _metrics = snapshot.metrics;
  _plans = snapshot.plans;
  _monthlyPlans = snapshot.monthlyPlans;
  _profitability = snapshot.profitability;
  _geography = snapshot.geography;
  _geographyPlans = snapshot.geographyPlans;
  _entryPoints = snapshot.entryPoints;
  _searchQueries = snapshot.searchQueries;
  _nicheDynamics = snapshot.nicheDynamics;
  _importLog = snapshot.importLogs;
  _lastPersistedSnapshot = snapshot;
  buildAliasMap();
  notify(false);

  return { metrics: snapshot.metrics.length, products: snapshot.products.length };
}

export async function deleteImportLogEntry(logId: string) {
  const log = _importLog.find(l => l.id === logId);
  if (!log) return;

  if (DEV) console.log('[store] deleteImportLogEntry:', log.id, log.fileName, log.source);

  if (log.source === 'entry_points') {
    const idSet = new Set(log.productIds || []);
    _entryPoints = _entryPoints.filter(record => !idSet.has(record.product_id) || (log.dataStart && record.date < log.dataStart) || (log.dataEnd && record.date > log.dataEnd));
  } else if (log.source === 'geography') {
    const idSet = new Set(log.productIds || []);
    _geography = _geography.filter(record => {
      if (!idSet.has(record.product_id)) return true;
      if (log.dataStart && record.date < log.dataStart) return true;
      if (log.dataEnd && record.date > log.dataEnd) return true;
      return false;
    });
  } else if (log.source === 'profitability') {
    // Profitability records aren't in _metrics — remove from _profitability by product list
    if (log.productIds) {
      const idSet = new Set(log.productIds);
      _profitability = _profitability.filter(r => !idSet.has(r.product_id));
    }
  } else {
    // Для старых импортов (без productIds) — удаляем все рекламные метрики
    if (!log.productIds || !log.dataStart) {
      const before = _metrics.length;
      _metrics = _metrics.filter(m => m.ad_spend === 0);
      if (DEV) console.log('[store] deleteImportLogEntry — old import, removed all ad metrics:', before - _metrics.length);
    } else {
      // Новые импорты — удаляем только метрики этого файла
      const idSet = new Set(log.productIds);
      const before = _metrics.length;
      _metrics = _metrics.filter(m => {
        if (!idSet.has(m.product_id)) return true;
        if (m.date < log.dataStart!) return true;
        if (log.dataEnd && m.date > log.dataEnd) return true;
        return false;
      });
      if (DEV) console.log('[store] deleteImportLogEntry — removed metrics:', before - _metrics.length);
    }
  }

  _importLog = _importLog.filter(l => l.id !== logId);
  const deletedStores: DataStoreName[] = ['importLogs'];
  if (log.source === 'entry_points') deletedStores.push('entryPoints');
  else if (log.source === 'geography') deletedStores.push('geography');
  else if (log.source === 'profitability') deletedStores.push('profitability');
  else deletedStores.push('metrics');
  notify(true, deletedStores);

  if (log.source === 'profitability') {
    // Delete profitability data from Supabase
    if (log.productIds) {
      for (const pid of log.productIds) {
        try {
          await repository.deleteProfitability?.(pid);
        } catch (e) {
          console.error('[store] deleteProfitability failed', e);
        }
      }
    }
  } else if (log.source !== 'geography' && log.source !== 'entry_points' && log.productIds && log.productIds.length > 0) {
    // Удаляем метрики из Supabase
    try {
      await repository.deleteMetrics?.({
        productIds: log.productIds,
        dateStart: log.dataStart,
        dateEnd: log.dataEnd,
      });
    } catch (e) {
      console.error('[store] deleteMetrics failed', e);
    }
  }

  // Удаляем сам лог из Supabase (upsert не удаляет)
  try {
    await repository.deleteImportLog?.(logId);
  } catch (e) {
    console.error('[store] deleteImportLog failed', e);
  }
}

export function addCabinet(name: string): Cabinet {
  const c: Cabinet = { id: genId('cab'), name };
  _cabinets.push(c); notify(true, ['cabinets']); return c;
}
export function updateCabinet(id: string, name: string) {
  const c = _cabinets.find(x => x.id === id);
  if (c) { c.name = name; notify(true, ['cabinets']); }
}
export function removeCabinet(id: string) {
  _cabinets = _cabinets.filter(x => x.id !== id);
  notify(true, ['cabinets']);
}

export function addBrand(name: string): Brand {
  const b: Brand = { id: genId('br'), name };
  _brands.push(b); notify(true, ['brands']); return b;
}
export function updateBrand(id: string, name: string) {
  const b = _brands.find(x => x.id === id);
  if (b) { b.name = name; notify(true, ['brands']); }
}
export function removeBrand(id: string) {
  _brands = _brands.filter(x => x.id !== id);
  _products.forEach(p => { if (p.brand_id === id) p.brand_id = ''; });
  notify(true, ['brands', 'products']);
}

export function addGroup(name: string, cabinet_id: string): ProductGroup {
  const g: ProductGroup = { id: genId('grp'), name, cabinet_id };
  _groups.push(g); notify(true, ['groups']); return g;
}
export function updateGroup(id: string, name: string) {
  const g = _groups.find(x => x.id === id);
  if (g) { g.name = name; notify(true, ['groups']); }
}
export function removeGroup(id: string) {
  _groups = _groups.filter(x => x.id !== id);
  _memberships = _memberships.filter(m => m.group_id !== id);
  notify(true, ['groups', 'memberships']);
}

export function addProduct(sku: string, name: string, brand_id: string, category = ''): Product {
  const p: Product = {
    id: genId('pr'), sku, wb_sku: '', name, category, brand_id, cabinet_id: '',
    aliases: [], status: 'active', data_source: 'manual', updated_at: new Date().toISOString(),
  };
  _products.push(p); notify(true, ['products']); return p;
}
export function updateProduct(id: string, data: Partial<Omit<Product, 'id'>> & { group_id?: string }) {
  const p = _products.find(x => x.id === id);
  if (!p) return;
  const { group_id, ...productData } = data;
  Object.assign(p, productData, { updated_at: new Date().toISOString() });
  if (group_id !== undefined) {
    _memberships = _memberships.filter(m => m.product_id !== id);
    if (group_id) _memberships.push({ product_id: id, group_id });
  }
  buildAliasMap();
  notify(true, ['products', 'memberships']);
}
export function removeProduct(id: string) {
  _products = _products.filter(x => x.id !== id);
  _memberships = _memberships.filter(m => m.product_id !== id);
  _metrics = _metrics.filter(m => m.product_id !== id);
  notify(true, ['products', 'memberships', 'metrics']);
}

export const UNGROUPED_GROUP_ID = 'grp-ungrouped';

export function removeMembership(product_id: string, group_id?: string) {
  if (group_id) {
    _memberships = _memberships.filter(m => !(m.product_id === product_id && m.group_id === group_id));
  } else {
    _memberships = _memberships.filter(m => m.product_id !== product_id);
  }
  notify(true, ['memberships']);
}

let _nextLogId = 1;

export function findOrCreateProduct(sku: string, name?: string, cabinetIdOverride?: string): Product {
  let p = _products.find(x => x.sku === sku && (!cabinetIdOverride || !x.cabinet_id || x.cabinet_id === cabinetIdOverride));
  if (p && cabinetIdOverride && !p.cabinet_id) p.cabinet_id = cabinetIdOverride;
  if (!p) {
    const { brandId, cabinetId, groupIds } = classifySku(sku);
    p = {
      id: genId('pr'), sku, wb_sku: '', name: name || sku, category: '', brand_id: brandId, cabinet_id: cabinetIdOverride || cabinetId,
      aliases: [], status: 'active', data_source: 'import', updated_at: new Date().toISOString(),
    };
    _products.push(p);
    if (groupIds.length > 0) {
      for (const gid of groupIds) {
        _memberships.push({ product_id: p.id, group_id: gid });
      }
    } else {
      // Auto-assign to "Без склейки" if no group matched
      _memberships.push({ product_id: p.id, group_id: UNGROUPED_GROUP_ID });
    }
    notify(true, ['products', 'memberships']);
  }
  return p;
}

function buildAliasMap() {
  _skuAliases.clear();
  for (const p of _products) {
    const values = [p.sku, p.wb_sku, ...(p.aliases || [])].filter(Boolean);
    for (const value of values) {
      _skuAliases.set(`${p.cabinet_id}|${value}`, p.id);
      if (!_skuAliases.has(value)) _skuAliases.set(value, p.id);
    }
  }
}

function canonicalSellerSku(sku: string) {
  return sku
    .replace(/\u00a0/g, ' ')
    .trim()
    .replace(/\.0+$/, '')
    .replace(/\s*\(\d+\)\s*$/, '');
}

function productIdentityValues(product: Product): string[] {
  return [...new Set([
    product.sku,
    product.wb_sku,
    ...(product.aliases || []),
    canonicalSellerSku(product.sku),
  ].map(value => String(value || '').trim()).filter(Boolean))];
}

function buildRelatedProductIndex(): Map<string, Set<string>> {
  const parent = new Map(_products.map(product => [product.id, product.id]));
  const find = (productId: string): string => {
    const parentId = parent.get(productId) || productId;
    if (parentId === productId) return productId;
    const rootId = find(parentId);
    parent.set(productId, rootId);
    return rootId;
  };
  const union = (leftId: string, rightId: string) => {
    const leftRoot = find(leftId);
    const rightRoot = find(rightId);
    if (leftRoot !== rightRoot) parent.set(rightRoot, leftRoot);
  };
  const firstProductByIdentity = new Map<string, string>();

  for (const product of _products) {
    for (const identity of productIdentityValues(product)) {
      const identityKey = `${product.cabinet_id}|${identity}`;
      const firstProductId = firstProductByIdentity.get(identityKey);
      if (firstProductId) union(firstProductId, product.id);
      else firstProductByIdentity.set(identityKey, product.id);
    }
  }

  const productsByRoot = new Map<string, Set<string>>();
  for (const product of _products) {
    const rootId = find(product.id);
    const related = productsByRoot.get(rootId) || new Set<string>();
    related.add(product.id);
    productsByRoot.set(rootId, related);
  }

  const relatedByProductId = new Map<string, Set<string>>();
  for (const related of productsByRoot.values()) {
    for (const productId of related) relatedByProductId.set(productId, related);
  }
  return relatedByProductId;
}

function getRelatedProductIds(
  seedProductIds: Iterable<string>,
  relatedByProductId = buildRelatedProductIndex(),
): Set<string> {
  const related = new Set(seedProductIds);
  for (const productId of [...related]) {
    for (const relatedProductId of relatedByProductId.get(productId) || []) related.add(relatedProductId);
  }
  return related;
}

function refreshEntryPointFinancialFields(): boolean {
  if (!_entryPoints.length) return false;
  const productsById = new Map(_products.map(product => [product.id, product]));
  const relatedByProductId = buildRelatedProductIndex();
  const rootByProductId = new Map<string, string>();
  const visited = new Set<string>();
  for (const product of _products) {
    if (visited.has(product.id)) continue;
    const related = relatedByProductId.get(product.id) || new Set([product.id]);
    const root = [...related].sort()[0] || product.id;
    for (const productId of related) {
      rootByProductId.set(productId, root);
      visited.add(productId);
    }
  }
  const keyOf = (date: string, productId: string) => `${date}|${rootByProductId.get(productId) || productId}`;
  const metricTotals = new Map<string, { orders: number; orderedAmount: number; adSpend: number; profit: number; revenue: number }>();
  for (const metric of _metrics) {
    const key = keyOf(metric.date, metric.product_id);
    const current = metricTotals.get(key) || { orders: 0, orderedAmount: 0, adSpend: 0, profit: 0, revenue: 0 };
    current.orders += metric.orders;
    current.orderedAmount += metric.ordered_amount;
    current.adSpend += metric.ad_spend;
    current.profit += metric.actual_profit;
    current.revenue += metric.profit_revenue;
    metricTotals.set(key, current);
  }
  const reportTotals = new Map<string, { profit: number; revenue: number }>();
  for (const record of _profitability) {
    const key = keyOf(record.period_start, record.product_id);
    const cabinetId = productsById.get(record.product_id)?.cabinet_id || '';
    const extraExpense = getCabinetExtraExpense(record.period_start.slice(0, 7), cabinetId);
    const current = reportTotals.get(key) || { profit: 0, revenue: 0 };
    current.profit += getReportNetProfit(record, extraExpense);
    current.revenue += record.profit_revenue;
    reportTotals.set(key, current);
  }
  let changed = false;
  for (const record of _entryPoints) {
    const key = keyOf(record.date, record.product_id);
    const metric = metricTotals.get(key);
    const report = reportTotals.get(key);
    const next = {
      product_orders_total: metric?.orders || 0,
      product_ordered_amount: metric?.orderedAmount || 0,
      product_ad_spend: metric?.adSpend || 0,
      product_net_profit: report?.profit ?? metric?.profit ?? 0,
      product_profit_revenue: report?.revenue ?? metric?.revenue ?? 0,
    };
    const profitability = next.product_profit_revenue ? next.product_net_profit / next.product_profit_revenue * 100 : 0;
    if (record.product_orders_total !== next.product_orders_total
      || record.product_ordered_amount !== next.product_ordered_amount
      || record.product_ad_spend !== next.product_ad_spend
      || record.product_net_profit !== next.product_net_profit
      || record.product_profit_revenue !== next.product_profit_revenue
      || record.product_profitability !== profitability) {
      Object.assign(record, next, { product_profitability: profitability });
      changed = true;
    }
  }
  return changed;
}

function propagateWbSkuToCanonicalProducts() {
  let changed = false;
  const canonicalProducts = new Map<string, Product>();

  for (const product of _products) {
    if (product.sku === canonicalSellerSku(product.sku)) {
      canonicalProducts.set(`${product.cabinet_id}|${product.sku}`, product);
    }
  }

  for (const product of _products) {
    const canonicalSku = canonicalSellerSku(product.sku);
    if (canonicalSku === product.sku || !product.wb_sku || product.wb_sku === product.sku) continue;
    const canonicalProduct = canonicalProducts.get(`${product.cabinet_id}|${canonicalSku}`);
    if (!canonicalProduct || canonicalProduct.wb_sku === product.wb_sku) continue;
    canonicalProduct.wb_sku = product.wb_sku;
    changed = true;
  }

  return changed;
}

function registerAlias(sku: string, productId: string) {
  if (!sku) return;
  const product = _products.find(item => item.id === productId);
  if (product) _skuAliases.set(`${product.cabinet_id}|${sku}`, productId);
  if (!_skuAliases.has(sku)) _skuAliases.set(sku, productId);
  if (!product || sku === product.sku || sku === product.wb_sku) return;
  product.aliases ||= [];
  if (!product.aliases.includes(sku)) product.aliases.push(sku);
}

function enrichProductFromImport(product: Product, row: Record<string, string>, source: ImportSource) {
  if (row.name && (!product.name || product.name === product.sku)) product.name = row.name;
  if (row.category && !product.category) product.category = row.category;
  if (row.brand && !product.brand_id) {
    let brand = _brands.find(item => item.name.toLowerCase() === row.brand.trim().toLowerCase());
    if (!brand) {
      brand = { id: genId('br'), name: row.brand.trim() };
      _brands.push(brand);
    }
    product.brand_id = brand.id;
  }
  if (row.cabinet && !product.cabinet_id) {
    let cabinet = _cabinets.find(item => item.name.toLowerCase() === row.cabinet.trim().toLowerCase());
    if (!cabinet) {
      cabinet = { id: genId('cab'), name: row.cabinet.trim() };
      _cabinets.push(cabinet);
    }
    product.cabinet_id = cabinet.id;
  }
  product.status ||= 'active';
  product.data_source = 'import';
  product.updated_at = new Date().toISOString();
  if (row.sku) registerAlias(row.sku, product.id);
  if (row.wb_sku) registerAlias(row.wb_sku, product.id);
  void source;
}

function resolveImportCabinetId(sku: string, cabinetName?: string) {
  const normalizedName = String(cabinetName || '').trim().toLocaleLowerCase('ru-RU');
  if (normalizedName) {
    const existing = _cabinets.find(item => item.name.trim().toLocaleLowerCase('ru-RU') === normalizedName);
    if (existing) return existing.id;
    const cabinet = { id: genId('cab'), name: String(cabinetName).trim() };
    _cabinets.push(cabinet);
    return cabinet.id;
  }
  return classifySku(sku).cabinetId;
}

function resolveProduct(sku: string, wbSku?: string, cabinetName?: string): Product {
  const cabinetId = resolveImportCabinetId(sku, cabinetName);
  const matchesCabinet = (product: Product) => !cabinetId || !product.cabinet_id || product.cabinet_id === cabinetId;
  const adoptCabinet = (product: Product) => {
    if (cabinetId && !product.cabinet_id) product.cabinet_id = cabinetId;
    return product;
  };

  let p = _products.find(x => x.sku === sku && matchesCabinet(x));
  if (p) {
    adoptCabinet(p);
    if (wbSku && wbSku !== sku && p.wb_sku !== wbSku) {
      p.wb_sku = wbSku;
      registerAlias(wbSku, p.id);
    }
    return p;
  }

  const canonicalSku = canonicalSellerSku(sku);
  p = _products.find(x => canonicalSellerSku(x.sku) === canonicalSku && matchesCabinet(x));
  if (p) {
    adoptCabinet(p);
    registerAlias(sku, p.id);
    if (wbSku && wbSku !== p.sku && p.wb_sku !== wbSku) {
      p.wb_sku = wbSku;
      registerAlias(wbSku, p.id);
    }
    return p;
  }

  let pid = _skuAliases.get(`${cabinetId}|${sku}`) || (!cabinetId ? _skuAliases.get(sku) : undefined);
  if (pid) {
    p = _products.find(x => x.id === pid);
    if (p && matchesCabinet(p)) {
      adoptCabinet(p);
      if (wbSku && wbSku !== sku && p.wb_sku !== wbSku) {
        p.wb_sku = wbSku;
        registerAlias(wbSku, p.id);
      }
      return p;
    }
  }

  if (wbSku) {
    p = _products.find(x => (x.wb_sku === wbSku || x.sku === wbSku) && matchesCabinet(x));
    if (p) return adoptCabinet(p);
    pid = _skuAliases.get(`${cabinetId}|${wbSku}`) || (!cabinetId ? _skuAliases.get(wbSku) : undefined);
    if (pid) { p = _products.find(x => x.id === pid); if (p && matchesCabinet(p)) return adoptCabinet(p); }
  }

  p = _products.find(x => x.wb_sku === sku && matchesCabinet(x));
  if (p) return adoptCabinet(p);

  p = findOrCreateProduct(sku, undefined, cabinetId);
  if (wbSku && wbSku !== sku) {
    p.wb_sku = wbSku;
    registerAlias(wbSku, p.id);
  }
  registerAlias(sku, p.id);
  return p;
}

export function upsertMetrics(date: string, productId: string, patch: Partial<DailyMetrics>) {
  const existing = _metrics.find(m => m.date === date && m.product_id === productId);
  if (DEV) console.log('[store] upsertMetrics:', { date, productId, patch, existing: !!existing });
  if (existing) {
    Object.assign(existing, patch);
  } else {
    const empty: DailyMetrics = {
      date, product_id: productId,
      impressions: 0, clicks: 0, carts: 0, orders: 0, buyouts: 0, cancellations: 0,
      ordered_amount: 0, buyout_amount: 0, cancellation_amount: 0,
      ad_impressions: 0, ad_clicks: 0, ad_orders: 0, ad_spend: 0,
      stock: 0, plan_orders: 0, forecast_profit_per_order: 0, actual_profit: 0, actual_margin: 0, profit_revenue: 0,
      cost: 0, agent_fee: 0, logistics_cost: 0, marketing_cost: 0, storage_cost: 0,
    };
    _metrics.push({ ...empty, ...patch, date, product_id: productId });
  }
  notify(true, ['metrics']);
}

function toNumber(v: string): number {
  if (!v) return 0;
  const cleaned = v.replace(/[^0-9.,-]/g, '').replace(',', '.');
  const n = parseFloat(cleaned);
  return isNaN(n) ? 0 : n;
}

function parseDeliveryHours(value: string): number | null {
  const normalized = String(value || '').trim().toLowerCase();
  if (!normalized || normalized === '-' || normalized === '—') return null;
  const days = Number(normalized.match(/(\d+)\s*[дd]/)?.[1] || 0);
  const hours = Number(normalized.match(/(\d+)\s*[чh]/)?.[1] || 0);
  if (days || hours) return days * 24 + hours;
  const numeric = toNumber(normalized);
  return numeric > 0 ? numeric : null;
}



// Internal field name → DailyMetrics property mapping
const METRIC_FIELD_MAP: Record<string, keyof DailyMetrics> = {
  impressions: 'impressions', clicks: 'clicks', carts: 'carts',
  orders: 'orders', buyouts: 'buyouts', cancellations: 'cancellations',
  ordered_amount: 'ordered_amount', buyout_amount: 'buyout_amount',
  cancellation_amount: 'cancellation_amount',
  ad_impressions: 'ad_impressions', ad_clicks: 'ad_clicks',
  ad_orders: 'ad_orders', ad_spend: 'ad_spend',
  stock: 'stock', plan_orders: 'plan_orders',
  forecast_profit_per_order: 'forecast_profit_per_order',
  actual_profit: 'actual_profit', actual_margin: 'actual_margin', profit_revenue: 'profit_revenue',
  cost: 'cost', agent_fee: 'agent_fee', logistics_cost: 'logistics_cost', marketing_cost: 'marketing_cost', storage_cost: 'storage_cost',
};

export function detectSourceFromFilename(fileName: string): ImportSource {
  const normalizedName = fileName.toLocaleLowerCase('ru-RU');
  if (normalizedName.includes('поисков') || normalizedName.includes('search quer')) return 'search_queries';
  if (normalizedName.includes('динамик') && normalizedName.includes('ниш')) return 'niche_dynamics';
  const n = fileName.toLowerCase().replace(/[^a-zа-я0-9]/g, '');
  if (n.includes('wb') || n.includes('funnel') || n.includes('воронк')) return 'wb_funnel';
  if (n.includes('xway') || n.includes('реклам') || n.includes('ad') || n.includes('adv')) return 'xway';
  return 'profitability';
}

/**
 * Import already-column-mapped rows.
 * Headers are internal field names (sku, date, impressions, …).
 * Source is passed explicitly — no content-based detection.
 */
const SOURCE_FIELDS: Record<ImportSource, ReadonlySet<keyof DailyMetrics>> = {
  wb_funnel: new Set([
    'impressions', 'clicks', 'carts', 'orders', 'buyouts', 'cancellations',
    'ordered_amount', 'buyout_amount', 'cancellation_amount',
    'stock', 'agent_fee', 'logistics_cost', 'marketing_cost', 'storage_cost', 'cost',
  ]),
  xway: new Set([
    'ad_impressions', 'ad_clicks', 'ad_orders', 'ad_spend',
  ]),
  profitability: new Set([
    'actual_profit', 'actual_margin', 'profit_revenue',
  ]),
  geography: new Set([]),
  entry_points: new Set([]),
  search_queries: new Set([]),
  niche_dynamics: new Set([]),
  plan_template: new Set([]),
};

function getImportStoreNames(source: ImportSource, entryPointsChanged: boolean): DataStoreName[] {
  const stores = new Set<DataStoreName>(['importLogs']);
  if (source !== 'niche_dynamics' && source !== 'search_queries') {
    stores.add('cabinets');
    stores.add('brands');
    stores.add('products');
    stores.add('memberships');
  }
  if (source === 'profitability') {
    stores.add('profitability');
    stores.add('metrics');
  } else if (source === 'geography') {
    stores.add('geography');
  } else if (source === 'entry_points') {
    stores.add('entryPoints');
  } else if (source === 'search_queries') {
    stores.add('searchQueries');
  } else if (source === 'niche_dynamics') {
    stores.add('nicheDynamics');
  } else {
    stores.add('metrics');
  }
  if (entryPointsChanged) stores.add('entryPoints');
  return [...stores];
}

export function clearMetricsRange(source: ImportSource, dateFrom: string, dateTo: string): number {
  const fields = SOURCE_FIELDS[source];
  if (!fields || fields.size === 0) return 0;

  const allMetricKeys: (keyof DailyMetrics)[] = [
    'impressions', 'clicks', 'carts', 'orders', 'buyouts', 'cancellations',
    'ordered_amount', 'buyout_amount', 'cancellation_amount',
    'ad_impressions', 'ad_clicks', 'ad_orders', 'ad_spend',
    'stock', 'plan_orders', 'forecast_profit_per_order',
    'actual_profit', 'actual_margin', 'profit_revenue',
    'cost', 'agent_fee', 'logistics_cost', 'marketing_cost', 'storage_cost',
  ];

  let count = 0;
  for (let i = _metrics.length - 1; i >= 0; i--) {
    const m = _metrics[i];
    if (m.date >= dateFrom && m.date <= dateTo) {
      const otherFields = allMetricKeys.filter(k => !fields.has(k));
      const hasOtherData = otherFields.some(k => m[k] !== 0);

      if (!hasOtherData) {
        // Row only has data from this source — delete entirely
        _metrics.splice(i, 1);
        count++;
      } else {
        // Row has data from multiple sources — zero out only this source's fields
        let touched = false;
        for (const f of fields) {
          if (m[f] !== 0) {
            (m as any)[f] = 0;
            touched = true;
          }
        }
        if (touched) count++;
      }
    }
  }
  if (source === 'profitability') {
    const before = _profitability.length;
    _profitability = _profitability.filter(record =>
      record.period_end < dateFrom || record.period_start > dateTo
    );
    count += before - _profitability.length;
  }
  if (count > 0) notify(true, source === 'profitability' ? ['metrics', 'profitability'] : ['metrics']);
  return count;
}

export interface DateMigrationResult {
  metrics: number;
  profitability: number;
  importLogs: number;
  conflicts: number;
  partialRecords: number;
  applied: boolean;
}

function isWithinDateRange(date: string | undefined, dateStart: string, dateEnd: string): boolean {
  return Boolean(date && date >= dateStart && date <= dateEnd);
}

export function previewDateMigration(dateStart: string, dateEnd: string, days: number): DateMigrationResult {
  if (!dateStart || !dateEnd || dateStart > dateEnd || !Number.isInteger(days) || days === 0) {
    return {
      metrics: 0,
      profitability: 0,
      importLogs: 0,
      conflicts: 1,
      partialRecords: 0,
      applied: false,
    };
  }

  const selectedMetricKeys = new Set(
    _metrics
      .filter(metric => isWithinDateRange(metric.date, dateStart, dateEnd))
      .map(metric => `${metric.date}|${metric.product_id}`),
  );
  const existingMetricKeys = new Set(
    _metrics.map(metric => `${metric.date}|${metric.product_id}`),
  );

  let conflicts = 0;
  for (const metric of _metrics) {
    if (!isWithinDateRange(metric.date, dateStart, dateEnd)) continue;
    const destinationKey = `${addDays(metric.date, days)}|${metric.product_id}`;
    if (existingMetricKeys.has(destinationKey) && !selectedMetricKeys.has(destinationKey)) {
      conflicts++;
    }
  }

  let partialRecords = 0;
  const profitability = _profitability.filter(record => {
    const startSelected = isWithinDateRange(record.period_start, dateStart, dateEnd);
    const endSelected = isWithinDateRange(record.period_end, dateStart, dateEnd);
    if (startSelected !== endSelected) partialRecords++;
    return startSelected && endSelected;
  }).length;

  const importLogs = _importLog.filter(log => {
    if (!log.dataStart) return false;
    const startSelected = isWithinDateRange(log.dataStart, dateStart, dateEnd);
    const endSelected = !log.dataEnd || isWithinDateRange(log.dataEnd, dateStart, dateEnd);
    if (startSelected !== endSelected) partialRecords++;
    return startSelected && endSelected;
  }).length;

  return {
    metrics: selectedMetricKeys.size,
    profitability,
    importLogs,
    conflicts,
    partialRecords,
    applied: false,
  };
}

export function migrateDateRange(dateStart: string, dateEnd: string, days: number): DateMigrationResult {
  const preview = previewDateMigration(dateStart, dateEnd, days);
  if (preview.conflicts > 0 || preview.partialRecords > 0) return preview;

  for (const metric of _metrics) {
    if (isWithinDateRange(metric.date, dateStart, dateEnd)) {
      metric.date = addDays(metric.date, days);
    }
  }
  for (const record of _profitability) {
    if (
      isWithinDateRange(record.period_start, dateStart, dateEnd)
      && isWithinDateRange(record.period_end, dateStart, dateEnd)
    ) {
      record.period_start = addDays(record.period_start, days);
      record.period_end = addDays(record.period_end, days);
    }
  }
  for (const log of _importLog) {
    const startSelected = isWithinDateRange(log.dataStart, dateStart, dateEnd);
    const endSelected = !log.dataEnd || isWithinDateRange(log.dataEnd, dateStart, dateEnd);
    if (!startSelected || !endSelected) continue;
    if (log.dataStart) log.dataStart = addDays(log.dataStart, days);
    if (log.dataEnd) log.dataEnd = addDays(log.dataEnd, days);
  }

  notify(true, ['metrics', 'profitability', 'importLogs']);
  return { ...preview, applied: true };
}

export function clearMetricsAndImports(): void {
  _metrics = [];
  _importLog = [];
  _profitability = [];
  _geography = [];
  _geographyPlans = [];
  _entryPoints = [];
  _searchQueries = [];
  _nicheDynamics = [];
  _monthlyPlans = [];
  saveMonthlyPlansBackup();
  persistAll();
  notify(false);
}

export function resetAllData(): void {
  _cabinets = [];
  _brands = [];
  _groups = [];
  _products = [];
  _memberships = [];
  _metrics = [];
  _importLog = [];
  _plans = [];
  _monthlyPlans = [];
  saveMonthlyPlansBackup();
  _profitability = [];
  _geography = [];
  _geographyPlans = [];
  _entryPoints = [];
  _skuAliases.clear();
  _nextLogId = 1;
  seed();
  persistAll();
  notify(false);
}

export async function importMappedData(
  fileName: string,
  source: ImportSource,
  rows: Record<string, string>[],
  dateOverride?: string,
  dateEndOverride?: string,
  dateYearOverride?: number,
): Promise<ImportFileLog> {
  const log: ImportFileLog = {
    id: `log-${_nextLogId++}`, fileName, source, rowCount: 0,
    uploadedAt: new Date().toISOString(), status: 'processing',
  };

  _importLog.push(log);

  if (DEV) console.log('[import] fileName:', fileName);
  if (DEV) console.log('[import] source:', source, 'dateOverride:', dateOverride);
  if (DEV) console.log('[import] first row keys:', rows.length > 0 ? Object.keys(rows[0]) : '(empty)', 'row1:', rows[0]);

  try {
    if (!rows.length) throw new Error('Нет данных для импорта');

    const invalidDateRows = rows.filter(row => {
      if (!(row.sku || row.wb_sku)) return false;
      if (source === 'profitability') {
        const start = normalizeImportDate(dateOverride || row.date || row.period_start || '', dateYearOverride);
        const end = normalizeImportDate(dateEndOverride || row.period_end || '', dateYearOverride) || start;
        return !start || !end || end < start;
      }
      return !normalizeImportDate(dateOverride || row.date || '', dateYearOverride);
    }).length;
    if (invalidDateRows > 0) {
      throw new Error(`Импорт остановлен: некорректная дата или период в ${invalidDateRows} строках`);
    }

    _suppressPersist = true;

    let parsed = 0;
    let minDate = '';
    let maxDate = '';
    const productIds = new Set<string>();

    if (source === 'profitability') {
      // Profitability import → write to _profitability, not _metrics
      const profitabilityMetricPatches: Array<{ date: string; product_id: string; patch: Partial<DailyMetrics> }> = [];
      for (const row of rows) {
        const rawSku = row.sku;
        const rawWbSku = row.wb_sku;
        const sku = rawSku || rawWbSku;
        if (!sku) {
          if (DEV) console.log('[import] skip row — missing sku');
          continue;
        }

        const product = resolveProduct(sku, rawWbSku, row.cabinet);
        enrichProductFromImport(product, row, source);
        if (rawSku && rawSku !== product.sku) registerAlias(rawSku, product.id);
        if (rawWbSku && rawWbSku !== product.sku && rawWbSku !== rawSku) registerAlias(rawWbSku, product.id);

        const period_start = normalizeImportDate(dateOverride || row.date || row.period_start || '', dateYearOverride);
        if (!period_start) {
          if (DEV) console.log('[import] skip row — missing date/period');
          continue;
        }
        const period_end = normalizeImportDate(dateEndOverride || row.period_end || '', dateYearOverride) || period_start;

        const revenue = toNumber(row.profit_revenue || '0');
        const reportProfit = toNumber(row.actual_profit || '0');
        const reportMargin = toNumber(row.actual_margin || '0');
        const expenseFields = ['cost', 'agent_fee', 'logistics_cost', 'marketing_cost', 'storage_cost'] as const;
        const hasExpenseBreakdown = expenseFields.some(field => row[field] !== undefined && row[field] !== '');
        const calculatedProfit = revenue - expenseFields.reduce((sum, field) => sum + toNumber(row[field] || '0'), 0);
        const actualProfit = hasExpenseBreakdown ? calculatedProfit : reportProfit;
        const actualMargin = revenue
          ? actualProfit / revenue * 100
          : reportMargin;

        const rec: ProfitabilityRecord = {
          id: genId('prf'),
          product_id: product.id,
          period_start,
          period_end,
          actual_profit: actualProfit,
          actual_margin: actualMargin,
          profit_revenue: revenue,
        };
        upsertProfitabilityRecord(rec);
        profitabilityMetricPatches.push({
          date: period_start,
          product_id: product.id,
          patch: {
            actual_profit: actualProfit,
            actual_margin: actualMargin,
            profit_revenue: revenue,
            cost: toNumber(row.cost || '0'),
            agent_fee: toNumber(row.agent_fee || '0'),
            logistics_cost: toNumber(row.logistics_cost || '0'),
            marketing_cost: toNumber(row.marketing_cost || '0'),
            storage_cost: toNumber(row.storage_cost || '0'),
          },
        });
        parsed++;

        if (!minDate || period_start < minDate) minDate = period_start;
        if (!maxDate || period_end > maxDate) maxDate = period_end;
        productIds.add(product.id);
      }
      const metricsByKey = new Map(_metrics.map(metric => [`${metric.date}|${metric.product_id}`, metric]));
      for (const item of profitabilityMetricPatches) {
        const key = `${item.date}|${item.product_id}`;
        const existing = metricsByKey.get(key);
        if (existing) {
          Object.assign(existing, item.patch);
        } else {
          const metric: DailyMetrics = {
            date: item.date, product_id: item.product_id,
            impressions: 0, clicks: 0, carts: 0, orders: 0, buyouts: 0, cancellations: 0,
            ordered_amount: 0, buyout_amount: 0, cancellation_amount: 0,
            ad_impressions: 0, ad_clicks: 0, ad_orders: 0, ad_spend: 0,
            stock: 0, plan_orders: 0, forecast_profit_per_order: 0,
            actual_profit: 0, actual_margin: 0, profit_revenue: 0,
            cost: 0, agent_fee: 0, logistics_cost: 0, marketing_cost: 0, storage_cost: 0,
            ...item.patch,
          };
          _metrics.push(metric);
          metricsByKey.set(key, metric);
        }
      }
    } else if (source === 'geography') {
      const recordsByKey = new Map(_geography.map(record => [`${record.date}|${record.product_id}|${record.region}|${record.area || ''}|${record.city || ''}`, record]));
      for (const row of rows) {
        const date = normalizeImportDate(dateOverride || row.date, dateYearOverride);
        const rawSku = row.sku;
        const rawWbSku = row.wb_sku;
        const sku = rawSku || rawWbSku;
        const region = String(row.region || '').trim();
        if (!date || !sku || !region) continue;
        const product = resolveProduct(sku, rawWbSku, row.cabinet);
        enrichProductFromImport(product, row, source);
        if (rawSku && rawSku !== product.sku) registerAlias(rawSku, product.id);
        if (rawWbSku && rawWbSku !== product.sku && rawWbSku !== rawSku) registerAlias(rawWbSku, product.id);
        const area = String(row.area || '').trim() || 'Без региона';
        const city = String(row.city || '').trim() || 'Без населённого пункта';
        const record: GeographyOrderRecord = {
          date, product_id: product.id, region, area, city, delivery_hours: parseDeliveryHours(row.delivery_time),
          orders_total: toNumber(row.geo_orders_total), product_local_orders: toNumber(row.geo_product_local_orders),
          product_nonlocal_orders: toNumber(row.geo_product_nonlocal_orders), wb_local_orders: toNumber(row.geo_wb_local_orders),
          wb_nonlocal_orders: toNumber(row.geo_wb_nonlocal_orders), marketplace_local_orders: toNumber(row.geo_mp_local_orders),
          marketplace_nonlocal_orders: toNumber(row.geo_mp_nonlocal_orders), stock_wb: toNumber(row.geo_stock_wb), stock_marketplace: toNumber(row.geo_stock_mp),
        };
        const key = `${date}|${product.id}|${region}|${area}|${city}`;
        const existing = recordsByKey.get(key);
        if (existing) Object.assign(existing, record); else { _geography.push(record); recordsByKey.set(key, record); }
        parsed++;
        if (!minDate || date < minDate) minDate = date;
        if (!maxDate || date > maxDate) maxDate = date;
        productIds.add(product.id);
      }
    } else if (source === 'niche_dynamics') {
      const recordsByKey = new Map(_nicheDynamics.map(record => [`${record.date}|${record.category}|${record.subject}`, record]));
      for (const row of rows) {
        const date = normalizeImportDate(dateOverride || row.date, dateYearOverride);
        const category = String(row.niche_category || '').trim();
        const subject = String(row.niche_subject || '').trim();
        if (!date || !category || !subject) continue;
        const record: NicheDynamicsRecord = {
          date, category, subject,
          sellers: toNumber(row.niche_sellers), active_sellers: toNumber(row.niche_active_sellers), active_sellers_previous: toNumber(row.niche_active_sellers_previous),
          monopolization: toNumber(row.niche_monopolization), monopolization_previous: toNumber(row.niche_monopolization_previous),
          revenue: toNumber(row.niche_revenue), revenue_previous: toNumber(row.niche_revenue_previous),
          avg_check: toNumber(row.niche_avg_check), avg_check_previous: toNumber(row.niche_avg_check_previous),
          product_cards: toNumber(row.niche_product_cards), active_product_cards: toNumber(row.niche_active_product_cards), active_product_cards_previous: toNumber(row.niche_active_product_cards_previous),
          active_product_cards_share: toNumber(row.niche_active_product_cards_share), weekly_turnover_days: toNumber(row.niche_weekly_turnover_days),
          availability: String(row.niche_availability || '').trim(), avg_stock: toNumber(row.niche_avg_stock),
          buyout_rate: toNumber(row.niche_buyout_rate), buyout_rate_previous: toNumber(row.niche_buyout_rate_previous), avg_rating: toNumber(row.niche_avg_rating),
        };
        const key = `${date}|${category}|${subject}`;
        const existing = recordsByKey.get(key);
        if (existing) Object.assign(existing, record); else { _nicheDynamics.push(record); recordsByKey.set(key, record); }
        parsed++;
        if (!minDate || date < minDate) minDate = date;
        if (!maxDate || date > maxDate) maxDate = date;
      }
    } else if (source === 'search_queries') {
      const recordsByKey = new Map(_searchQueries.map(record => [`${record.date}|${record.query}|${record.category}`, record]));
      for (const row of rows) {
        const date = normalizeImportDate(dateOverride || row.date, dateYearOverride);
        const query = String(row.search_query || '').trim().toLocaleLowerCase('ru-RU');
        const category = String(row.search_category || '').trim() || 'Без предмета';
        if (!date || !query) continue;
        const record: SearchQueryRecord = {
          date, query, category,
          requests: toNumber(row.search_requests), requests_previous: toNumber(row.search_requests_previous),
          avg_daily_requests: toNumber(row.search_avg_daily), avg_daily_requests_previous: toNumber(row.search_avg_daily_previous),
          card_clicks: toNumber(row.search_card_clicks), card_clicks_previous: toNumber(row.search_card_clicks_previous),
          carts: toNumber(row.search_carts), carts_previous: toNumber(row.search_carts_previous),
          cart_conversion: toNumber(row.search_cart_conversion), cart_conversion_previous: toNumber(row.search_cart_conversion_previous),
          orders: toNumber(row.search_orders), orders_previous: toNumber(row.search_orders_previous),
          order_conversion: toNumber(row.search_order_conversion), order_conversion_previous: toNumber(row.search_order_conversion_previous),
          ordered_subjects: toNumber(row.search_ordered_subjects), ordered_subjects_previous: toNumber(row.search_ordered_subjects_previous),
          products: toNumber(row.search_products), products_previous: toNumber(row.search_products_previous),
        };
        const key = `${date}|${query}|${category}`;
        const existing = recordsByKey.get(key);
        if (existing) Object.assign(existing, record); else { _searchQueries.push(record); recordsByKey.set(key, record); }
        parsed++;
        if (!minDate || date < minDate) minDate = date;
        if (!maxDate || date > maxDate) maxDate = date;
      }
    } else if (source === 'entry_points') {
      const recordsByKey = new Map(_entryPoints.map(record => [`${record.date}|${record.product_id}|${record.section}|${record.entry_point}`, record]));
      for (const row of rows) {
        const date = normalizeImportDate(dateOverride || row.date, dateYearOverride);
        const rawSku = row.sku;
        const rawWbSku = row.wb_sku;
        const sku = rawSku || rawWbSku;
        const section = String(row.entry_section || '').trim();
        const entryPoint = String(row.entry_point || '').trim() || 'Без уточнения';
        if (!date || !sku || !section) continue;
        const product = resolveProduct(sku, rawWbSku, row.cabinet);
        enrichProductFromImport(product, row, source);
        const record: EntryPointRecord = { date, product_id: product.id, section, entry_point: entryPoint, impressions: toNumber(row.entry_impressions), clicks: toNumber(row.entry_clicks), carts: toNumber(row.entry_carts), orders: toNumber(row.entry_orders) };
        const key = `${date}|${product.id}|${section}|${entryPoint}`;
        const existing = recordsByKey.get(key);
        if (existing) Object.assign(existing, record); else { _entryPoints.push(record); recordsByKey.set(key, record); }
        parsed++;
        if (!minDate || date < minDate) minDate = date;
        if (!maxDate || date > maxDate) maxDate = date;
        productIds.add(product.id);
      }
    } else {
      // WB / XWay import → write to _metrics
      const emptyMetric: DailyMetrics = {
        date: '', product_id: '',
        impressions: 0, clicks: 0, carts: 0, orders: 0, buyouts: 0, cancellations: 0,
        ordered_amount: 0, buyout_amount: 0, cancellation_amount: 0,
        ad_impressions: 0, ad_clicks: 0, ad_orders: 0, ad_spend: 0,
        stock: 0, plan_orders: 0, forecast_profit_per_order: 0, actual_profit: 0, actual_margin: 0, profit_revenue: 0,
        cost: 0, agent_fee: 0, logistics_cost: 0, marketing_cost: 0, storage_cost: 0,
      };
      const newPatchesByKey = new Map<string, Partial<DailyMetrics>>();

      for (const row of rows) {
        const date = normalizeImportDate(dateOverride || row.date, dateYearOverride);
        const rawSku = row.sku;
        const rawWbSku = row.wb_sku;
        const sku = rawSku || rawWbSku;
        if (!date || !sku) {
          if (DEV) console.log('[import] skip row — missing date or sku:', { date, sku, rawSku, rawWbSku, rowKeys: Object.keys(row) });
          continue;
        }

        const product = resolveProduct(sku, rawWbSku, row.cabinet);
        enrichProductFromImport(product, row, source);
        if (rawSku && rawSku !== product.sku) registerAlias(rawSku, product.id);
        if (rawWbSku && rawWbSku !== product.sku && rawWbSku !== rawSku) registerAlias(rawWbSku, product.id);

        const patch: Partial<DailyMetrics> = {};
        const allowed = SOURCE_FIELDS[source];
        for (const [field, metricKey] of Object.entries(METRIC_FIELD_MAP)) {
          if (allowed?.has(metricKey) && row[field] !== undefined && row[field] !== '') {
            (patch as Record<string, number | undefined>)[metricKey] = toNumber(row[field]);
          }
        }

        const patchKey = `${date}|${product.id}`;
        const combinedPatch = newPatchesByKey.get(patchKey) || { date, product_id: product.id };
        for (const [field, value] of Object.entries(patch)) {
          const combined = combinedPatch as Record<string, string | number | undefined>;
          combined[field] = Number(combined[field] || 0) + Number(value || 0);
        }
        newPatchesByKey.set(patchKey, combinedPatch);
        parsed++;

        if (!minDate || date < minDate) minDate = date;
        if (!maxDate || date > maxDate) maxDate = date;
        productIds.add(product.id);
      }

      if (parsed > 0) {
        const sourceFields = SOURCE_FIELDS[source];
        const relatedByProductId = buildRelatedProductIndex();
        const replacementKeys = new Set<string>();
        for (const patch of newPatchesByKey.values()) {
          if (!patch.date || !patch.product_id) continue;
          for (const relatedProductId of getRelatedProductIds([String(patch.product_id)], relatedByProductId)) {
            replacementKeys.add(`${patch.date}|${relatedProductId}`);
          }
        }
        for (const metric of _metrics) {
          if (!replacementKeys.has(`${metric.date}|${metric.product_id}`)) continue;
          for (const field of sourceFields) {
            (metric as unknown as Record<string, number | string>)[field] = 0;
          }
        }

        const metricsByKey = new Map(_metrics.map(metric => [`${metric.date}|${metric.product_id}`, metric]));
        for (const np of newPatchesByKey.values()) {
          const existing = metricsByKey.get(`${np.date}|${np.product_id}`);
          if (existing) {
            Object.assign(existing, np);
          } else {
            const metric = { ...emptyMetric, ...np };
            _metrics.push(metric);
            metricsByKey.set(`${metric.date}|${metric.product_id}`, metric);
          }
        }
      }
    }

    log.rowCount = parsed;
    log.status = parsed > 0 ? 'success' : 'error';
    log.dataStart = minDate || undefined;
    log.dataEnd = maxDate || undefined;
    log.productIds = productIds.size > 0 ? [...productIds] : undefined;
    if (parsed === 0) log.error = 'Не удалось импортировать ни одной строки';
    if (DEV) console.log('[import] completed:', parsed, 'rows, status:', log.status, 'period:', log.dataStart, '-', log.dataEnd, 'products:', productIds.size);

    if (parsed > 0) {
      const hasProductRows = source !== 'niche_dynamics' && source !== 'search_queries';
      if (hasProductRows) {
        propagateWbSkuToCanonicalProducts();
        buildAliasMap();
      }
      const refreshEntryPoints = source === 'wb_funnel'
        || source === 'xway'
        || source === 'profitability'
        || source === 'entry_points';
      const entryPointsChanged = refreshEntryPoints ? refreshEntryPointFinancialFields() : false;
      const changedStores = getImportStoreNames(source, entryPointsChanged);
      await persistStores(changedStores);

      _suppressPersist = false;
      notify(false, changedStores);
    } else {
      _suppressPersist = false;
    }

    if (parsed === 0) notify(true, ['importLogs']);
  } catch (err) {
    _suppressPersist = false;
    log.status = 'error';
    log.error = err instanceof Error ? err.message : 'Неизвестная ошибка';
    if (DEV) console.log('[import] error:', log.error);
    notify(true, ['importLogs']);
  }

  return log;
}

/**
 * Legacy CSV import with source detection from filename.
 * Prefer importMappedData for new code.
 */
export async function importCSV(fileName: string, text: string): Promise<ImportFileLog> {
  const source = detectSourceFromFilename(fileName);
  if (DEV) console.log('[import] legacy path — fileName:', fileName, 'source:', source);

  try {
    const delimiter = text.trim().includes(';') && text.trim().split(';').length >= 3 ? ';' : ',';
    const lines = text.trim().split(/\r?\n/);
    if (lines.length < 2) throw new Error('Файл пуст или содержит только заголовок');
    const rawHeaders = lines[0].split(delimiter).map(h => h.trim().toLowerCase());
    const rows = lines.slice(1).map(line => {
      const vals = line.split(delimiter).map(v => v.trim());
      const row: Record<string, string> = {};
      rawHeaders.forEach((h, i) => { row[h] = vals[i] || ''; });
      return row;
    }).filter(r => rawHeaders.some(h => r[h]));
    return await importMappedData(fileName, source, rows);
  } catch (err) {
    const errorLog: ImportFileLog = {
      id: `log-${_nextLogId++}`, fileName, source, rowCount: 0,
      uploadedAt: new Date().toISOString(), status: 'error',
      error: err instanceof Error ? err.message : 'Неизвестная ошибка',
    };
    return errorLog;
  }
}

function sumChildren(parentId: string) {
  const target = _plans.find(p => p.entityId === parentId && (p.entityType === 'group' || p.entityType === 'cabinet'));
  if (!target) return;
  const childType = target.entityType === 'cabinet' ? 'group' : 'product';
  const children = _plans.filter(p => p.parentId === parentId && p.entityType === childType);
  target.ordersQty = children.reduce((s, p) => s + p.ordersQty, 0);
  target.ordersSum = children.reduce((s, p) => s + p.ordersSum, 0);
  target.netProfit = children.reduce((s, p) => s + p.netProfit, 0);
  target.avgPrice = target.ordersQty ? target.ordersSum / target.ordersQty : 0;
  target.profitability = target.ordersSum ? (target.netProfit / target.ordersSum) * 100 : 0;
}

export function getPlanRecords(): PlanRecord[] {
  return cachedRows('plans', _plans);
}

export function getPlanTotals() {
  let ordersQty = 0, ordersSum = 0, netProfit = 0;
  for (const p of _plans) {
    if (p.entityType !== 'product') continue;
    ordersQty += p.ordersQty;
    ordersSum += p.ordersSum;
    netProfit += p.netProfit;
  }
  return {
    ordersQty,
    avgPrice: ordersQty ? ordersSum / ordersQty : 0,
    ordersSum,
    profitability: ordersSum ? (netProfit / ordersSum) * 100 : 0,
    netProfit,
  };
}

export function updatePlanField(entityId: string, field: 'ordersQty' | 'avgPrice' | 'profitability', value: number) {
  const rec = _plans.find(p => p.entityId === entityId);
  if (!rec) return;

  rec[field] = value;

  if (field === 'ordersQty' || field === 'avgPrice') {
    rec.ordersSum = rec.ordersQty * rec.avgPrice;
    rec.netProfit = rec.ordersSum * (rec.profitability / 100);
  } else if (field === 'profitability') {
    rec.netProfit = rec.ordersSum * (value / 100);
  }

  if (rec.entityType === 'product' && rec.parentId) {
    sumChildren(rec.parentId);
    const parentGroup = _plans.find(p => p.entityId === rec.parentId && p.entityType === 'group');
    if (parentGroup?.parentId) sumChildren(parentGroup.parentId);
  } else if (rec.entityType === 'group' && rec.parentId) {
    sumChildren(rec.parentId);
  }

  notify(true, ['plans']);
}

function seedDerivedData() {
  // Create plans for any entities that don't have them yet
  const newPlans = createSeedPlans(_cabinets, _groups, _products, _memberships);
  for (const p of newPlans) {
    if (!_plans.some(ex => ex.entityId === p.entityId && ex.entityType === p.entityType)) {
      _plans.push(p);
    }
  }

  // Auto-create products from classification rules (for newly added rules)
  const rules = getRules();
  const seen = new Set<string>();
  for (const rule of rules.groupRules) {
    for (const sku of rule.skus) {
      if (!seen.has(sku)) {
        seen.add(sku);
        findOrCreateProduct(sku);
      }
    }
  }
}

function restoreNextId() {
  let maxLog = 0;
  for (const l of _importLog) {
    const parts = l.id.split('-');
    const num = parseInt(parts[parts.length - 1], 10);
    if (!isNaN(num) && num > maxLog) maxLog = num;
  }
  _nextLogId = maxLog + 1;
}

export function getMonthlyPlans(): MonthlyPlanRecord[] {
  return cachedRows('monthlyPlans', _monthlyPlans);
}

export function getProfitabilityRecords(): ProfitabilityRecord[] {
  return cachedRows('profitability', _profitability);
}

export function getProfitabilityForProduct(productId: string): ProfitabilityRecord[] {
  return _profitability.filter(r => r.product_id === productId).map(r => ({ ...r }));
}

export function getProfitabilityForPeriod(productId: string, start: string, end: string): ProfitabilityRecord | undefined {
  return _profitability.find(r =>
    r.product_id === productId &&
    r.period_start === start &&
    r.period_end === end
  );
}

function upsertProfitabilityRecord(rec: ProfitabilityRecord) {
  const idx = _profitability.findIndex(r =>
    r.product_id === rec.product_id &&
    r.period_start === rec.period_start &&
    r.period_end === rec.period_end
  );
  if (idx >= 0) {
    _profitability[idx] = rec;
  } else {
    _profitability.push(rec);
  }
}

export function upsertMonthlyPlan(rec: MonthlyPlanRecord) {
  const idx = _monthlyPlans.findIndex(p => p.sku === rec.sku && p.month === rec.month);
  if (idx >= 0) {
    _monthlyPlans[idx] = rec;
  } else {
    _monthlyPlans.push(rec);
  }
  saveMonthlyPlansBackup();
  notify(true, ['monthlyPlans']);
}

export async function upsertMonthlyPlans(records: MonthlyPlanRecord[]) {
  for (const rec of records) {
    const idx = _monthlyPlans.findIndex(p => p.sku === rec.sku && p.month === rec.month);
    if (idx >= 0) {
      _monthlyPlans[idx] = rec;
    } else {
      _monthlyPlans.push(rec);
    }
  }
  saveMonthlyPlansBackup();
  await persistStores(['monthlyPlans']);
  notify(false, ['monthlyPlans']);
}

export function deleteMonthlyPlan(sku: string, month: string) {
  _monthlyPlans = _monthlyPlans.filter(p => !(p.sku === sku && p.month === month));
  saveMonthlyPlansBackup();
  notify(true, ['monthlyPlans']);
}

export function getMonthlyPlansForMonth(month: string): MonthlyPlanRecord[] {
  return _monthlyPlans.filter(p => p.month === month).map(p => ({ ...p }));
}

export function upsertGeographyPlan(month: string, localShareTarget: number | null, deliveryHoursTarget: number | null) {
  const record: GeographyPlanRecord = { month, local_share_target: localShareTarget, delivery_hours_target: deliveryHoursTarget };
  const index = _geographyPlans.findIndex(plan => plan.month === month);
  if (index >= 0) _geographyPlans[index] = record;
  else _geographyPlans.push(record);
  notify(true, ['geographyPlans']);
}

export function updateMonthlyPlanField(sku: string, month: string, field: keyof Omit<MonthlyPlanRecord, 'sku' | 'month'>, value: number) {
  const rec = _monthlyPlans.find(p => p.sku === sku && p.month === month);
  if (!rec) return;
  (rec as any)[field] = value;
  saveMonthlyPlansBackup();
  notify(true, ['monthlyPlans']);
}

function cloneStore(store: DataStoreName): DataSnapshot[DataStoreName] {
  switch (store) {
    case 'cabinets': return _cabinets.map(item => ({ ...item }));
    case 'brands': return _brands.map(item => ({ ...item }));
    case 'groups': return _groups.map(item => ({ ...item }));
    case 'products': return _products.map(item => ({ ...item, aliases: item.aliases ? [...item.aliases] : [] }));
    case 'memberships': return _memberships.map(item => ({ ...item }));
    case 'metrics': return _metrics.map(item => ({ ...item }));
    case 'plans': return _plans.map(item => ({ ...item }));
    case 'monthlyPlans': return _monthlyPlans.map(item => ({ ...item }));
    case 'profitability': return _profitability.map(item => ({ ...item }));
    case 'geography': return _geography.map(item => ({ ...item }));
    case 'geographyPlans': return _geographyPlans.map(item => ({ ...item }));
    case 'entryPoints': return _entryPoints.map(item => ({ ...item }));
    case 'searchQueries': return _searchQueries.map(item => ({ ...item }));
    case 'nicheDynamics': return _nicheDynamics.map(item => ({ ...item }));
    case 'importLogs': return _importLog.map(item => ({
      ...item,
      productIds: item.productIds ? [...item.productIds] : undefined,
    }));
  }
}

function persistStores(storeNames: Iterable<DataStoreName>): Promise<void> {
  const selectedStores = new Set(_lastPersistedSnapshot ? storeNames : DATA_STORE_NAMES);
  const capturedStores = new Map<DataStoreName, DataSnapshot[DataStoreName]>();
  for (const store of selectedStores) capturedStores.set(store, cloneStore(store));

  _persistQueue = _persistQueue
    .catch(() => undefined)
    .then(async () => {
      const previousSnapshot = _lastPersistedSnapshot;
      const snapshot = previousSnapshot ? { ...previousSnapshot } : {} as DataSnapshot;
      const writableSnapshot = snapshot as unknown as Record<DataStoreName, DataSnapshot[DataStoreName]>;
      for (const [store, records] of capturedStores) writableSnapshot[store] = records;
      const changes = previousSnapshot
        ? createDataChanges(previousSnapshot, snapshot, selectedStores)
        : null;
      if (changes && !hasDataChanges(changes)) return;
      const result = changes ? await repository.saveChanges(changes) : await repository.saveAll(snapshot);
      if (!result.ok) {
        console.error('[persist] save failed:', result.errors);
        throw new Error(result.errors.join('; '));
      }
      _lastPersistedSnapshot = snapshot;
    });

  return _persistQueue;
}

function persistAll(): Promise<void> {
  return persistStores(DATA_STORE_NAMES);
}

export async function initStore() {
  if (_initCalled) return;
  await repository.initialize();
  _suppressPersist = true;
  let needsPersistence = false;

  const snapshot: DataSnapshot = await repository.loadAll();
  if (isCloudStorage && snapshot.cabinets.length === 0) {
    throw new Error('Supabase returned an empty dataset. Local seed data was not created.');
  }
  _lastPersistedSnapshot = {
    cabinets: snapshot.cabinets.map(item => ({ ...item })),
    brands: snapshot.brands.map(item => ({ ...item })),
    groups: snapshot.groups.map(item => ({ ...item })),
    products: snapshot.products.map(item => ({ ...item })),
    memberships: snapshot.memberships.map(item => ({ ...item })),
    metrics: snapshot.metrics.map(item => ({ ...item })),
    plans: snapshot.plans.map(item => ({ ...item })),
    monthlyPlans: snapshot.monthlyPlans.map(item => ({ ...item })),
    profitability: snapshot.profitability.map(item => ({ ...item })),
    geography: snapshot.geography.map(item => ({ ...item })),
    geographyPlans: snapshot.geographyPlans.map(item => ({ ...item })),
    entryPoints: snapshot.entryPoints.map(item => ({ ...item })),
    searchQueries: snapshot.searchQueries.map(item => ({ ...item })),
    nicheDynamics: snapshot.nicheDynamics.map(item => ({ ...item })),
    importLogs: snapshot.importLogs.map(item => ({ ...item, productIds: item.productIds ? [...item.productIds] : undefined })),
  };
  if (snapshot.cabinets.length === 0) {
    seed();
  } else {
    _cabinets = snapshot.cabinets;
    _brands = snapshot.brands;
    _groups = snapshot.groups;
    _products = snapshot.products;
    for (const product of _products) {
      if (!product.aliases) { product.aliases = []; needsPersistence = true; }
      if (!product.status) { product.status = 'active'; needsPersistence = true; }
      if (!product.data_source) { product.data_source = 'seed'; needsPersistence = true; }
      if (product.wb_sku === product.sku && product.wb_sku.replace(/\D/g, '').length < 7) {
        product.wb_sku = '';
        needsPersistence = true;
      }
    }
    _memberships = snapshot.memberships;
    _metrics = snapshot.metrics;
    if (DEV) {
      const dates = _metrics.map(m => m.date).filter(Boolean).sort();
      console.log('[initStore] _metrics assigned: rows=' + _metrics.length + ' dateRange=' + (dates.length ? dates[0] + '..' + dates[dates.length-1] : 'empty'));
    }
    _plans = snapshot.plans;
    const monthlyPlansBackup = isCloudStorage ? [] : loadMonthlyPlansBackup();
    _monthlyPlans = monthlyPlansBackup.length > 0 ? monthlyPlansBackup : snapshot.monthlyPlans;
    _profitability = snapshot.profitability;
    _geography = snapshot.geography;
    _geographyPlans = snapshot.geographyPlans;
    _entryPoints = snapshot.entryPoints;
    _searchQueries = snapshot.searchQueries;
    _nicheDynamics = snapshot.nicheDynamics;
    _importLog = snapshot.importLogs;
    restoreNextId();

    const MIGRATED_KEY = '_analytics_date_migration_v2';
    const migrationDone = typeof localStorage !== 'undefined' && localStorage.getItem(MIGRATED_KEY);
    const metricDates = _metrics.map(metric => metric.date).filter(Boolean).sort();
    const hasConfirmedShiftedRange = metricDates[0] === '2025-10-06'
      && metricDates[metricDates.length - 1] === '2026-07-09';

    if (!migrationDone && hasConfirmedShiftedRange) {
      for (const metric of _metrics) {
        metric.date = addDays(metric.date, 1);
      }
      for (const log of _importLog) {
        if (log.source !== 'wb_funnel' && log.source !== 'xway') continue;
        if (log.dataStart) log.dataStart = addDays(log.dataStart, 1);
        if (log.dataEnd) log.dataEnd = addDays(log.dataEnd, 1);
      }
      if (typeof localStorage !== 'undefined') localStorage.setItem(MIGRATED_KEY, '1');
      needsPersistence = true;
      if (DEV) console.log('[migration] v2: shifted confirmed WB/XWay metric dates +1 day');
    }
    const xwayMetrics = _metrics.filter(m => m.ad_spend > 0);
    if (xwayMetrics.length > 0) {
      const sumAdSpend = xwayMetrics.reduce((s, m) => s + m.ad_spend, 0);
      const dates = [...new Set(xwayMetrics.map(m => m.date))].sort();
      if (DEV) console.log('[diag] XWAY metrics found:', xwayMetrics.length, 'sumAdSpend:', sumAdSpend, 'dates:', dates, 'sample:', xwayMetrics.slice(0, 2));
    } else {
      if (DEV) console.log('[diag] NO XWAY metrics (ad_spend > 0)');
    }
    if (DEV) console.log('[diag] after SQLite load — cabinets:', _cabinets.length, 'brands:', _brands.length, 'groups:', _groups.length, 'products:', _products.length, 'memberships:', _memberships.length, 'plans:', _plans.length, 'metrics:', _metrics.length);
    seedDerivedData();
    if (propagateWbSkuToCanonicalProducts()) needsPersistence = true;
    buildAliasMap();
    if (DEV) console.log('[diag] after seedDerivedData — products:', _products.length, 'memberships:', _memberships.length, 'plans:', _plans.length);
  }

  if (!isCloudStorage && _monthlyPlans.length === 0) {
    _monthlyPlans = loadMonthlyPlansBackup();
  }

  await initializeExtraExpenses();
  const needsEntryPointFinancialBackfill = _entryPoints.some(record =>
    record.product_orders_total === undefined
    || record.product_ordered_amount === undefined
    || record.product_net_profit === undefined
    || record.product_profitability === undefined
  );
  if (needsEntryPointFinancialBackfill && refreshEntryPointFinancialFields()) needsPersistence = true;

  _suppressPersist = false;
  _initCalled = true;
  invalidateReadCache(DATA_STORE_NAMES);

  if (snapshot.cabinets.length === 0 || needsPersistence) {
    if (DEV) console.log('[diag] persisting initial or migrated data');
    persistAll();
  } else {
    if (DEV) console.log('[diag] subsequent run — NO persistAll');
  }
}
