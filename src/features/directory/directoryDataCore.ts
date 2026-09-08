const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export interface V5DirectoryDimension {
  id: string;
  externalKey: string;
  name: string;
}

export interface V5DirectoryFilters {
  cabinets: V5DirectoryDimension[];
  categories: V5DirectoryDimension[];
  brands: V5DirectoryDimension[];
}

export interface V5DirectoryRow {
  productId: string;
  cabinetId: string;
  cabinetExternalKey: string;
  cabinetName: string;
  productExternalKey: string;
  sellerSku: string | null;
  wbSku: string | null;
  productName: string;
  productStatus: string;
  category: V5DirectoryDimension | null;
  brand: V5DirectoryDimension | null;
  groupKnown: boolean;
  group: V5DirectoryDimension | null;
  isUngrouped: boolean;
  groupEffectiveDate: string | null;
}

export interface V5DirectoryPage {
  totalCount: number;
  rows: V5DirectoryRow[];
}

export interface V5DirectoryPageRequest {
  asOf: string;
  cabinetId?: string | null;
  search?: string | null;
  limit?: number;
  offset?: number;
}

function asRecord(value: unknown, context: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${context}: сервер вернул неожиданный ответ`);
  }
  return value as Record<string, unknown>;
}

function readString(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`V5 «Справочник»: некорректное поле ${field}`);
  return value;
}

function readNullableString(value: unknown, field: string): string | null {
  if (value == null) return null;
  return readString(value, field);
}

function readBoolean(value: unknown, field: string): boolean {
  if (typeof value !== 'boolean') throw new Error(`V5 «Справочник»: некорректное поле ${field}`);
  return value;
}

function readCount(value: unknown, field: string): number {
  const count = typeof value === 'number' ? value : Number(value);
  if (!Number.isSafeInteger(count) || count < 0) throw new Error(`V5 «Справочник»: некорректное поле ${field}`);
  return count;
}

function readDate(value: unknown, field: string): string {
  const date = readString(value, field);
  if (!ISO_DATE.test(date)) throw new Error(`V5 «Справочник»: некорректное поле ${field}`);
  return date;
}

function readDimension(record: Record<string, unknown>, prefix: string): V5DirectoryDimension | null {
  const id = record[`${prefix}_id`];
  const externalKey = record[`${prefix}_external_key`];
  const name = record[`${prefix}_name`];
  if (id == null && externalKey == null && name == null) return null;
  return {
    id: readString(id, `${prefix}_id`),
    externalKey: readString(externalKey, `${prefix}_external_key`),
    name: readString(name, `${prefix}_name`),
  };
}

function parseDimensionList(value: unknown, field: string): V5DirectoryDimension[] {
  if (!Array.isArray(value)) throw new Error(`V5 «Справочник»: некорректное поле ${field}`);
  const seen = new Set<string>();
  return value.map((item, index) => {
    const record = asRecord(item, `${field}, строка ${index + 1}`);
    const dimension = {
      id: readString(record.id, `${field}.id`),
      externalKey: readString(record.external_key, `${field}.external_key`),
      name: readString(record.name, `${field}.name`),
    };
    if (seen.has(dimension.id)) throw new Error(`V5 «Справочник»: повтор ${field}.id`);
    seen.add(dimension.id);
    return dimension;
  });
}

export function assertV5DirectoryPageRequest(request: V5DirectoryPageRequest): Required<V5DirectoryPageRequest> {
  if (!ISO_DATE.test(request.asOf)) throw new Error('V5 «Справочник»: дата среза должна быть в формате YYYY-MM-DD');
  const limit = request.limit ?? 100;
  const offset = request.offset ?? 0;
  const search = request.search?.trim() || null;
  const cabinetId = request.cabinetId?.trim() || null;
  if (!Number.isInteger(limit) || limit < 1 || limit > 500) throw new Error('V5 «Справочник»: размер страницы должен быть от 1 до 500');
  if (!Number.isInteger(offset) || offset < 0 || offset > 100_000) throw new Error('V5 «Справочник»: смещение должно быть от 0 до 100000');
  if (search && search.length > 100) throw new Error('V5 «Справочник»: поиск не должен превышать 100 символов');
  return { asOf: request.asOf, cabinetId, search, limit, offset };
}

export function parseV5DirectorySnapshot(value: unknown): V5DirectoryPage {
  if (!Array.isArray(value)) throw new Error('V5 «Справочник»: сервер вернул неожиданный список товаров');
  if (!value.length) return { totalCount: 0, rows: [] };

  let expectedTotal: number | null = null;
  const rows = value.map((item, index): V5DirectoryRow => {
    const record = asRecord(item, `V5 «Справочник», строка ${index + 1}`);
    const totalCount = readCount(record.total_count, 'total_count');
    if (expectedTotal === null) expectedTotal = totalCount;
    if (totalCount !== expectedTotal) throw new Error('V5 «Справочник»: несогласованное общее количество товаров');

    const groupKnown = readBoolean(record.group_known, 'group_known');
    const group = readDimension(record, 'group');
    const isUngrouped = readBoolean(record.is_ungrouped, 'is_ungrouped');
    const groupEffectiveDate = record.group_effective_date == null ? null : readDate(record.group_effective_date, 'group_effective_date');
    if (groupKnown && (!group || !groupEffectiveDate)) throw new Error('V5 «Справочник»: известная склейка не содержит дату или идентификатор');
    if (!groupKnown && (group || groupEffectiveDate || isUngrouped)) throw new Error('V5 «Справочник»: неизвестная склейка содержит противоречивые данные');

    return {
      productId: readString(record.product_id, 'product_id'),
      cabinetId: readString(record.cabinet_id, 'cabinet_id'),
      cabinetExternalKey: readString(record.cabinet_external_key, 'cabinet_external_key'),
      cabinetName: readString(record.cabinet_name, 'cabinet_name'),
      productExternalKey: readString(record.product_external_key, 'product_external_key'),
      sellerSku: readNullableString(record.seller_sku, 'seller_sku'),
      wbSku: readNullableString(record.wb_sku, 'wb_sku'),
      productName: readString(record.product_name, 'product_name'),
      productStatus: readString(record.product_status, 'product_status'),
      category: readDimension(record, 'category'),
      brand: readDimension(record, 'brand'),
      groupKnown,
      group,
      isUngrouped,
      groupEffectiveDate,
    };
  });

  if ((expectedTotal ?? 0) < rows.length) throw new Error('V5 «Справочник»: размер страницы превышает общее количество товаров');
  return { totalCount: expectedTotal ?? 0, rows };
}

export function parseV5DirectoryFilters(value: unknown): V5DirectoryFilters {
  const record = asRecord(value, 'Фильтры V5 «Справочник»');
  return {
    cabinets: parseDimensionList(record.cabinets, 'cabinets'),
    categories: parseDimensionList(record.categories, 'categories'),
    brands: parseDimensionList(record.brands, 'brands'),
  };
}
