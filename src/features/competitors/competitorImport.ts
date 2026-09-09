import { supabase } from '../../lib/supabaseClient';
import { buildCompetitorStagedRows, COMPETITOR_MAX_FILE_BYTES, splitCompetitorRows } from './competitorImportCore';
import type { CompetitorParsedWorkbook } from './competitorImportCore';

const BUCKET = 'v5-import-sources';
const isV5Environment = import.meta.env.VITE_APP_ENV === 'v5-development';
export const isV5CompetitorImportEnabled = isV5Environment && import.meta.env.VITE_V5_COMPETITORS_IMPORT_ENABLED === 'true';

export type CompetitorImportStage = 'hashing' | 'uploading' | 'staging' | 'publishing';
export interface CompetitorImportProgress { stage: CompetitorImportStage; processed: number; total: number }

export interface CompetitorImportResult {
  batchId: string;
  status: 'published' | 'failed';
  duplicate: boolean;
  inputRows: number;
  acceptedRows: number;
  rejectedRows: number;
  errorCount: number;
  periodStart: string | null;
  periodEnd: string | null;
  sectionCounts: Partial<Record<'funnel' | 'search' | 'stocks' | 'positions', number>>;
  fileName: string;
  importedAt: string;
}

export interface CompetitorImportHistoryRow extends Omit<CompetitorImportResult, 'status' | 'duplicate' | 'sectionCounts' | 'importedAt'> {
  status: 'created' | 'uploaded' | 'validating' | 'published' | 'failed' | 'cancelled';
  createdAt: string;
  publishedAt: string | null;
  errorSummary: string | null;
  attemptCount: number;
  sourceFileRetained: boolean;
  objectPath: string;
}

export interface CompetitorBatchErrorRow {
  errorId: number;
  sheetName: string;
  rowNumber: number | null;
  columnName: string | null;
  errorCode: string;
  message: string;
  rawValue: string | null;
  createdAt: string;
}

export interface CompetitorBatchEventRow {
  eventId: number;
  status: CompetitorImportHistoryRow['status'];
  message: string | null;
  details: Record<string, unknown>;
  createdAt: string;
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

function resultFromSummary(summary: Record<string, unknown>, duplicate = false): CompetitorImportResult {
  const status = readString(summary, 'status');
  if (status !== 'published' && status !== 'failed') throw new Error(`V5-партия «Конкурентов» ещё не завершена: ${status || 'статус неизвестен'}`);
  const sectionCountsValue = summary.section_counts;
  const sectionCounts = sectionCountsValue && typeof sectionCountsValue === 'object' && !Array.isArray(sectionCountsValue)
    ? sectionCountsValue as CompetitorImportResult['sectionCounts']
    : {};
  return {
    batchId: readString(summary, 'batch_id'), status, duplicate,
    inputRows: readNumber(summary, 'input_rows'), acceptedRows: readNumber(summary, 'accepted_rows'),
    rejectedRows: readNumber(summary, 'rejected_rows'), errorCount: readNumber(summary, 'error_count'),
    periodStart: readString(summary, 'period_start') || null, periodEnd: readString(summary, 'period_end') || null,
    sectionCounts, fileName: readString(summary, 'file_name'),
    importedAt: readString(summary, 'imported_at') || new Date().toISOString(),
  };
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

export async function getLatestCompetitorImport(): Promise<CompetitorImportResult | null> {
  const { data, error } = await supabase.rpc('v5_competitor_batch_summary', { p_batch_id: null });
  if (error || !data) return null;
  const summary = asObject(data, 'История импорта «Конкурентов»');
  const status = readString(summary, 'status');
  return status === 'published' || status === 'failed' ? resultFromSummary(summary) : null;
}

export async function getCompetitorImportHistory(limit = 20): Promise<CompetitorImportHistoryRow[]> {
  const safeLimit = Math.max(1, Math.min(50, Math.trunc(limit)));
  const { data, error } = await supabase.rpc('v5_competitor_batch_history', { p_limit: safeLimit });
  if (error) throw error;
  if (!Array.isArray(data)) return [];
  const statuses = new Set<CompetitorImportHistoryRow['status']>(['created', 'uploaded', 'validating', 'published', 'failed', 'cancelled']);
  return data.map(value => {
    const row = asObject(value, 'История партий «Конкурентов»');
    const status = readString(row, 'status') as CompetitorImportHistoryRow['status'];
    if (!statuses.has(status)) throw new Error(`История партий «Конкурентов»: неизвестный статус ${status || 'пусто'}`);
    return {
      batchId: readString(row, 'batch_id'), status, inputRows: readNumber(row, 'input_rows'),
      acceptedRows: readNumber(row, 'accepted_rows'), rejectedRows: readNumber(row, 'rejected_rows'),
      errorCount: readNumber(row, 'error_count'), periodStart: readString(row, 'period_start') || null,
      periodEnd: readString(row, 'period_end') || null, fileName: readString(row, 'file_name'),
      createdAt: readString(row, 'created_at'), publishedAt: readString(row, 'published_at') || null,
      errorSummary: readString(row, 'error_summary') || null, attemptCount: readNumber(row, 'attempt_count'),
      sourceFileRetained: row.source_file_retained === true, objectPath: readString(row, 'object_path'),
    };
  });
}

export async function getCompetitorBatchErrors(batchId: string, limit = 100): Promise<CompetitorBatchErrorRow[]> {
  const { data, error } = await supabase.rpc('v5_competitor_batch_errors', { p_batch_id: batchId, p_limit: Math.max(1, Math.min(200, Math.trunc(limit))) });
  if (error) throw error;
  if (!Array.isArray(data)) return [];
  return data.map(value => {
    const row = asObject(value, 'Ошибки партии «Конкурентов»');
    const rowNumber = Number(row.row_number);
    return {
      errorId: readNumber(row, 'error_id'), sheetName: readString(row, 'sheet_name'),
      rowNumber: Number.isInteger(rowNumber) && rowNumber > 0 ? rowNumber : null,
      columnName: readString(row, 'column_name') || null, errorCode: readString(row, 'error_code'),
      message: readString(row, 'message'), rawValue: readString(row, 'raw_value') || null,
      createdAt: readString(row, 'created_at'),
    };
  });
}

export async function getCompetitorBatchEvents(batchId: string, limit = 100): Promise<CompetitorBatchEventRow[]> {
  const { data, error } = await supabase.rpc('v5_competitor_batch_events', { p_batch_id: batchId, p_limit: Math.max(1, Math.min(200, Math.trunc(limit))) });
  if (error) throw error;
  if (!Array.isArray(data)) return [];
  return data.map(value => {
    const row = asObject(value, 'Этапы партии «Конкурентов»');
    const details = row.details;
    return {
      eventId: readNumber(row, 'event_id'), status: readString(row, 'status') as CompetitorBatchEventRow['status'],
      message: readString(row, 'message') || null,
      details: details && typeof details === 'object' && !Array.isArray(details) ? details as Record<string, unknown> : {},
      createdAt: readString(row, 'created_at'),
    };
  });
}

export async function downloadCompetitorSource(objectPath: string, fileName: string): Promise<void> {
  if (!objectPath) throw new Error('У партии отсутствует путь сохранённого исходника');
  const { data, error } = await supabase.storage.from(BUCKET).download(objectPath);
  if (error) throw new Error(`Не удалось скачать исходный файл «Конкурентов»: ${error.message}`);
  const url = URL.createObjectURL(data);
  const link = document.createElement('a');
  link.href = url;
  link.download = (fileName || 'competitors-source.xlsx').replace(/[\\/:*?"<>|]/gu, '_');
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export async function importCompetitorsToSupabase(
  file: File,
  workbook: CompetitorParsedWorkbook,
  onProgress?: (progress: CompetitorImportProgress) => void,
): Promise<CompetitorImportResult> {
  if (!isV5CompetitorImportEnabled) throw new Error('Серверный импорт «Конкурентов» выключен feature flag');
  if (file.size <= 0 || file.size > COMPETITOR_MAX_FILE_BYTES) throw new Error('Файл «Конкуренты» должен быть не пустым и не больше 25 MiB');
  if (file.name.split('.').pop()?.toLocaleLowerCase('en-US') !== 'xlsx') throw new Error('V5 импорт «Конкурентов» поддерживает только .xlsx');
  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError || !userData.user) throw new Error('Для импорта «Конкурентов» требуется авторизация в V5');

  onProgress?.({ stage: 'hashing', processed: 0, total: workbook.totalRows });
  const hash = await fileSha256(file);
  const contentType = file.type || 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  const { data: createData, error: createError } = await supabase.rpc('v5_competitor_create_batch', {
    p_original_filename: file.name, p_content_type: contentType, p_size_bytes: file.size, p_file_sha256: hash,
  });
  if (createError) throw new Error(`Не удалось создать V5-партию «Конкурентов»: ${createError.message}`);
  const created = asObject(createData, 'Создание партии');
  const batchId = readString(created, 'batch_id');
  const objectPath = readString(created, 'object_path');
  const existingStatus = readString(created, 'status');
  const duplicate = created.duplicate === true;
  if (!batchId || !objectPath) throw new Error('Создание партии: отсутствует идентификатор или путь исходника');
  if (duplicate && existingStatus === 'published') {
    const { data, error } = await supabase.rpc('v5_competitor_batch_summary', { p_batch_id: batchId });
    if (error || !data) throw new Error(`Не удалось прочитать существующую партию: ${error?.message || 'пустой ответ'}`);
    return resultFromSummary(asObject(data, 'Существующая партия'), true);
  }

  onProgress?.({ stage: 'uploading', processed: 0, total: workbook.totalRows });
  const alreadyUploaded = duplicate ? await sourceObjectExists(objectPath) : false;
  if (!alreadyUploaded) {
    const { error: uploadError } = await supabase.storage.from(BUCKET).upload(objectPath, file, { contentType, upsert: false });
    if (uploadError) throw new Error(`Не удалось сохранить исходный файл «Конкурентов»: ${uploadError.message}`);
  }
  const { error: resetError } = await supabase.rpc('v5_competitor_reset_staging', { p_batch_id: batchId });
  if (resetError) throw new Error(`Не удалось подготовить партию к загрузке: ${resetError.message}`);

  const stagedRows = buildCompetitorStagedRows(workbook);
  let processed = 0;
  for (const chunk of splitCompetitorRows(stagedRows)) {
    const { error } = await supabase.rpc('v5_competitor_stage_rows', { p_batch_id: batchId, p_rows: chunk });
    if (error) throw new Error(`Не удалось передать строки «Конкурентов»: ${error.message}`);
    processed += chunk.length;
    onProgress?.({ stage: 'staging', processed, total: stagedRows.length });
  }
  onProgress?.({ stage: 'publishing', processed: stagedRows.length, total: stagedRows.length });
  const { data: publishData, error: publishError } = await supabase.rpc('v5_competitor_publish_batch', { p_batch_id: batchId });
  if (publishError) throw new Error(`Не удалось опубликовать V5-партию «Конкурентов»: ${publishError.message}`);
  return resultFromSummary({ ...asObject(publishData, 'Публикация партии'), batch_id: batchId, file_name: file.name, imported_at: new Date().toISOString() }, duplicate);
}
