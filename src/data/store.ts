import type { Cabinet, Brand, ProductGroup, Product, GroupMembership, DailyMetrics, ImportFileLog, ImportSource, PlanRecord, MonthlyPlanRecord } from '../types';
import { classifySku, getRules } from './rules';
import { repository } from '../database/db';
import type { DataSnapshot } from '../types';

let _version = 0;
const _listeners = new Set<() => void>();
let _initCalled = false;
let _suppressPersist = false;
let _flushPending = false;

function flushStore() {
  if (_flushPending) return;
  _flushPending = true;
  setTimeout(() => {
    _flushPending = false;
    const adSum = _metrics.reduce((s, m) => s + m.ad_spend, 0);
    const adCount = _metrics.filter(m => m.ad_spend > 0).length;
    console.log('[diag] flushStore — products:', _products.length, 'plans:', _plans.length, 'metrics:', _metrics.length, 'ad_spend>0:', adCount, 'sumAdSpend:', adSum);
    persistAll();
  }, 150);
}

function notify() {
  _version++;
  _listeners.forEach(fn => fn());
  if (_initCalled && !_suppressPersist) flushStore();
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
let _nextId = 100;

function genId(prefix: string) { return `${prefix}-${_nextId++}`; }

function seedDerivedData() {
  for (const c of _cabinets) {
    if (!_plans.some(p => p.entityId === c.id)) {
      _plans.push({ entityId: c.id, entityType: 'cabinet', parentId: null, name: c.name, ordersQty: 0, avgPrice: 0, ordersSum: 0, profitability: 0, netProfit: 0 });
    }
  }
  for (const g of _groups) {
    if (!_plans.some(p => p.entityId === g.id)) {
      _plans.push({ entityId: g.id, entityType: 'group', parentId: g.cabinet_id || null, name: g.name, ordersQty: 0, avgPrice: 0, ordersSum: 0, profitability: 0, netProfit: 0 });
    }
  }

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

  for (const pr of _products) {
    if (_plans.some(p => p.entityId === pr.id && p.entityType === 'product')) continue;
    const membership = _memberships.find(m => m.product_id === pr.id);
    const parentId = membership ? membership.group_id : pr.cabinet_id || null;
    _plans.push({
      entityId: pr.id, entityType: 'product',
      parentId,
      name: (pr.sku !== pr.name ? pr.sku + ' ' : '') + pr.name,
      ordersQty: 0, avgPrice: 0, ordersSum: 0,
      profitability: 25, netProfit: 0,
    });
  }
}

function seed() {
  _cabinets.push({ id: 'cab-1', name: 'Светпланет' });
  _cabinets.push({ id: 'cab-2', name: 'Ледситипро' });
  _brands.push({ id: 'br-1', name: 'Ledcity' });
  _brands.push({ id: 'br-2', name: 'ЛампаМания' });
  _brands.push({ id: 'br-3', name: 'Свет будущего' });

  _groups.push({ id: 'grp-1', name: 'Лампания_1', cabinet_id: 'cab-1' });
  _groups.push({ id: 'grp-2', name: 'Лепестки_1', cabinet_id: 'cab-1' });
  _groups.push({ id: 'grp-3', name: 'Геометрия_1_Ромбы', cabinet_id: 'cab-1' });
  _groups.push({ id: 'grp-4', name: 'Геометрия_2_дабл_Квадраты', cabinet_id: 'cab-1' });
  _groups.push({ id: 'grp-5', name: 'Геометрия_3_Квадраты', cabinet_id: 'cab-1' });
  _groups.push({ id: 'grp-6', name: 'Скандинавия_1', cabinet_id: 'cab-1' });
  _groups.push({ id: 'grp-7', name: 'Геометрия_4_Круги', cabinet_id: 'cab-1' });
  _groups.push({ id: 'grp-8', name: 'Сетка_1', cabinet_id: 'cab-1' });
  _groups.push({ id: 'grp-9', name: 'Лепестки_2', cabinet_id: 'cab-1' });
  _groups.push({ id: 'grp-10', name: 'Монолиты', cabinet_id: 'cab-1' });
  _groups.push({ id: 'grp-11', name: 'Тарелки', cabinet_id: 'cab-1' });
  _groups.push({ id: 'grp-12', name: 'Цветки', cabinet_id: 'cab-2' });
  _groups.push({ id: 'grp-13', name: 'Слоеные тарелки', cabinet_id: 'cab-2' });
  _groups.push({ id: 'grp-14', name: 'Монолиты_2', cabinet_id: 'cab-2' });
  _groups.push({ id: 'grp-15', name: 'Ромбы_2', cabinet_id: 'cab-2' });
  _groups.push({ id: 'grp-16', name: 'Gx53', cabinet_id: 'cab-2' });
  _groups.push({ id: 'grp-17', name: 'Квадраты_2', cabinet_id: 'cab-2' });
  _groups.push({ id: 'grp-18', name: 'Рожковые', cabinet_id: 'cab-2' });
  _groups.push({ id: UNGROUPED_GROUP_ID, name: 'Без склейки', cabinet_id: '' });

  seedDerivedData();
}

export function getCabinets() { return [..._cabinets]; }
export function getBrands() { return [..._brands]; }
export function getGroups() { return [..._groups]; }
export function getProducts() { return [..._products]; }
export function getMemberships() { return [..._memberships]; }
export function getMetrics() { return [..._metrics]; }
export function getImportLog() { return [..._importLog].reverse(); }

export function deleteImportLogEntry(logId: string) {
  const log = _importLog.find(l => l.id === logId);
  if (!log) return;

  console.log('[store] deleteImportLogEntry:', log.id, log.fileName, log.source);

  // Для старых импортов (без productIds) — удаляем все рекламные метрики
  if (!log.productIds || !log.dataStart) {
    const before = _metrics.length;
    _metrics = _metrics.filter(m => m.ad_spend === 0);
    console.log('[store] deleteImportLogEntry — old import, removed all ad metrics:', before - _metrics.length);
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
    console.log('[store] deleteImportLogEntry — removed metrics:', before - _metrics.length);
  }

  _importLog = _importLog.filter(l => l.id !== logId);
  notify();
}

export function addCabinet(name: string): Cabinet {
  const c: Cabinet = { id: genId('cab'), name };
  _cabinets.push(c); notify(); return c;
}
export function updateCabinet(id: string, name: string) {
  const c = _cabinets.find(x => x.id === id);
  if (c) { c.name = name; notify(); }
}
export function removeCabinet(id: string) {
  _cabinets = _cabinets.filter(x => x.id !== id);
  notify();
}

export function addBrand(name: string): Brand {
  const b: Brand = { id: genId('br'), name };
  _brands.push(b); notify(); return b;
}
export function updateBrand(id: string, name: string) {
  const b = _brands.find(x => x.id === id);
  if (b) { b.name = name; notify(); }
}
export function removeBrand(id: string) {
  _brands = _brands.filter(x => x.id !== id);
  _products.forEach(p => { if (p.brand_id === id) p.brand_id = ''; });
  notify();
}

export function addGroup(name: string, cabinet_id: string): ProductGroup {
  const g: ProductGroup = { id: genId('grp'), name, cabinet_id };
  _groups.push(g); notify(); return g;
}
export function updateGroup(id: string, name: string) {
  const g = _groups.find(x => x.id === id);
  if (g) { g.name = name; notify(); }
}
export function removeGroup(id: string) {
  _groups = _groups.filter(x => x.id !== id);
  _memberships = _memberships.filter(m => m.group_id !== id);
  notify();
}

export function addProduct(sku: string, name: string, brand_id: string, category = ''): Product {
  const p: Product = { id: genId('pr'), sku, wb_sku: sku, name, category, brand_id, cabinet_id: '' };
  _products.push(p); notify(); return p;
}
export function updateProduct(id: string, data: { name?: string; category?: string; sku?: string }) {
  const p = _products.find(x => x.id === id);
  if (p) { Object.assign(p, data); notify(); }
}
export function removeProduct(id: string) {
  _products = _products.filter(x => x.id !== id);
  _memberships = _memberships.filter(m => m.product_id !== id);
  _metrics = _metrics.filter(m => m.product_id !== id);
  notify();
}

export const UNGROUPED_GROUP_ID = 'grp-ungrouped';

export function removeMembership(product_id: string, group_id?: string) {
  if (group_id) {
    _memberships = _memberships.filter(m => !(m.product_id === product_id && m.group_id === group_id));
  } else {
    _memberships = _memberships.filter(m => m.product_id !== product_id);
  }
  notify();
}

let _nextLogId = 1;

export function findOrCreateProduct(sku: string, name?: string): Product {
  let p = _products.find(x => x.sku === sku);
  if (!p) {
    const { brandId, cabinetId, groupIds } = classifySku(sku);
    p = { id: genId('pr'), sku, wb_sku: sku, name: name || sku, category: '', brand_id: brandId, cabinet_id: cabinetId };
    _products.push(p);
    if (groupIds.length > 0) {
      for (const gid of groupIds) {
        _memberships.push({ product_id: p.id, group_id: gid });
      }
    } else {
      // Auto-assign to "Без склейки" if no group matched
      _memberships.push({ product_id: p.id, group_id: UNGROUPED_GROUP_ID });
    }
    notify();
  }
  return p;
}

export function upsertMetrics(date: string, productId: string, patch: Partial<DailyMetrics>) {
  const existing = _metrics.find(m => m.date === date && m.product_id === productId);
  console.log('[store] upsertMetrics:', { date, productId, patch, existing: !!existing });
  if (existing) {
    Object.assign(existing, patch);
  } else {
    const empty: DailyMetrics = {
      date, product_id: productId,
      impressions: 0, clicks: 0, carts: 0, orders: 0, buyouts: 0, cancellations: 0,
      ordered_amount: 0, buyout_amount: 0, cancellation_amount: 0,
      ad_impressions: 0, ad_clicks: 0, ad_orders: 0, ad_spend: 0,
      stock: 0, plan_orders: 0, forecast_profit_per_order: 0, actual_profit: 0, actual_margin: 0,
    };
    _metrics.push({ ...empty, ...patch, date, product_id: productId });
  }
  notify();
}

function toNumber(v: string): number {
  if (!v) return 0;
  const cleaned = v.replace(/[^0-9.,-]/g, '').replace(',', '.');
  const n = parseFloat(cleaned);
  return isNaN(n) ? 0 : n;
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
  actual_profit: 'actual_profit', actual_margin: 'actual_margin',
};

export function detectSourceFromFilename(fileName: string): ImportSource {
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
export function importMappedData(fileName: string, source: ImportSource, rows: Record<string, string>[], dateOverride?: string, cabinetId?: string, cabinetName?: string): ImportFileLog {
  const log: ImportFileLog = {
    id: `log-${_nextLogId++}`, fileName, source, rowCount: 0,
    uploadedAt: new Date().toISOString(), status: 'processing',
    cabinetId, cabinetName,
  };

  _importLog.push(log);
  notify();

  console.log('[import] fileName:', fileName, 'cabinet:', cabinetName);
  console.log('[import] source:', source, 'dateOverride:', dateOverride);
  console.log('[import] first row keys:', rows.length > 0 ? Object.keys(rows[0]) : '(empty)', 'row1:', rows[0]);

  try {
    if (!rows.length) throw new Error('Нет данных для импорта');

    let parsed = 0;
    let minDate = '';
    let maxDate = '';
    const productIds = new Set<string>();
    for (const row of rows) {
      const date = dateOverride || row.date;
      const sku = row.sku;
      const rawAdSpend = row.ad_spend;
      if (!date || !sku) {
        console.log('[import] skip row — missing date or sku:', { date, sku, rowKeys: Object.keys(row) });
        continue;
      }

      const product = findOrCreateProduct(sku);
      if (row.buyout_amount) {
        console.log('[import] buyout found:', { date, sku, buyout: row.buyout_amount, rowKeys: Object.keys(row) });
      }
      const patch: Partial<DailyMetrics> = {};

      for (const [field, metricKey] of Object.entries(METRIC_FIELD_MAP)) {
        if (row[field]) {
          const val = toNumber(row[field]);
          (patch as any)[metricKey] = val;
        }
      }

      console.log('[import] row:', { date, sku, productId: product.id, rawAdSpend, ad_spend: patch.ad_spend, patch });
      upsertMetrics(date, product.id, patch);
      parsed++;

      if (!minDate || date < minDate) minDate = date;
      if (!maxDate || date > maxDate) maxDate = date;
      productIds.add(product.id);
    }

    log.rowCount = parsed;
    log.status = parsed > 0 ? 'success' : 'error';
    log.dataStart = minDate || undefined;
    log.dataEnd = maxDate || undefined;
    log.productIds = productIds.size > 0 ? [...productIds] : undefined;
    if (parsed === 0) log.error = 'Не удалось импортировать ни одной строки';
    console.log('[import] completed:', parsed, 'rows, status:', log.status, 'period:', log.dataStart, '-', log.dataEnd, 'products:', productIds.size);
  } catch (err) {
    log.status = 'error';
    log.error = err instanceof Error ? err.message : 'Неизвестная ошибка';
    console.log('[import] error:', log.error);
  }

  notify();

  return log;
}

/**
 * Legacy CSV import with source detection from filename.
 * Prefer importMappedData for new code.
 */
export function importCSV(fileName: string, text: string): ImportFileLog {
  const source = detectSourceFromFilename(fileName);
  const log: ImportFileLog = {
    id: `log-${_nextLogId++}`, fileName, source, rowCount: 0,
    uploadedAt: new Date().toISOString(), status: 'processing',
  };
  _importLog.push(log);
  notify();
  console.log('[import] legacy path — fileName:', fileName, 'source:', source);

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
    return importMappedData(fileName, source, rows);
  } catch (err) {
    log.status = 'error';
    log.error = err instanceof Error ? err.message : 'Неизвестная ошибка';
    notify();
    return log;
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
  return _plans.map(p => ({ ...p }));
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

  notify();
}

function restoreNextId() {
  const allIds: string[] = [];
  for (const c of _cabinets) allIds.push(c.id);
  for (const b of _brands) allIds.push(b.id);
  for (const g of _groups) allIds.push(g.id);
  for (const p of _products) allIds.push(p.id);
  for (const l of _importLog) allIds.push(l.id);
  let max = 0;
  for (const id of allIds) {
    const parts = id.split('-');
    const num = parseInt(parts[parts.length - 1], 10);
    if (!isNaN(num) && num > max) max = num;
  }
  _nextId = max + 1;

  let maxLog = 0;
  for (const l of _importLog) {
    const parts = l.id.split('-');
    const num = parseInt(parts[parts.length - 1], 10);
    if (!isNaN(num) && num > maxLog) maxLog = num;
  }
  _nextLogId = maxLog + 1;
}

export function getMonthlyPlans(): MonthlyPlanRecord[] {
  return _monthlyPlans.map(p => ({ ...p }));
}

export function upsertMonthlyPlan(rec: MonthlyPlanRecord) {
  const idx = _monthlyPlans.findIndex(p => p.sku === rec.sku && p.month === rec.month);
  if (idx >= 0) {
    _monthlyPlans[idx] = rec;
  } else {
    _monthlyPlans.push(rec);
  }
  notify();
}

export function deleteMonthlyPlan(sku: string, month: string) {
  _monthlyPlans = _monthlyPlans.filter(p => !(p.sku === sku && p.month === month));
  notify();
}

export function getMonthlyPlansForMonth(month: string): MonthlyPlanRecord[] {
  return _monthlyPlans.filter(p => p.month === month).map(p => ({ ...p }));
}

export function updateMonthlyPlanField(sku: string, month: string, field: keyof Omit<MonthlyPlanRecord, 'sku' | 'month'>, value: number) {
  const rec = _monthlyPlans.find(p => p.sku === sku && p.month === month);
  if (!rec) return;
  (rec as any)[field] = value;
  notify();
}

function persistAll() {
  repository.saveAll({
    cabinets: _cabinets,
    brands: _brands,
    groups: _groups,
    products: _products,
    memberships: _memberships,
    metrics: _metrics,
    plans: _plans,
    monthlyPlans: _monthlyPlans,
    importLogs: _importLog,
  });
}

export async function initStore() {
  await repository.initialize();
  _suppressPersist = true;

  const snapshot: DataSnapshot = await repository.loadAll();
  if (snapshot.cabinets.length === 0) {
    seed();
  } else {
    _cabinets = snapshot.cabinets;
    _brands = snapshot.brands;
    _groups = snapshot.groups;
    _products = snapshot.products;
    _memberships = snapshot.memberships;
    _metrics = snapshot.metrics;
    _plans = snapshot.plans;
    _monthlyPlans = snapshot.monthlyPlans;
    _importLog = snapshot.importLogs;
    restoreNextId();
    const xwayMetrics = _metrics.filter(m => m.ad_spend > 0);
    if (xwayMetrics.length > 0) {
      const sumAdSpend = xwayMetrics.reduce((s, m) => s + m.ad_spend, 0);
      const dates = [...new Set(xwayMetrics.map(m => m.date))].sort();
      console.log('[diag] XWAY metrics found:', xwayMetrics.length, 'sumAdSpend:', sumAdSpend, 'dates:', dates, 'sample:', xwayMetrics.slice(0, 2));
    } else {
      console.log('[diag] NO XWAY metrics (ad_spend > 0)');
    }
    console.log('[diag] after SQLite load — cabinets:', _cabinets.length, 'brands:', _brands.length, 'groups:', _groups.length, 'products:', _products.length, 'memberships:', _memberships.length, 'plans:', _plans.length, 'metrics:', _metrics.length);
    seedDerivedData();
    console.log('[diag] after seedDerivedData — products:', _products.length, 'memberships:', _memberships.length, 'plans:', _plans.length);
  }

  _suppressPersist = false;
  _initCalled = true;

  if (snapshot.cabinets.length === 0) {
    console.log('[diag] first run — calling persistAll');
    persistAll();
  } else {
    console.log('[diag] subsequent run — NO persistAll');
  }
}
