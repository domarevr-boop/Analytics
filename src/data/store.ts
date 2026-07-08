import type { Cabinet, Brand, ProductGroup, Product, GroupMembership, DailyMetrics, ImportFileLog, ImportSource, PlanRecord, MonthlyPlanRecord, ProfitabilityRecord } from '../types';
import { classifySku, getRules } from './rules';
import { loadSeed, createSeedPlans, getUngroupedGroupId } from './seedLoader';
import { repository } from '../database/db';
import type { DataSnapshot } from '../types';
import { normalizeDate } from './dateUtils';

let _version = 0;
const _listeners = new Set<() => void>();
let _initCalled = false;
let _suppressPersist = false;
let _flushPending = false;
const DEV = import.meta.env.DEV;

function flushStore() {
  if (_flushPending) return;
  _flushPending = true;
  setTimeout(() => {
    _flushPending = false;
    persistAll();
  }, 150);
}

function notify() {
  _version++;
  if (DEV) console.log('[notify] _version=' + _version + ' _metrics.length=' + _metrics.length);
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
let _profitability: ProfitabilityRecord[] = [];
let _skuAliases = new Map<string, string>();
let _nextId = 100;

function genId(prefix: string) { return `${prefix}-${crypto.randomUUID().slice(0, 8)}`; }

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

export function getCabinets() { return [..._cabinets]; }
export function getBrands() { return [..._brands]; }
export function getGroups() { return [..._groups]; }
export function getProducts() { return [..._products]; }
export function getMemberships() { return [..._memberships]; }
export function getMetrics() { return [..._metrics]; }
export function getImportLog() { return [..._importLog].reverse(); }

export async function deleteImportLogEntry(logId: string) {
  const log = _importLog.find(l => l.id === logId);
  if (!log) return;

  if (DEV) console.log('[store] deleteImportLogEntry:', log.id, log.fileName, log.source);

  if (log.source === 'profitability') {
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
  notify();

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
  } else if (log.productIds && log.productIds.length > 0) {
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

function buildAliasMap() {
  _skuAliases.clear();
  for (const p of _products) {
    _skuAliases.set(p.sku, p.id);
    if (p.wb_sku && p.wb_sku !== p.sku) _skuAliases.set(p.wb_sku, p.id);
  }
}

function registerAlias(sku: string, productId: string) {
  if (!_skuAliases.has(sku)) _skuAliases.set(sku, productId);
}

function resolveProduct(sku: string, wbSku?: string): Product {
  let p = _products.find(x => x.sku === sku);
  if (p) return p;

  let pid = _skuAliases.get(sku);
  if (pid) { p = _products.find(x => x.id === pid); if (p) return p; }

  if (wbSku) {
    p = _products.find(x => x.wb_sku === wbSku || x.sku === wbSku);
    if (p) return p;
    pid = _skuAliases.get(wbSku);
    if (pid) { p = _products.find(x => x.id === pid); if (p) return p; }
  }

  p = _products.find(x => x.wb_sku === sku);
  if (p) return p;

  p = findOrCreateProduct(sku);
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
   actual_profit: 'actual_profit', actual_margin: 'actual_margin', profit_revenue: 'profit_revenue',
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
const SOURCE_FIELDS: Record<ImportSource, ReadonlySet<keyof DailyMetrics>> = {
  wb_funnel: new Set([
    'impressions', 'clicks', 'carts', 'orders', 'buyouts', 'cancellations',
    'ordered_amount', 'buyout_amount', 'cancellation_amount',
    'stock',
  ]),
  xway: new Set([
    'ad_impressions', 'ad_clicks', 'ad_orders', 'ad_spend',
  ]),
  profitability: new Set([
    'actual_profit', 'actual_margin', 'profit_revenue',
  ]),
  plan_template: new Set([]),
};

export function clearMetricsRange(source: ImportSource, dateFrom: string, dateTo: string): number {
  const fields = SOURCE_FIELDS[source];
  if (!fields || fields.size === 0) return 0;

  const allMetricKeys: (keyof DailyMetrics)[] = [
    'impressions', 'clicks', 'carts', 'orders', 'buyouts', 'cancellations',
    'ordered_amount', 'buyout_amount', 'cancellation_amount',
    'ad_impressions', 'ad_clicks', 'ad_orders', 'ad_spend',
    'stock', 'plan_orders', 'forecast_profit_per_order',
    'actual_profit', 'actual_margin', 'profit_revenue',
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
  if (count > 0) notify();
  return count;
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
  _profitability = [];
  _skuAliases.clear();
  _nextId = 100;
  _nextLogId = 1;
  seed();
  persistAll();
  notify();
}

export async function importMappedData(fileName: string, source: ImportSource, rows: Record<string, string>[], dateOverride?: string): Promise<ImportFileLog> {
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
    _suppressPersist = true;

    let parsed = 0;
    let minDate = '';
    let maxDate = '';
    const productIds = new Set<string>();

    if (source === 'profitability') {
      // Profitability import → write to _profitability, not _metrics
      for (const row of rows) {
        const rawSku = row.sku;
        const rawWbSku = row.wb_sku;
        const sku = rawSku || rawWbSku;
        if (!sku) {
          if (DEV) console.log('[import] skip row — missing sku');
          continue;
        }

        const product = resolveProduct(sku, rawWbSku);
        if (rawSku && rawSku !== product.sku) registerAlias(rawSku, product.id);
        if (rawWbSku && rawWbSku !== product.sku && rawWbSku !== rawSku) registerAlias(rawWbSku, product.id);

        const period_start = normalizeDate(dateOverride || row.date || row.period_start || '');
        if (!period_start) {
          if (DEV) console.log('[import] skip row — missing date/period');
          continue;
        }
        const period_end = normalizeDate(row.period_end || '') || period_start;

        const rec: ProfitabilityRecord = {
          id: genId('prf'),
          product_id: product.id,
          period_start,
          period_end,
          actual_profit: toNumber(row.actual_profit || row.actual_profit),
          actual_margin: toNumber(row.actual_margin || row.actual_margin),
          profit_revenue: toNumber(row.profit_revenue || row.profit_revenue || '0'),
        };
        upsertProfitabilityRecord(rec);
        parsed++;

        if (!minDate || period_start < minDate) minDate = period_start;
        if (!maxDate || period_end > maxDate) maxDate = period_end;
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
      };
      const newPatches: Partial<DailyMetrics>[] = [];

      for (const row of rows) {
        const date = normalizeDate(dateOverride || row.date);
        const rawSku = row.sku;
        const rawWbSku = row.wb_sku;
        const sku = rawSku || rawWbSku;
        if (!date || !sku) {
          if (DEV) console.log('[import] skip row — missing date or sku:', { date, sku, rawSku, rawWbSku, rowKeys: Object.keys(row) });
          continue;
        }

        const product = resolveProduct(sku, rawWbSku);
        if (rawSku && rawSku !== product.sku) registerAlias(rawSku, product.id);
        if (rawWbSku && rawWbSku !== product.sku && rawWbSku !== rawSku) registerAlias(rawWbSku, product.id);

        const patch: Partial<DailyMetrics> = {};
        const allowed = SOURCE_FIELDS[source];
        for (const [field, metricKey] of Object.entries(METRIC_FIELD_MAP)) {
          if (allowed?.has(metricKey) && row[field]) {
            (patch as Record<string, number | undefined>)[metricKey] = toNumber(row[field]);
          }
        }

        newPatches.push({ ...patch, date, product_id: product.id });
        parsed++;

        if (!minDate || date < minDate) minDate = date;
        if (!maxDate || date > maxDate) maxDate = date;
        productIds.add(product.id);
      }

      if (parsed > 0) {
        for (const np of newPatches) {
          const existing = _metrics.find(m => m.date === np.date && m.product_id === np.product_id);
          if (existing) {
            Object.assign(existing, np);
          } else {
            _metrics.push({ ...emptyMetric, ...np });
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
      await repository.saveAll({
        cabinets: _cabinets, brands: _brands, groups: _groups,
        products: _products, memberships: _memberships,
        metrics: _metrics, plans: _plans, monthlyPlans: _monthlyPlans,
        profitability: _profitability,
        importLogs: _importLog,
      });

      _suppressPersist = false;
      notify();
    } else {
      _suppressPersist = false;
    }
  } catch (err) {
    _suppressPersist = false;
    log.status = 'error';
    log.error = err instanceof Error ? err.message : 'Неизвестная ошибка';
    if (DEV) console.log('[import] error:', log.error);
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
  const allIds: string[] = [];
  for (const c of _cabinets) allIds.push(c.id);
  for (const b of _brands) allIds.push(b.id);
  for (const g of _groups) allIds.push(g.id);
  for (const p of _products) allIds.push(p.id);
  for (const r of _profitability) allIds.push(r.id);
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

export function getProfitabilityRecords(): ProfitabilityRecord[] {
  return _profitability.map(r => ({ ...r }));
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

function setProfitabilityAll(records: ProfitabilityRecord[]) {
  _profitability = records;
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
    profitability: _profitability,
    importLogs: _importLog,
  }).catch(e => console.error('[persist] saveAll failed', e));
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
    if (DEV) {
      const dates = _metrics.map(m => m.date).filter(Boolean).sort();
      console.log('[initStore] _metrics assigned: rows=' + _metrics.length + ' dateRange=' + (dates.length ? dates[0] + '..' + dates[dates.length-1] : 'empty'));
    }
    _plans = snapshot.plans;
    _monthlyPlans = snapshot.monthlyPlans;
    _profitability = snapshot.profitability;
    _importLog = snapshot.importLogs;
    restoreNextId();
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
    buildAliasMap();
    if (DEV) console.log('[diag] after seedDerivedData — products:', _products.length, 'memberships:', _memberships.length, 'plans:', _plans.length);
  }

  _suppressPersist = false;
  _initCalled = true;

  if (typeof window !== 'undefined') {
    const doPersist = () => { if (!_suppressPersist) persistAll(); };
    window.addEventListener('beforeunload', doPersist);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') doPersist();
    });
  }

  if (snapshot.cabinets.length === 0) {
    if (DEV) console.log('[diag] first run — calling persistAll');
    persistAll();
  } else {
    if (DEV) console.log('[diag] subsequent run — NO persistAll');
  }
}
