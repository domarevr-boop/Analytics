import type { DataChanges, DataSnapshot, ChangeSet } from '../types';

type StoreName = keyof DataSnapshot;

export const DATA_STORE_NAMES: StoreName[] = [
  'cabinets', 'brands', 'groups', 'products', 'memberships',
  'metrics', 'plans', 'monthlyPlans', 'profitability', 'geography', 'geographyPlans', 'entryPoints', 'searchQueries', 'nicheDynamics',
  'competitorFunnel', 'competitorSearch', 'competitorStocks', 'competitorPositions', 'importLogs',
];

function recordKey(store: StoreName, record: Record<string, unknown>): IDBValidKey {
  switch (store) {
    case 'metrics': return [record.date, record.product_id] as IDBValidKey;
    case 'memberships': return [record.product_id, record.group_id] as IDBValidKey;
    case 'plans': return [record.entityId, record.entityType] as IDBValidKey;
    case 'monthlyPlans': return [record.sku, record.month] as IDBValidKey;
    case 'geography': return [record.date, record.product_id, record.region, record.area || '', record.city || ''] as IDBValidKey;
    case 'geographyPlans': return record.month as string;
    case 'entryPoints': return [record.date, record.product_id, record.section, record.entry_point] as IDBValidKey;
    case 'searchQueries': return [record.date, record.query, record.category] as IDBValidKey;
    case 'nicheDynamics': return [record.date, record.category, record.subject] as IDBValidKey;
    case 'competitorFunnel': return [record.date, record.wb_article] as IDBValidKey;
    case 'competitorSearch': return [record.date, record.wb_article, record.query] as IDBValidKey;
    case 'competitorStocks': return [record.date, record.wb_article, record.region || '', record.warehouse || ''] as IDBValidKey;
    case 'competitorPositions': return [record.date, record.wb_article] as IDBValidKey;
    default: return record.id as string;
  }
}

function mapKey(key: IDBValidKey) {
  return JSON.stringify(key);
}

function compareStore<T extends Record<string, unknown>>(
  store: StoreName,
  previous: T[],
  current: T[],
): ChangeSet<T> {
  const previousByKey = new Map(previous.map(record => {
    const key = recordKey(store, record);
    return [mapKey(key), { key, record }];
  }));
  const currentKeys = new Set<string>();
  const upserts: T[] = [];

  for (const record of current) {
    const key = recordKey(store, record);
    const serializedKey = mapKey(key);
    currentKeys.add(serializedKey);
    const before = previousByKey.get(serializedKey)?.record;
    if (before === record) continue;
    if (!before || JSON.stringify(before) !== JSON.stringify(record)) upserts.push(record);
  }

  const deletes = [...previousByKey.entries()]
    .filter(([key]) => !currentKeys.has(key))
    .map(([, value]) => value.key);

  return { upserts, deletes };
}

export function createDataChanges(
  previous: DataSnapshot,
  current: DataSnapshot,
  selectedStores: Iterable<StoreName> = DATA_STORE_NAMES,
): DataChanges {
  const changes = {} as DataChanges;
  const selected = new Set(selectedStores);
  for (const store of DATA_STORE_NAMES) {
    (changes as unknown as Record<StoreName, ChangeSet<Record<string, unknown>>>)[store] = selected.has(store)
      ? compareStore(
        store,
        previous[store] as unknown as Record<string, unknown>[],
        current[store] as unknown as Record<string, unknown>[],
      )
      : { upserts: [], deletes: [] };
  }
  return changes;
}

export function hasDataChanges(changes: DataChanges) {
  return DATA_STORE_NAMES.some(store => changes[store].upserts.length > 0 || changes[store].deletes.length > 0);
}
