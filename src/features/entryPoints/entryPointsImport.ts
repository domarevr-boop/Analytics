import { supabase } from '../../lib/supabaseClient';
import { parseV5DirectoryFilters, type V5DirectoryDimension } from '../directory/directoryDataCore';
import { buildEntryPointsStagedRows, ENTRY_POINTS_MAX_FILE_BYTES, splitEntryPointsRows } from './entryPointsImportCore';
import type { EntryPointsParsedWorkbook } from './entryPointsImportCore';

const BUCKET = 'v5-import-sources';
const isV5Environment = import.meta.env.VITE_APP_ENV === 'v5-development';
export const isV5EntryPointsImportEnabled = isV5Environment && import.meta.env.VITE_V5_ENTRY_POINTS_IMPORT_ENABLED === 'true';

export type EntryPointsImportStage = 'hashing' | 'uploading' | 'staging' | 'publishing';
export interface EntryPointsImportProgress { stage: EntryPointsImportStage; processed: number; total: number }
export interface EntryPointsImportResult {
  batchId: string;
  status: 'published' | 'failed';
  duplicate: boolean;
  inputRows: number;
  acceptedRows: number;
  rejectedRows: number;
  errorCount: number;
  canonicalRows: number;
  replacedDuplicateRows: number;
  productsCreated: number;
  productsResolved: number;
  periodStart: string | null;
  periodEnd: string | null;
  fileName: string;
  importedAt: string;
}

function asObject(value: unknown, context: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${context}: сервер вернул неожиданный ответ`);
  return value as Record<string, unknown>;
}
const readString = (record: Record<string, unknown>, key: string) => typeof record[key] === 'string' ? record[key] as string : '';
const readNumber = (record: Record<string, unknown>, key: string) => {
  const value = Number(record[key] ?? 0);
  return Number.isFinite(value) ? value : 0;
};

function resultFromSummary(summary: Record<string, unknown>, fileName: string, duplicate: boolean): EntryPointsImportResult {
  const status = readString(summary, 'status');
  if (status !== 'published' && status !== 'failed') throw new Error(`V5-партия «Точек входа» ещё не завершена: ${status || 'статус неизвестен'}`);
  return {
    batchId: readString(summary, 'batch_id'), status, duplicate,
    inputRows: readNumber(summary, 'input_rows'), acceptedRows: readNumber(summary, 'accepted_rows'),
    rejectedRows: readNumber(summary, 'rejected_rows'), errorCount: readNumber(summary, 'error_count'),
    canonicalRows: readNumber(summary, 'canonical_rows'), replacedDuplicateRows: readNumber(summary, 'replaced_duplicate_rows'),
    productsCreated: readNumber(summary, 'products_created'), productsResolved: readNumber(summary, 'products_resolved'),
    periodStart: readString(summary, 'period_start') || null, periodEnd: readString(summary, 'period_end') || null,
    fileName, importedAt: new Date().toISOString(),
  };
}

type RequestError = { message: string; status?: number };
function isTransient(error: { message?: string; status?: number } | null): boolean {
  return Boolean(error && (/failed to fetch|network|timeout|load failed|fetch failed/i.test(error.message || '')
    || error.status === 429 || (error.status || 0) >= 500));
}

async function withRetry<T>(label: string, call: () => PromiseLike<{ data: T; error: RequestError | null }>): Promise<T> {
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    let response: { data: T; error: RequestError | null };
    try {
      response = await call();
    } catch (error) {
      if (!isTransient(error instanceof Error ? error : null) || attempt === 3) throw error;
      await new Promise(resolve => setTimeout(resolve, attempt * 1000));
      continue;
    }
    if (!response.error) return response.data;
    if (!isTransient(response.error) || attempt === 3) throw new Error(`${label}: ${response.error.message}`);
    await new Promise(resolve => setTimeout(resolve, attempt * 1000));
  }
  throw new Error(`${label}: попытки исчерпаны`);
}

async function fileSha256(file: File): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

async function sourceObjectExists(objectPath: string): Promise<boolean> {
  const separator = objectPath.lastIndexOf('/');
  const folder = separator >= 0 ? objectPath.slice(0, separator) : '';
  const name = separator >= 0 ? objectPath.slice(separator + 1) : objectPath;
  const data = await withRetry('Не удалось проверить исходный файл', () => supabase.storage.from(BUCKET).list(folder, { limit: 10, search: name }));
  return (data || []).some(item => item.name === name);
}

export async function loadEntryPointsImportCabinets(): Promise<V5DirectoryDimension[]> {
  if (!isV5EntryPointsImportEnabled) return [];
  const { data, error } = await supabase.rpc('v5_directory_filters');
  if (error) throw new Error(`Не удалось получить доступные кабинеты V5: ${error.message}`);
  return parseV5DirectoryFilters(data).cabinets;
}

export async function importEntryPointsToSupabase(
  file: File,
  cabinetId: string,
  workbook: EntryPointsParsedWorkbook,
  onProgress?: (progress: EntryPointsImportProgress) => void,
): Promise<EntryPointsImportResult> {
  if (!isV5EntryPointsImportEnabled) throw new Error('Серверный импорт «Точек входа» выключен feature flag');
  if (!cabinetId) throw new Error('Не удалось автоматически определить кабинет по артикулу продавца');
  if (file.size <= 0 || file.size > ENTRY_POINTS_MAX_FILE_BYTES) throw new Error('Файл «Точки входа» должен быть не пустым и не больше 25 MiB');
  if (file.name.split('.').pop()?.toLocaleLowerCase('en-US') !== 'xlsx') throw new Error('V5 импорт «Точек входа» поддерживает только .xlsx');
  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError || !userData.user) throw new Error('Для импорта «Точек входа» требуется авторизация в V5');

  onProgress?.({ stage: 'hashing', processed: 0, total: workbook.rows.length });
  const hash = await fileSha256(file);
  const contentType = file.type || 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  const createParams = {
    p_cabinet_id: cabinetId, p_original_filename: file.name, p_content_type: contentType, p_size_bytes: file.size, p_file_sha256: hash,
  };
  const createData = await withRetry('Не удалось создать V5-партию «Точек входа»', () => supabase.rpc('v5_entry_points_create_batch', createParams));
  const created = asObject(createData, 'Создание партии точек входа');
  const batchId = readString(created, 'batch_id');
  const objectPath = readString(created, 'object_path');
  const existingStatus = readString(created, 'status');
  const duplicate = created.duplicate === true;
  if (!batchId || !objectPath) throw new Error('Создание партии точек входа: отсутствует идентификатор или путь исходника');
  if (duplicate && existingStatus === 'published') {
    return resultFromSummary({ batch_id: batchId, status: 'published', input_rows: workbook.rows.length,
      accepted_rows: workbook.rows.length, canonical_rows: workbook.rows.length,
      replaced_duplicate_rows: workbook.replacedDuplicateRows, period_start: workbook.dateStart, period_end: workbook.dateEnd }, file.name, true);
  }

  onProgress?.({ stage: 'uploading', processed: 0, total: workbook.rows.length });
  const alreadyUploaded = duplicate ? await sourceObjectExists(objectPath) : false;
  if (!alreadyUploaded) {
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      const uploadError = await supabase.storage.from(BUCKET).upload(objectPath, file, { contentType, upsert: false })
        .then(({ error }) => error, error => error instanceof Error ? error : new Error(String(error)));
      if (!uploadError) break;
      try { if (await sourceObjectExists(objectPath)) break; }
      catch (error) { if (!isTransient(error instanceof Error ? error : null)) throw error; }
      if (!isTransient(uploadError) || attempt === 3) throw new Error(`Не удалось сохранить исходный файл «Точек входа»: ${uploadError.message}. Повторите импорт того же файла.`);
      await new Promise(resolve => setTimeout(resolve, attempt * 1000));
    }
  }
  await withRetry('Не удалось подготовить партию точек входа', () => supabase.rpc('v5_entry_points_reset_staging', { p_batch_id: batchId }));

  const stagedRows = buildEntryPointsStagedRows(workbook);
  let processed = 0;
  for (const chunk of splitEntryPointsRows(stagedRows)) {
    await withRetry(`Не удалось передать строки «Точек входа» ${processed + 1}–${processed + chunk.length}`,
      () => supabase.rpc('v5_entry_points_stage_rows', { p_batch_id: batchId, p_rows: chunk }));
    processed += chunk.length;
    onProgress?.({ stage: 'staging', processed, total: stagedRows.length });
  }
  onProgress?.({ stage: 'publishing', processed: stagedRows.length, total: stagedRows.length });
  const { data: publishData, error: publishError } = await supabase.rpc('v5_entry_points_publish_batch', { p_batch_id: batchId });
  if (publishError) {
    if (isTransient(publishError)) {
      const { data: checkData, error: checkError } = await supabase.rpc('v5_entry_points_create_batch', createParams);
      if (!checkError && checkData && readString(asObject(checkData, 'Проверка публикации'), 'status') === 'published') {
        return resultFromSummary({ batch_id: batchId, status: 'published', input_rows: workbook.rows.length,
          accepted_rows: workbook.rows.length, canonical_rows: workbook.rows.length,
          replaced_duplicate_rows: workbook.replacedDuplicateRows, period_start: workbook.dateStart, period_end: workbook.dateEnd }, file.name, false);
      }
    }
    throw new Error(`Не удалось подтвердить публикацию партии ${batchId}: ${publishError.message}. Повторите импорт того же файла — уже опубликованная партия не запишется повторно.`);
  }
  return resultFromSummary({ ...asObject(publishData, 'Публикация точек входа'), batch_id: batchId }, file.name, duplicate);
}
