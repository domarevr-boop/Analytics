import type { DataChanges, DataSnapshot, IDataRepository, Cabinet, Brand, ProductGroup, Product, GroupMembership, GroupMembershipHistory, DailyMetrics, PlanRecord, MonthlyPlanRecord, AggregateMonthlyPlanRecord, PlanningSettingsRecord, ProfitabilityRecord, GeographyOrderRecord, GeographyPlanRecord, EntryPointRecord, SearchQueryRecord, NicheDynamicsRecord, MarketDynamicsRecord, CompetitorFunnelRecord, CompetitorSearchRecord, CompetitorStockRecord, CompetitorPositionRecord, ImportFileLog, SaveResult } from '../types';

const DB_NAME = 'analytics-db';
// IndexedDB versions are permanent in a browser profile. Published versions
// must never be reused or decreased; version 11 adds aggregate planning and a
// global source preference without touching existing stores.
const DB_VERSION = 11;
const STORES = ['cabinets', 'brands', 'product_groups', 'products', 'group_memberships', 'group_membership_history', 'daily_metrics', 'plans', 'monthly_plans', 'aggregate_monthly_plans', 'planning_settings', 'profitability_reports', 'geography_orders', 'geography_plans', 'entry_points', 'search_queries', 'niche_dynamics', 'market_dynamics', 'competitor_funnel', 'competitor_search', 'competitor_stocks', 'competitor_positions', 'import_logs'] as const;

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const s of STORES) {
        if (!db.objectStoreNames.contains(s)) {
          const store = db.createObjectStore(s);
          if (s === 'daily_metrics') store.createIndex('date', 'date', { unique: false });
          if (s === 'geography_orders') store.createIndex('date', 'date', { unique: false });
          if (s === 'entry_points') store.createIndex('date', 'date', { unique: false });
          if (s === 'search_queries') store.createIndex('date', 'date', { unique: false });
          if (s === 'niche_dynamics') store.createIndex('date', 'date', { unique: false });
          if (s === 'market_dynamics') store.createIndex('date', 'date', { unique: true });
          if (s.startsWith('competitor_')) store.createIndex('date', 'date', { unique: false });
          if (s === 'products') store.createIndex('sku', 'sku', { unique: false });
          if (s === 'group_membership_history') {
            store.createIndex('date', 'date', { unique: false });
            store.createIndex('product_id', 'product_id', { unique: false });
          }
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
    case 'group_membership_history': return [obj.date, obj.product_id] as IDBValidKey;
    case 'plans': return [obj.entityId, obj.entityType] as IDBValidKey;
    case 'monthly_plans': return [obj.sku, obj.month] as IDBValidKey;
    case 'geography_orders': return [obj.date, obj.product_id, obj.region, obj.area || '', obj.city || ''] as IDBValidKey;
    case 'geography_plans': return obj.month as string;
    case 'entry_points': return [obj.date, obj.product_id, obj.section, obj.entry_point] as IDBValidKey;
    case 'search_queries': return [obj.date, obj.query, obj.category] as IDBValidKey;
    case 'niche_dynamics': return [obj.date, obj.category, obj.subject] as IDBValidKey;
    case 'market_dynamics': return obj.date as string;
    case 'competitor_funnel': return [obj.date, obj.wb_article] as IDBValidKey;
    case 'competitor_search': return [obj.date, obj.wb_article, obj.query] as IDBValidKey;
    case 'competitor_stocks': return [obj.date, obj.wb_article, obj.region || '', obj.warehouse || ''] as IDBValidKey;
    case 'competitor_positions': return [obj.date, obj.wb_article] as IDBValidKey;
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
      cabinets, brands, groups, products, memberships, groupHistory, metrics,
      plans, monthlyPlans, aggregatePlans, planningSettings, profitability, geography, geographyPlans, entryPoints, searchQueries, nicheDynamics, marketDynamics,
      competitorFunnel, competitorSearch, competitorStocks, competitorPositions, importLogs,
    ] = await Promise.all([
      getAll<Cabinet>(tx.objectStore('cabinets')),
      getAll<Brand>(tx.objectStore('brands')),
      getAll<ProductGroup>(tx.objectStore('product_groups')),
      getAll<Product>(tx.objectStore('products')),
      getAll<GroupMembership>(tx.objectStore('group_memberships')),
      getAll<GroupMembershipHistory>(tx.objectStore('group_membership_history')),
      getAll<DailyMetrics>(tx.objectStore('daily_metrics')),
      getAll<PlanRecord>(tx.objectStore('plans')),
      getAll<MonthlyPlanRecord>(tx.objectStore('monthly_plans')),
      getAll<AggregateMonthlyPlanRecord>(tx.objectStore('aggregate_monthly_plans')),
      getAll<PlanningSettingsRecord>(tx.objectStore('planning_settings')),
      getAll<ProfitabilityRecord>(tx.objectStore('profitability_reports')),
      getAll<GeographyOrderRecord>(tx.objectStore('geography_orders')),
      getAll<GeographyPlanRecord>(tx.objectStore('geography_plans')),
      getAll<EntryPointRecord>(tx.objectStore('entry_points')),
      getAll<SearchQueryRecord>(tx.objectStore('search_queries')),
      getAll<NicheDynamicsRecord>(tx.objectStore('niche_dynamics')),
      getAll<MarketDynamicsRecord>(tx.objectStore('market_dynamics')),
      getAll<CompetitorFunnelRecord>(tx.objectStore('competitor_funnel')),
      getAll<CompetitorSearchRecord>(tx.objectStore('competitor_search')),
      getAll<CompetitorStockRecord>(tx.objectStore('competitor_stocks')),
      getAll<CompetitorPositionRecord>(tx.objectStore('competitor_positions')),
      getAll<ImportFileLog>(tx.objectStore('import_logs')),
    ]);

    return { cabinets, brands, groups, products, memberships, groupHistory, metrics, plans, monthlyPlans, aggregatePlans, planningSettings, profitability, geography, geographyPlans, entryPoints, searchQueries, nicheDynamics, marketDynamics, competitorFunnel, competitorSearch, competitorStocks, competitorPositions, importLogs };
  }

  async saveAll(data: DataSnapshot): Promise<SaveResult> {
    const errors: string[] = [];
    const tables: { store: string; rows: DBRecord[] }[] = [
      { store: 'cabinets', rows: data.cabinets as unknown as DBRecord[] },
      { store: 'brands', rows: data.brands as unknown as DBRecord[] },
      { store: 'product_groups', rows: data.groups as unknown as DBRecord[] },
      { store: 'products', rows: data.products as unknown as DBRecord[] },
      { store: 'group_memberships', rows: data.memberships as unknown as DBRecord[] },
      { store: 'group_membership_history', rows: data.groupHistory as unknown as DBRecord[] },
      { store: 'daily_metrics', rows: data.metrics as unknown as DBRecord[] },
      { store: 'plans', rows: data.plans as unknown as DBRecord[] },
      { store: 'monthly_plans', rows: data.monthlyPlans as unknown as DBRecord[] },
      { store: 'aggregate_monthly_plans', rows: data.aggregatePlans as unknown as DBRecord[] },
      { store: 'planning_settings', rows: data.planningSettings as unknown as DBRecord[] },
      { store: 'profitability_reports', rows: data.profitability as unknown as DBRecord[] },
      { store: 'geography_orders', rows: data.geography as unknown as DBRecord[] },
      { store: 'geography_plans', rows: data.geographyPlans as unknown as DBRecord[] },
      { store: 'entry_points', rows: data.entryPoints as unknown as DBRecord[] },
      { store: 'search_queries', rows: data.searchQueries as unknown as DBRecord[] },
      { store: 'niche_dynamics', rows: data.nicheDynamics as unknown as DBRecord[] },
      { store: 'market_dynamics', rows: data.marketDynamics as unknown as DBRecord[] },
      { store: 'competitor_funnel', rows: data.competitorFunnel as unknown as DBRecord[] },
      { store: 'competitor_search', rows: data.competitorSearch as unknown as DBRecord[] },
      { store: 'competitor_stocks', rows: data.competitorStocks as unknown as DBRecord[] },
      { store: 'competitor_positions', rows: data.competitorPositions as unknown as DBRecord[] },
      { store: 'import_logs', rows: data.importLogs as unknown as DBRecord[] },
    ];

    const db = this.db;
    if (!db) { return { ok: false, errors: ['LocalRepository not initialized'] }; }

    try {
      await new Promise<void>((resolve, reject) => {
        const tx = getTX(db, [...STORES], 'readwrite');
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error || new Error('IndexedDB transaction failed'));
        tx.onabort = () => reject(tx.error || new Error('IndexedDB transaction aborted'));
        try {
          for (const { store: name, rows } of tables) {
            const store = tx.objectStore(name);
            for (const row of rows) store.put(row, getKey(name, row));
          }
          tx.commit?.();
        } catch (error) {
          tx.abort();
          reject(error);
        }
      });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      errors.push(msg);
    }

    return { ok: errors.length === 0, errors };
  }

  async saveChanges(data: DataChanges): Promise<SaveResult> {
    const db = this.db;
    if (!db) return { ok: false, errors: ['LocalRepository not initialized'] };

    try {
      const pendingStores: Array<{
        storeName: typeof STORES[number];
        changes: { upserts: DBRecord[]; deletes: IDBValidKey[] };
      }> = [];
      for (const storeName of STORES) {
        const changeName = storeName === 'product_groups' ? 'groups'
          : storeName === 'daily_metrics' ? 'metrics'
          : storeName === 'group_memberships' ? 'memberships'
          : storeName === 'group_membership_history' ? 'groupHistory'
          : storeName === 'monthly_plans' ? 'monthlyPlans'
          : storeName === 'aggregate_monthly_plans' ? 'aggregatePlans'
          : storeName === 'planning_settings' ? 'planningSettings'
          : storeName === 'profitability_reports' ? 'profitability'
          : storeName === 'geography_orders' ? 'geography'
          : storeName === 'geography_plans' ? 'geographyPlans'
          : storeName === 'entry_points' ? 'entryPoints'
          : storeName === 'search_queries' ? 'searchQueries'
          : storeName === 'niche_dynamics' ? 'nicheDynamics'
          : storeName === 'market_dynamics' ? 'marketDynamics'
          : storeName === 'competitor_funnel' ? 'competitorFunnel'
          : storeName === 'competitor_search' ? 'competitorSearch'
          : storeName === 'competitor_stocks' ? 'competitorStocks'
          : storeName === 'competitor_positions' ? 'competitorPositions'
          : storeName === 'import_logs' ? 'importLogs'
          : storeName;
        const changes = data[changeName] as unknown as { upserts: DBRecord[]; deletes: IDBValidKey[] };
        if (changes.upserts.length > 0 || changes.deletes.length > 0) {
          pendingStores.push({ storeName, changes });
        }
      }
      if (pendingStores.length === 0) return { ok: true, errors: [] };

      await new Promise<void>((resolve, reject) => {
        const tx = getTX(db, pendingStores.map(item => item.storeName), 'readwrite');
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error || new Error('IndexedDB transaction failed'));
        tx.onabort = () => reject(tx.error || new Error('IndexedDB transaction aborted'));
        try {
          for (const { storeName, changes } of pendingStores) {
            const store = tx.objectStore(storeName);
            for (const key of changes.deletes) store.delete(key);
            for (const row of changes.upserts) store.put(row, getKey(storeName, row));
          }
          tx.commit?.();
        } catch (error) {
          tx.abort();
          reject(error);
        }
      });
      return { ok: true, errors: [] };
    } catch (error: unknown) {
      return { ok: false, errors: [error instanceof Error ? error.message : String(error)] };
    }
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
