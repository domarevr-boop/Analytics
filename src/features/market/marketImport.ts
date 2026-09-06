import { supabase } from '../../lib/supabaseClient';
import { buildMarketStagedRows, MARKET_MAX_FILE_BYTES, splitMarketRows } from './marketImportCore';

const BUCKET = 'v5-import-sources';

export type MarketImportStage = 'hashing' | 'uploading' | 'staging' | 'publishing';

export interface MarketImportProgress {
  stage: MarketImportStage;
  processed: number;
  total: number;
}

export interface MarketImportResult {
  batchId: string;
  status: 'published' | 'failed';
  duplicate: boolean;
  inputRows: number;
  acceptedRows: number;
  rejectedRows: number;
  errorCount: number;
  periodStart: string | null;
  periodEnd: string | null;
  fileName: string;
  importedAt: string;
}

interface ImportOptions {
  sourceRowNumbers?: number[];
  sheetName?: string;
  dateOverride?: string;
  fallbackYear?: number;
  onProgress?: (progress: MarketImportProgress) => void;
}

function resultFromSummary(summary: Record<string, unknown>, duplicate = false): MarketImportResult {
  const status = readString(summary, 'status');
  if (status !== 'published' && status !== 'failed') throw new Error(`V5-партия «Рынка» ещё не завершена: ${status || 'статус неизвестен'}`);
  return {
    batchId: readString(summary, 'batch_id'),
    status,
    duplicate,
    inputRows: readNumber(summary, 'input_rows'),
    acceptedRows: readNumber(summary, 'accepted_rows'),
    rejectedRows: readNumber(summary, 'rejected_rows'),
    errorCount: readNumber(summary, 'error_count'),
    periodStart: readString(summary, 'period_start') || null,
    periodEnd: readString(summary, 'period_end') || null,
    fileName: readString(summary, 'file_name'),
    importedAt: readString(summary, 'imported_at') || new Date().toISOString(),
  };
}

function asObject(value: unknown, context: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${context}: сервер вернул неожиданный ответ`);
  return value as Record<string, unknown>;
}

function readString(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  return typeof value === 'string' ? value : '';
}

function readNumber(record: Record<string, unknown>, key: string): number {
  const value = Number(record[key] ?? 0);
  return Number.isFinite(value) ? value : 0;
}

async function fileSha256(file: File): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

async function sourceObjectExists(objectPath: string): Promise<boolean> {
  const separator = objectPath.lastIndexOf('/');
  const folder = separator >= 0 ? objectPath.slice(0, separator) : '';
  const name = separator >= 0 ? objectPath.slice(separator + 1) : objectPath;
  const { data, error } = await supabase.storage.from(BUCKET).list(folder, { limit: 10, search: name });
  if (error) throw new Error(`Не удалось проверить исходный файл: ${error.message}`);
  return (data || []).some(item => item.name === name);
}

export async function getLatestMarketImport(): Promise<MarketImportResult | null> {
  const { data, error } = await supabase.rpc('v5_market_batch_summary', { p_batch_id: null });
  if (error || !data) return null;
  const summary = asObject(data, 'История импорта «Рынка»');
  const status = readString(summary, 'status');
  if (status !== 'published' && status !== 'failed') return null;
  return resultFromSummary(summary);
}

export async function importMarketToSupabase(
  file: File,
  rows: Record<string, string>[],
  options: ImportOptions = {},
): Promise<MarketImportResult> {
  if (file.size <= 0 || file.size > MARKET_MAX_FILE_BYTES) throw new Error('Файл «Рынок» должен быть не пустым и не больше 10 MiB');
  const extension = file.name.split('.').pop()?.toLocaleLowerCase('en-US');
  if (extension !== 'xlsx' && extension !== 'csv') throw new Error('V5 импорт «Рынка» поддерживает только .xlsx и .csv');

  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError || !userData.user) throw new Error('Для импорта «Рынка» требуется авторизация в V5');

  options.onProgress?.({ stage: 'hashing', processed: 0, total: rows.length });
  const hash = await fileSha256(file);
  const { data: createData, error: createError } = await supabase.rpc('v5_market_create_batch', {
    p_original_filename: file.name,
    p_content_type: file.type || (extension === 'csv' ? 'text/csv' : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'),
    p_size_bytes: file.size,
    p_file_sha256: hash,
  });
  if (createError) throw new Error(`Не удалось создать V5-партию «Рынка»: ${createError.message}`);

  const created = asObject(createData, 'Создание партии');
  const batchId = readString(created, 'batch_id');
  const objectPath = readString(created, 'object_path');
  const existingStatus = readString(created, 'status');
  const duplicate = created.duplicate === true;
  if (!batchId || !objectPath) throw new Error('Создание партии: отсутствует идентификатор или путь исходника');

  if (duplicate && existingStatus === 'published') {
    const { data, error } = await supabase.rpc('v5_market_batch_summary', { p_batch_id: batchId });
    if (error || !data) throw new Error(`Не удалось прочитать существующую V5-партию «Рынка»: ${error?.message || 'пустой ответ'}`);
    return resultFromSummary(asObject(data, 'Существующая партия'), true);
  }

  options.onProgress?.({ stage: 'uploading', processed: 0, total: rows.length });
  const alreadyUploaded = duplicate ? await sourceObjectExists(objectPath) : false;
  if (!alreadyUploaded) {
    const { error: uploadError } = await supabase.storage.from(BUCKET).upload(objectPath, file, {
      contentType: file.type || (extension === 'csv' ? 'text/csv' : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'),
      upsert: false,
    });
    if (uploadError) throw new Error(`Не удалось сохранить исходный файл «Рынка»: ${uploadError.message}`);
  }

  const stagedRows = buildMarketStagedRows(
    rows,
    options.sourceRowNumbers,
    options.sheetName,
    options.dateOverride,
    options.fallbackYear,
  );
  const chunks = splitMarketRows(stagedRows);
  let processed = 0;
  for (const chunk of chunks) {
    const { error } = await supabase.rpc('v5_market_stage_rows', { p_batch_id: batchId, p_rows: chunk });
    if (error) throw new Error(`Не удалось передать строки «Рынка»: ${error.message}`);
    processed += chunk.length;
    options.onProgress?.({ stage: 'staging', processed, total: stagedRows.length });
  }

  options.onProgress?.({ stage: 'publishing', processed: stagedRows.length, total: stagedRows.length });
  const { data: publishData, error: publishError } = await supabase.rpc('v5_market_publish_batch', { p_batch_id: batchId });
  if (publishError) throw new Error(`Не удалось опубликовать V5-партию «Рынка»: ${publishError.message}`);
  const published = asObject(publishData, 'Публикация партии');
  const status = readString(published, 'status');
  if (status !== 'published' && status !== 'failed') throw new Error(`Неизвестный статус V5-партии «Рынка»: ${status || 'пусто'}`);

  return resultFromSummary({
    ...published,
    batch_id: batchId,
    file_name: file.name,
    imported_at: new Date().toISOString(),
  }, duplicate);
}
