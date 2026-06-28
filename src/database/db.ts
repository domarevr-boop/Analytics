import initSqlJs from 'sql.js';
import type { Database, SqlJsStatic } from 'sql.js';
import type { DataSnapshot, IDataRepository } from '../types';
import { CloudRepository } from './cloudRepository';
import { RepositoryManager } from './repositoryManager';

class LocalRepository implements IDataRepository {
  readonly name = 'local';
  private SQL: SqlJsStatic | null = null;
  private _db: Database | null = null;
  private _saving = false;

  // ── IndexedDB ──────────────────────────────────────

  private _openIdb(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open('MvpStorage', 1);
      req.onupgradeneeded = () => req.result.createObjectStore('app_db');
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  private async _loadFromIdb(): Promise<Uint8Array | null> {
    const idb = await this._openIdb();
    return new Promise(resolve => {
      const tx = idb.transaction('app_db', 'readonly');
      const req = tx.objectStore('app_db').get('app.db');
      req.onsuccess = () => { resolve(req.result || null); idb.close(); };
      req.onerror = () => { resolve(null); idb.close(); };
    });
  }

  private async _saveToIdb(data: Uint8Array): Promise<void> {
    const idb = await this._openIdb();
    return new Promise((resolve, reject) => {
      const tx = idb.transaction('app_db', 'readwrite');
      tx.objectStore('app_db').put(data, 'app.db');
      tx.oncomplete = () => { resolve(); idb.close(); };
      tx.onerror = () => { reject(tx.error); idb.close(); };
    });
  }

  // ── SQLite setup ───────────────────────────────────

  private _createTables() {
    this._db!.run('CREATE TABLE IF NOT EXISTS cabinets (id TEXT PRIMARY KEY, name TEXT NOT NULL)');
    this._db!.run('CREATE TABLE IF NOT EXISTS brands (id TEXT PRIMARY KEY, name TEXT NOT NULL)');
    this._db!.run('CREATE TABLE IF NOT EXISTS product_groups (id TEXT PRIMARY KEY, name TEXT NOT NULL, cabinet_id TEXT NOT NULL)');
    this._db!.run('CREATE TABLE IF NOT EXISTS products (id TEXT PRIMARY KEY, sku TEXT NOT NULL, wb_sku TEXT NOT NULL, name TEXT NOT NULL, category TEXT DEFAULT "", brand_id TEXT NOT NULL, cabinet_id TEXT DEFAULT "")');
    this._db!.run('CREATE TABLE IF NOT EXISTS group_memberships (product_id TEXT NOT NULL, group_id TEXT NOT NULL, PRIMARY KEY (product_id, group_id))');
    this._db!.run(`CREATE TABLE IF NOT EXISTS daily_metrics (
      date TEXT NOT NULL, product_id TEXT NOT NULL,
      impressions INTEGER DEFAULT 0, clicks INTEGER DEFAULT 0, carts INTEGER DEFAULT 0,
      orders INTEGER DEFAULT 0, buyouts INTEGER DEFAULT 0, cancellations INTEGER DEFAULT 0,
      ordered_amount REAL DEFAULT 0, buyout_amount REAL DEFAULT 0, cancellation_amount REAL DEFAULT 0,
      ad_impressions INTEGER DEFAULT 0, ad_clicks INTEGER DEFAULT 0, ad_orders INTEGER DEFAULT 0,
      ad_spend REAL DEFAULT 0, stock REAL DEFAULT 0, plan_orders REAL DEFAULT 0,
      forecast_profit_per_order REAL DEFAULT 0, actual_profit REAL DEFAULT 0, actual_margin REAL DEFAULT 0,
      PRIMARY KEY (date, product_id))`);
    this._db!.run(`CREATE TABLE IF NOT EXISTS plans (
      entity_id TEXT NOT NULL, entity_type TEXT NOT NULL, parent_id TEXT, name TEXT NOT NULL,
      orders_qty REAL DEFAULT 0, avg_price REAL DEFAULT 0, orders_sum REAL DEFAULT 0,
      profitability REAL DEFAULT 0, net_profit REAL DEFAULT 0,
      PRIMARY KEY (entity_id, entity_type))`);
    this._db!.run(`CREATE TABLE IF NOT EXISTS import_logs (
      id TEXT PRIMARY KEY, file_name TEXT NOT NULL, source TEXT NOT NULL,
      row_count INTEGER DEFAULT 0, uploaded_at TEXT NOT NULL, status TEXT NOT NULL,
      error TEXT, cabinet_id TEXT, cabinet_name TEXT, data_start TEXT, data_end TEXT, product_ids TEXT)`);
    this._db!.run(`CREATE TABLE IF NOT EXISTS monthly_plans (
      sku TEXT NOT NULL, month TEXT NOT NULL,
      avg_qty_per_day REAL DEFAULT 0, cost_price REAL DEFAULT 0, check_amount REAL DEFAULT 0,
      net_profit_per_unit REAL DEFAULT 0, total_net_profit REAL DEFAULT 0,
      profitability REAL DEFAULT 0, total_qty REAL DEFAULT 0, total_rubles REAL DEFAULT 0,
      buyout_rate REAL DEFAULT 85,
      PRIMARY KEY (sku, month))`);

    try { this._db!.run("ALTER TABLE import_logs ADD COLUMN cabinet_id TEXT"); } catch {}
    try { this._db!.run("ALTER TABLE import_logs ADD COLUMN cabinet_name TEXT"); } catch {}
    try { this._db!.run("ALTER TABLE import_logs ADD COLUMN data_start TEXT"); } catch {}
    try { this._db!.run("ALTER TABLE import_logs ADD COLUMN data_end TEXT"); } catch {}
    try { this._db!.run("ALTER TABLE import_logs ADD COLUMN product_ids TEXT"); } catch {}
  }

  // ── IDataRepository implementation ─────────────────

  async initialize(): Promise<void> {
    const resp = await fetch(`${import.meta.env.BASE_URL}sql-wasm.wasm`);
    const wasmBinary = await resp.arrayBuffer();
    this.SQL = await initSqlJs({ wasmBinary });
    const saved = await this._loadFromIdb();
    this._db = saved ? new this.SQL.Database(saved) : new this.SQL.Database();
    this._createTables();
  }

  async loadAll(): Promise<DataSnapshot> {
    const db = this._db!;
    return {
      cabinets: (db.exec('SELECT id, name FROM cabinets ORDER BY name')[0]?.values.map((v: any) => ({ id: v[0], name: v[1] })) || []),
      brands: (db.exec('SELECT id, name FROM brands ORDER BY name')[0]?.values.map((v: any) => ({ id: v[0], name: v[1] })) || []),
      groups: (db.exec('SELECT id, name, cabinet_id FROM product_groups ORDER BY name')[0]?.values.map((v: any) => ({ id: v[0], name: v[1], cabinet_id: v[2] })) || []),
      products: (db.exec('SELECT id, sku, wb_sku, name, category, brand_id, cabinet_id FROM products ORDER BY name')[0]?.values.map((v: any) => ({ id: v[0], sku: v[1], wb_sku: v[2], name: v[3], category: v[4], brand_id: v[5], cabinet_id: v[6] })) || []),
      memberships: (db.exec('SELECT product_id, group_id FROM group_memberships')[0]?.values.map((v: any) => ({ product_id: v[0], group_id: v[1] })) || []),
      metrics: (db.exec('SELECT date, product_id, impressions, clicks, carts, orders, buyouts, cancellations, ordered_amount, buyout_amount, cancellation_amount, ad_impressions, ad_clicks, ad_orders, ad_spend, stock, plan_orders, forecast_profit_per_order, actual_profit, actual_margin FROM daily_metrics ORDER BY date')[0]?.values.map((v: any) => ({
        date: v[0], product_id: v[1], impressions: v[2], clicks: v[3], carts: v[4],
        orders: v[5], buyouts: v[6], cancellations: v[7], ordered_amount: v[8],
        buyout_amount: v[9], cancellation_amount: v[10], ad_impressions: v[11],
        ad_clicks: v[12], ad_orders: v[13], ad_spend: v[14], stock: v[15],
        plan_orders: v[16], forecast_profit_per_order: v[17], actual_profit: v[18],
        actual_margin: v[19],
      })) || []),
      plans: (db.exec('SELECT entity_id, entity_type, parent_id, name, orders_qty, avg_price, orders_sum, profitability, net_profit FROM plans')[0]?.values.map((v: any) => ({
        entityId: v[0], entityType: v[1], parentId: v[2], name: v[3],
        ordersQty: v[4], avgPrice: v[5], ordersSum: v[6], profitability: v[7], netProfit: v[8],
      })) || []),
      monthlyPlans: (db.exec('SELECT sku, month, avg_qty_per_day, cost_price, check_amount, net_profit_per_unit, total_net_profit, profitability, total_qty, total_rubles, buyout_rate FROM monthly_plans ORDER BY month, sku')[0]?.values.map((v: any) => ({
        sku: v[0], month: v[1], avgQtyPerDay: v[2], costPrice: v[3], checkAmount: v[4],
        netProfitPerUnit: v[5], totalNetProfit: v[6], profitability: v[7], totalQty: v[8],
        totalRubles: v[9], buyoutRate: v[10],
      })) || []),
      importLogs: (db.exec('SELECT id, file_name, source, row_count, uploaded_at, status, error, cabinet_id, cabinet_name, data_start, data_end, product_ids FROM import_logs ORDER BY uploaded_at DESC')[0]?.values.map((v: any) => ({
        id: v[0], fileName: v[1], source: v[2], rowCount: v[3],
        uploadedAt: v[4], status: v[5], error: v[6] || undefined,
        cabinetId: v[7] || undefined, cabinetName: v[8] || undefined,
        dataStart: v[9] || undefined, dataEnd: v[10] || undefined,
        productIds: v[11] ? JSON.parse(v[11]) : undefined,
      })) || []),
    };
  }

  async saveAll(data: DataSnapshot): Promise<void> {
    if (this._saving) return;
    this._saving = true;
    const db = this._db!;

    const adSum = data.metrics.reduce((s, m) => s + m.ad_spend, 0);
    const adCount = data.metrics.filter(m => m.ad_spend > 0).length;
    console.log('[db] saveAll — ad_spend>0:', adCount, 'sumAdSpend:', adSum, 'metrics:', data.metrics.length);

    db.run('DELETE FROM cabinets');
    if (data.cabinets.length) {
      db.run('BEGIN TRANSACTION');
      const stmt = db.prepare('INSERT INTO cabinets (id, name) VALUES (?, ?)');
      for (const c of data.cabinets) stmt.run([c.id, c.name]);
      stmt.free();
      db.run('COMMIT');
    }

    db.run('DELETE FROM brands');
    if (data.brands.length) {
      db.run('BEGIN TRANSACTION');
      const stmt = db.prepare('INSERT INTO brands (id, name) VALUES (?, ?)');
      for (const b of data.brands) stmt.run([b.id, b.name]);
      stmt.free();
      db.run('COMMIT');
    }

    db.run('DELETE FROM product_groups');
    if (data.groups.length) {
      db.run('BEGIN TRANSACTION');
      const stmt = db.prepare('INSERT INTO product_groups (id, name, cabinet_id) VALUES (?, ?, ?)');
      for (const g of data.groups) stmt.run([g.id, g.name, g.cabinet_id]);
      stmt.free();
      db.run('COMMIT');
    }

    db.run('DELETE FROM products');
    if (data.products.length) {
      db.run('BEGIN TRANSACTION');
      const stmt = db.prepare('INSERT INTO products (id, sku, wb_sku, name, category, brand_id, cabinet_id) VALUES (?, ?, ?, ?, ?, ?, ?)');
      for (const p of data.products) stmt.run([p.id, p.sku, p.wb_sku, p.name, p.category, p.brand_id, p.cabinet_id]);
      stmt.free();
      db.run('COMMIT');
    }

    db.run('DELETE FROM group_memberships');
    if (data.memberships.length) {
      db.run('BEGIN TRANSACTION');
      const stmt = db.prepare('INSERT INTO group_memberships (product_id, group_id) VALUES (?, ?)');
      for (const m of data.memberships) stmt.run([m.product_id, m.group_id]);
      stmt.free();
      db.run('COMMIT');
    }

    db.run('DELETE FROM daily_metrics');
    if (data.metrics.length) {
      db.run('BEGIN TRANSACTION');
      const stmt = db.prepare(`INSERT INTO daily_metrics (date, product_id, impressions, clicks, carts, orders, buyouts, cancellations, ordered_amount, buyout_amount, cancellation_amount, ad_impressions, ad_clicks, ad_orders, ad_spend, stock, plan_orders, forecast_profit_per_order, actual_profit, actual_margin) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
      for (const m of data.metrics) stmt.run([m.date, m.product_id, m.impressions, m.clicks, m.carts, m.orders, m.buyouts, m.cancellations, m.ordered_amount, m.buyout_amount, m.cancellation_amount, m.ad_impressions, m.ad_clicks, m.ad_orders, m.ad_spend, m.stock, m.plan_orders, m.forecast_profit_per_order, m.actual_profit, m.actual_margin]);
      stmt.free();
      db.run('COMMIT');
    }

    db.run('DELETE FROM plans');
    if (data.plans.length) {
      db.run('BEGIN TRANSACTION');
      const stmt = db.prepare('INSERT INTO plans (entity_id, entity_type, parent_id, name, orders_qty, avg_price, orders_sum, profitability, net_profit) VALUES (?,?,?,?,?,?,?,?,?)');
      for (const p of data.plans) stmt.run([p.entityId, p.entityType, p.parentId, p.name, p.ordersQty, p.avgPrice, p.ordersSum, p.profitability, p.netProfit]);
      stmt.free();
      db.run('COMMIT');
    }

    db.run('DELETE FROM monthly_plans');
    if (data.monthlyPlans.length) {
      db.run('BEGIN TRANSACTION');
      const stmt = db.prepare('INSERT INTO monthly_plans (sku, month, avg_qty_per_day, cost_price, check_amount, net_profit_per_unit, total_net_profit, profitability, total_qty, total_rubles, buyout_rate) VALUES (?,?,?,?,?,?,?,?,?,?,?)');
      for (const p of data.monthlyPlans) stmt.run([p.sku, p.month, p.avgQtyPerDay, p.costPrice, p.checkAmount, p.netProfitPerUnit, p.totalNetProfit, p.profitability, p.totalQty, p.totalRubles, p.buyoutRate]);
      stmt.free();
      db.run('COMMIT');
    }

    if (data.importLogs.length) {
      db.run('BEGIN TRANSACTION');
      db.exec('DELETE FROM import_logs');
      const stmt = db.prepare('INSERT INTO import_logs (id, file_name, source, row_count, uploaded_at, status, error, cabinet_id, cabinet_name, data_start, data_end, product_ids) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)');
      for (const l of data.importLogs) stmt.run([l.id, l.fileName, l.source, l.rowCount, l.uploadedAt, l.status, l.error || null, l.cabinetId || null, l.cabinetName || null, l.dataStart || null, l.dataEnd || null, l.productIds ? JSON.stringify(l.productIds) : null]);
      stmt.free();
      db.run('COMMIT');
    } else {
      db.run('DELETE FROM import_logs');
    }

    const prodC = db.exec("SELECT COUNT(*) FROM products")[0]?.values[0][0] || 0;
    const memC = db.exec("SELECT COUNT(*) FROM group_memberships")[0]?.values[0][0] || 0;
    const planC = db.exec("SELECT COUNT(*) FROM plans")[0]?.values[0][0] || 0;
    const metC = db.exec("SELECT COUNT(*) FROM daily_metrics")[0]?.values[0][0] || 0;
    console.log('[db] SQLite after write — products:', prodC, 'memberships:', memC, 'plans:', planC, 'metrics:', metC);

    try {
      const exported = db.export();
      await this._saveToIdb(exported);
    } finally {
      this._saving = false;
    }
  }
}

export const repository: IDataRepository = new RepositoryManager(
  new LocalRepository(),
  new CloudRepository(),
);
export { LocalRepository, CloudRepository, RepositoryManager };

export function getSyncStatus() {
  return (repository as RepositoryManager).getStatus();
}
export type { RepoStatus } from './repositoryManager';
