export const DIRECTORY_BOOTSTRAP_MAX_FILE_BYTES = 5 * 1024 * 1024;

const SECTION_LIMITS = {
  cabinets: 100,
  brands: 10_000,
  categories: 10_000,
  groups: 100_000,
  products: 100_000,
  aliases: 500_000,
  groupHistory: 1_000_000,
  legacyProductMap: 500_000,
  reviewQueue: 100_000,
} as const;

type BootstrapSection = keyof typeof SECTION_LIMITS;

export interface DirectoryBootstrapManifest {
  schemaVersion: 1;
  source: {
    version: 'v4.0';
    exportedAt: string;
    sizeBytes: number;
    sha256: string;
  };
  summary: {
    sourceProducts: number;
    acceptedProducts: number;
    acceptedAliases: number;
    acceptedGroups: number;
    acceptedHistoryRows: number;
    queuedProductComponents: number;
    [key: string]: unknown;
  };
  cabinets: Record<string, unknown>[];
  brands: Record<string, unknown>[];
  categories: Record<string, unknown>[];
  groups: Record<string, unknown>[];
  products: Record<string, unknown>[];
  aliases: Record<string, unknown>[];
  groupHistory: Record<string, unknown>[];
  legacyProductMap: Record<string, unknown>[];
  reviewQueue: Record<string, unknown>[];
  [key: string]: unknown;
}

function asRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label}: ожидался объект`);
  return value as Record<string, unknown>;
}

function readCount(value: unknown, label: string): number {
  if (!Number.isInteger(value) || (value as number) < 0) throw new Error(`${label}: ожидалось неотрицательное целое число`);
  return value as number;
}

export function parseDirectoryBootstrapManifest(text: string): DirectoryBootstrapManifest {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('Манифест справочника содержит некорректный JSON');
  }
  const root = asRecord(parsed, 'Манифест справочника');
  if (root.schemaVersion !== 1) throw new Error('Поддерживается только schemaVersion 1');

  const source = asRecord(root.source, 'Источник манифеста');
  if (source.version !== 'v4.0') throw new Error('Манифест должен быть подготовлен из backup V4');
  if (typeof source.exportedAt !== 'string' || !source.exportedAt) throw new Error('В манифесте отсутствует дата экспорта V4');
  if (!Number.isInteger(source.sizeBytes) || (source.sizeBytes as number) <= 0) throw new Error('В манифесте отсутствует размер backup V4');
  if (typeof source.sha256 !== 'string' || !/^[0-9a-f]{64}$/u.test(source.sha256)) throw new Error('В манифесте отсутствует корректный SHA-256 backup V4');

  for (const [section, limit] of Object.entries(SECTION_LIMITS) as [BootstrapSection, number][]) {
    const rows = root[section];
    if (!Array.isArray(rows)) throw new Error(`Раздел ${section} должен быть массивом`);
    if (rows.length > limit) throw new Error(`Раздел ${section} превышает лимит ${limit.toLocaleString('ru-RU')} строк`);
    if (rows.some(row => !row || typeof row !== 'object' || Array.isArray(row))) throw new Error(`Раздел ${section} содержит строку неверного формата`);
  }

  const summaryRecord = asRecord(root.summary, 'Сводка манифеста');
  const summary = {
    ...summaryRecord,
    sourceProducts: readCount(summaryRecord.sourceProducts, 'sourceProducts'),
    acceptedProducts: readCount(summaryRecord.acceptedProducts, 'acceptedProducts'),
    acceptedAliases: readCount(summaryRecord.acceptedAliases, 'acceptedAliases'),
    acceptedGroups: readCount(summaryRecord.acceptedGroups, 'acceptedGroups'),
    acceptedHistoryRows: readCount(summaryRecord.acceptedHistoryRows, 'acceptedHistoryRows'),
    queuedProductComponents: readCount(summaryRecord.queuedProductComponents, 'queuedProductComponents'),
  };

  const sectionCounts: [keyof typeof summary, BootstrapSection][] = [
    ['acceptedProducts', 'products'],
    ['acceptedAliases', 'aliases'],
    ['acceptedGroups', 'groups'],
    ['acceptedHistoryRows', 'groupHistory'],
  ];
  for (const [summaryKey, section] of sectionCounts) {
    if (summary[summaryKey] !== (root[section] as unknown[]).length) {
      throw new Error(`Сводка ${String(summaryKey)} не совпадает с разделом ${section}`);
    }
  }

  return {
    ...root,
    schemaVersion: 1,
    source: source as DirectoryBootstrapManifest['source'],
    summary,
  } as DirectoryBootstrapManifest;
}
