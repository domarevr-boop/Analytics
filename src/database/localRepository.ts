import type { DataSnapshot, IDataRepository, Cabinet, Brand, ProductGroup, Product, GroupMembership, DailyMetrics, PlanRecord, MonthlyPlanRecord, ProfitabilityRecord, ImportFileLog, SaveResult } from '../types';

const DB_NAME = 'analytics-db';
const DB_VERSION = 1;
const STORES = ['cabinets', 'brands', 'product_groups', 'products', 'group_memberships', 'daily_metrics', 'plans', 'monthly_plans', 'profitability_reports', 'import_logs'] as const;

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const s of STORES) {
        if (!db.objectStoreNames.contains(s)) {
          const store = db.createObjectStore(s);
          if (s === 'daily_metrics') store.createIndex('date', 'date', { unique: false });
          if (s === 'products') store.createIndex('sku', 'sku', { unique: false });
        }
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function getTX(db: IDBDatabase, stores: string[], mode: IDBTransactionMode): IDBTransaction {
  return db.transaction(stores, mode);
}

function getAll<T>(store: IDBObjectStore): Promise<T[]> {
  return new Promise((resolve, reject) => {
    const req = store.getAll();
    req.onsuccess = () => resolve(req.result as T[]);
    req.onerror = () => reject(req.error);
  });
}

function put(store: IDBObjectStore, key: IDBValidKey, value: unknown): Promise<void> {
  return new Promise((resolve, reject) => {
    const req = store.put(value, key);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

function del(store: IDBObjectStore, key: IDBValidKey): Promise<void> {
  return new Promise((resolve, reject) => {
    const req = store.delete(key);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

function getKey(store: string, obj: Record<string, unknown>): IDBValidKey {
  switch (store) {
    case 'daily_metrics': return [obj.date, obj.product_id] as IDBValidKey;
    case 'group_memberships': return [obj.product_id, obj.group_id] as IDBValidKey;
    case 'plans': return [obj.entity_id, obj.entity_type] as IDBValidKey;
    case 'monthly_plans': return [obj.sku, obj.month] as IDBValidKey;
    default: return obj.id as string;
  }
}

function getMetricsKey(date: string, productId: string): IDBValidKey {
  return [date, productId];
}

type DBRecord = Record<string, unknown>;

export class LocalRepository implements IDataRepository {
  readonly name = 'local';
  private db: IDBDatabase | null = null;

  async initialize(): Promise<void> {
    this.db = await openDB();
  }

  async loadAll(): Promise<DataSnapshot> {
    const db = this.db;
    if (!db) throw new Error('LocalRepository not initialized');

    const tx = getTX(db, [...STORES], 'readonly');
    const [
      cabinets, brands, groups, products, memberships, metrics,
      plans, monthlyPlans, profitability, importLogs,
    ] = await Promise.all([
      getAll<Cabinet>(tx.objectStore('cabinets')),
      getAll<Brand>(tx.objectStore('brands')),
      getAll<ProductGroup>(tx.objectStore('product_groups')),
      getAll<Product>(tx.objectStore('products')),
      getAll<GroupMembership>(tx.objectStore('group_memberships')),
      getAll<DailyMetrics>(tx.objectStore('daily_metrics')),
      getAll<PlanRecord>(tx.objectStore('plans')),
      getAll<MonthlyPlanRecord>(tx.objectStore('monthly_plans')),
      getAll<ProfitabilityRecord>(tx.objectStore('profitability_reports')),
      getAll<ImportFileLog>(tx.objectStore('import_logs')),
    ]);

    return { cabinets, brands, groups, products, memberships, metrics, plans, monthlyPlans, profitability, importLogs };
  }

  async saveAll(data: DataSnapshot): Promise<SaveResult> {
    const errors: string[] = [];
    const tables: { store: string; rows: DBRecord[] }[] = [
      { store: 'cabinets', rows: data.cabinets as unknown as DBRecord[] },
      { store: 'brands', rows: data.brands as unknown as DBRecord[] },
      { store: 'product_groups', rows: data.groups as unknown as DBRecord[] },
      { store: 'products', rows: data.products as unknown as DBRecord[] },
      { store: 'group_memberships', rows: data.memberships as unknown as DBRecord[] },
      { store: 'daily_metrics', rows: data.metrics as unknown as DBRecord[] },
      { store: 'plans', rows: data.plans as unknown as DBRecord[] },
      { store: 'monthly_plans', rows: data.monthlyPlans as unknown as DBRecord[] },
      { store: 'profitability_reports', rows: data.profitability as unknown as DBRecord[] },
      { store: 'import_logs', rows: data.importLogs as unknown as DBRecord[] },
    ];

    const db = this.db;
    if (!db) { return { ok: false, errors: ['LocalRepository not initialized'] }; }

    const tx = getTX(db, [...STORES], 'readwrite');
    try {
      for (const { store: name, rows } of tables) {
        const store = tx.objectStore(name);
        for (const row of rows) {
          const key = getKey(name, row);
          await put(store, key, row);
        }
      }
      await new Promise<void>((resolve, reject) => {
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
        tx.commit?.();
      });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      errors.push(msg);
    }

    return { ok: errors.length === 0, errors };
  }

  async clearAll(): Promise<void> {
    const db = this.db;
    if (!db) return;
    const tx = getTX(db, [...STORES], 'readwrite');
    for (const s of STORES) {
      tx.objectStore(s).clear();
    }
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.commit?.();
    });
  }

  async deleteMetrics(opts: { productIds: string[]; dateStart?: string; dateEnd?: string }): Promise<void> {
    const db = this.db;
    if (!db) return;
    const tx = getTX(db, ['daily_metrics'], 'readwrite');
    const store = tx.objectStore('daily_metrics');

    const all = await getAll<DailyMetrics>(store);
    const toDelete = all.filter(m => {
      if (!opts.productIds.includes(m.product_id)) return false;
      if (opts.dateStart && m.date < opts.dateStart) return false;
      if (opts.dateEnd && m.date > opts.dateEnd) return false;
      return true;
    });
    for (const m of toDelete) {
      await del(store, getMetricsKey(m.date, m.product_id));
    }
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.commit?.();
    });
  }

  async deleteImportLog(logId: string): Promise<void> {
    const db = this.db;
    if (!db) return;
    const tx = getTX(db, ['import_logs'], 'readwrite');
    await del(tx.objectStore('import_logs'), logId);
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.commit?.();
    });
  }

  async deleteProfitability(productId: string): Promise<void> {
    const db = this.db;
    if (!db) return;
    const tx = getTX(db, ['profitability_reports'], 'readwrite');
    const store = tx.objectStore('profitability_reports');
    const all = await getAll<DBRecord>(store);
    for (const row of all) {
      if (row.product_id === productId) {
        await del(store, getKey('profitability_reports', row));
      }
    }
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.commit?.();
    });
  }
}
