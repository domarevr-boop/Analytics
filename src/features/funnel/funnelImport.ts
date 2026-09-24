import { supabase } from '../../lib/supabaseClient';
import { parseV5DirectoryFilters, type V5DirectoryDimension } from '../directory/directoryDataCore';
import { buildFunnelStagedRows, FUNNEL_MAX_FILE_BYTES, splitFunnelRows, type FunnelImportSource, type FunnelParsedWorkbook } from './funnelImportCore';

const BUCKET = 'v5-import-sources';
const isV5Environment = import.meta.env.VITE_APP_ENV === 'v5-development';
export const isV5FunnelImportEnabled = isV5Environment && import.meta.env.VITE_V5_FUNNEL_IMPORT_ENABLED === 'true';
export type FunnelImportStage = 'hashing' | 'uploading' | 'staging' | 'publishing';
export interface FunnelImportProgress { stage: FunnelImportStage; processed: number; total: number }
export interface FunnelImportResult { batchId: string; sourceObjectPath: string; source: FunnelImportSource; status: 'published' | 'failed'; duplicate: boolean; inputRows: number; acceptedRows: number; rejectedRows: number; errorCount: number; canonicalRows: number; aggregatedRows: number; productsCreated: number; productsResolved: number; periodStart: string | null; periodEnd: string | null; fileName: string; importedAt: string }

function object(value: unknown, context: string): Record<string, unknown> { if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${context}: сервер вернул неожиданный ответ`); return value as Record<string, unknown>; }
const string = (value: Record<string, unknown>, key: string) => typeof value[key] === 'string' ? value[key] as string : '';
const number = (value: Record<string, unknown>, key: string) => { const parsed = Number(value[key] ?? 0); return Number.isFinite(parsed) ? parsed : 0; };
function result(summary: Record<string, unknown>, fileName: string, source: FunnelImportSource, duplicate: boolean, sourceObjectPath: string): FunnelImportResult {
  const status = string(summary, 'status'); if (status !== 'published' && status !== 'failed') throw new Error(`V5-партия воронки ещё не завершена: ${status || 'статус неизвестен'}`);
  return { batchId: string(summary, 'batch_id'), sourceObjectPath, source, status, duplicate, inputRows: number(summary, 'input_rows'), acceptedRows: number(summary, 'accepted_rows'), rejectedRows: number(summary, 'rejected_rows'), errorCount: number(summary, 'error_count'), canonicalRows: number(summary, 'canonical_rows'), aggregatedRows: number(summary, 'aggregated_rows'), productsCreated: number(summary, 'products_created'), productsResolved: number(summary, 'products_resolved'), periodStart: string(summary, 'period_start') || null, periodEnd: string(summary, 'period_end') || null, fileName, importedAt: new Date().toISOString() };
}
async function hash(file: File) { const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer()); return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join(''); }
export { hash as hashFunnelFile };
async function exists(path: string) { const separator = path.lastIndexOf('/'); const folder = path.slice(0, separator); const name = path.slice(separator + 1); const data = await withRetry('Не удалось проверить исходный файл', () => supabase.storage.from(BUCKET).list(folder, { limit: 10, search: name })); return (data || []).some(item => item.name === name); }
const isTransient = (error: { message?: string; status?: number } | null) => Boolean(error && (/failed to fetch|network|timeout|load failed|fetch failed/i.test(error.message || '') || error.status === 429 || (error.status || 0) >= 500));
async function withRetry<T>(label: string, call: () => PromiseLike<{ data: T; error: { message: string; status?: number } | null }>): Promise<T> {
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const { data, error } = await call();
      if (!error) return data;
      if (!isTransient(error) || attempt === 3) throw new Error(`${label}: ${error.message}. ${isTransient(error) ? 'Связь с сервером прервалась; можно повторить импорт этого же файла.' : ''}`);
    } catch (error) {
      if (!isTransient(error instanceof Error ? error : null) || attempt === 3) throw error;
    }
    await new Promise(resolve => setTimeout(resolve, attempt * 1000));
  }
  throw new Error(`${label}: попытки исчерпаны`);
}

export async function loadFunnelImportCabinets(): Promise<V5DirectoryDimension[]> {
  if (!isV5FunnelImportEnabled) return []; const { data, error } = await supabase.rpc('v5_directory_filters');
  if (error) throw new Error(`Не удалось получить кабинеты V5: ${error.message}`); return parseV5DirectoryFilters(data).cabinets;
}
export async function importFunnelToSupabase(file: File, cabinetId: string, workbook: FunnelParsedWorkbook, onProgress?: (value: FunnelImportProgress) => void, reusableObjectPath?: string, knownFileHash?: string): Promise<FunnelImportResult> {
  if (!isV5FunnelImportEnabled) throw new Error('Серверный импорт «Воронки/рекламы» выключен feature flag');
  if (!cabinetId) throw new Error('Не удалось автоматически определить кабинет по артикулу продавца');
  if (file.size <= 0 || file.size > FUNNEL_MAX_FILE_BYTES || file.name.split('.').pop()?.toLocaleLowerCase('en-US') !== 'xlsx') throw new Error('V5 импорт «Воронки/рекламы» поддерживает .xlsx до 25 MiB');
  const { data: userData, error: userError } = await supabase.auth.getUser(); if (userError || !userData.user) throw new Error('Для импорта требуется авторизация в V5');
  if (!knownFileHash) onProgress?.({ stage: 'hashing', processed: 0, total: workbook.rows.length });
  const fileHash = knownFileHash || await hash(file);
  const contentType = file.type || 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  const createData = await withRetry('Не удалось создать V5-партию', () => supabase.rpc('v5_funnel_create_batch', { p_source_code: workbook.source, p_cabinet_id: cabinetId, p_original_filename: file.name, p_content_type: contentType, p_size_bytes: file.size, p_file_sha256: fileHash }));
  const created = object(createData, 'Создание партии воронки'); const batchId = string(created, 'batch_id'); const objectPath = string(created, 'object_path'); const duplicate = created.duplicate === true; const status = string(created, 'status');
  if (!batchId || !objectPath) throw new Error('Создание партии воронки: отсутствует идентификатор или путь исходника');
  const publishedSummary = { batch_id: batchId, status: 'published', input_rows: workbook.inputRows, accepted_rows: workbook.inputRows, canonical_rows: workbook.rows.length, aggregated_rows: workbook.aggregatedRows, period_start: workbook.dateStart, period_end: workbook.dateEnd };
  if (duplicate && status === 'published') return result(publishedSummary, file.name, workbook.source, true, objectPath);
  onProgress?.({ stage: 'uploading', processed: 0, total: workbook.rows.length });
  if (!(duplicate && await exists(objectPath))) {
    if (reusableObjectPath && reusableObjectPath !== objectPath) {
      try { await withRetry('Не удалось скопировать уже загруженный исходник', () => supabase.storage.from(BUCKET).copy(reusableObjectPath, objectPath)); }
      catch (error) { if (!(await exists(objectPath))) throw error; }
    } else {
      for (let attempt = 1; attempt <= 3; attempt += 1) {
        const uploadError = await supabase.storage.from(BUCKET).upload(objectPath, file, { contentType, upsert: false })
          .then(({ error }) => error, error => error instanceof Error ? error : new Error(String(error)));
        if (!uploadError || await exists(objectPath)) break;
        if (!isTransient(uploadError) || attempt === 3) throw new Error(`Не удалось сохранить исходный файл для кабинета: ${uploadError.message}. Файл остался выбранным; повторите импорт.`);
        await new Promise(resolve => setTimeout(resolve, attempt * 1000));
      }
    }
  }
  await withRetry('Не удалось подготовить партию', () => supabase.rpc('v5_funnel_reset_staging', { p_batch_id: batchId }));
  const rows = buildFunnelStagedRows(workbook); let processed = 0;
  for (const chunk of splitFunnelRows(rows)) { await withRetry(`Не удалось передать строки ${processed + 1}–${processed + chunk.length}`, () => supabase.rpc('v5_funnel_stage_rows', { p_batch_id: batchId, p_rows: chunk })); processed += chunk.length; onProgress?.({ stage: 'staging', processed, total: rows.length }); }
  onProgress?.({ stage: 'publishing', processed: rows.length, total: rows.length }); const { data, error } = await supabase.rpc('v5_funnel_publish_batch', { p_batch_id: batchId });
  if (error) {
    if (isTransient(error)) {
      const { data: checkData, error: checkError } = await supabase.rpc('v5_funnel_create_batch', { p_source_code: workbook.source, p_cabinet_id: cabinetId, p_original_filename: file.name, p_content_type: contentType, p_size_bytes: file.size, p_file_sha256: fileHash });
      if (!checkError && checkData && string(object(checkData, 'Проверка публикации'), 'status') === 'published') return result(publishedSummary, file.name, workbook.source, false, objectPath);
    }
    throw new Error(`Не удалось подтвердить публикацию партии ${batchId}: ${error.message}. Повторите импорт того же файла — уже опубликованная партия не запишется повторно.`);
  }
  return result({ ...object(data, 'Публикация воронки'), batch_id: batchId }, file.name, workbook.source, false, objectPath);
}
