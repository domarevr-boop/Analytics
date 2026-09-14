import { supabase } from '../../lib/supabaseClient';
import { buildSearchQueriesStagedRows, SEARCH_QUERIES_MAX_FILE_BYTES, splitSearchQueriesRows } from './searchQueriesImportCore';
import type { SearchQueriesParsedWorkbook } from './searchQueriesImportCore';

const BUCKET = 'v5-import-sources';
const isV5Environment = import.meta.env.VITE_APP_ENV === 'v5-development';
export const isV5SearchQueriesImportEnabled = isV5Environment && import.meta.env.VITE_V5_SEARCH_QUERIES_IMPORT_ENABLED === 'true';
export type SearchQueriesImportStage = 'hashing' | 'uploading' | 'staging' | 'publishing';
export interface SearchQueriesImportProgress { stage: SearchQueriesImportStage; processed: number; total: number }
export interface SearchQueriesImportResult {
  batchId: string; status: 'published' | 'failed'; duplicate: boolean; inputRows: number; acceptedRows: number;
  rejectedRows: number; errorCount: number; canonicalRows: number; replacedDuplicateRows: number;
  periodStart: string | null; periodEnd: string | null; fileName: string; importedAt: string;
}
function object(value: unknown, context: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${context}: сервер вернул неожиданный ответ`);
  return value as Record<string, unknown>;
}
const string = (row: Record<string, unknown>, key: string) => typeof row[key] === 'string' ? row[key] as string : '';
const number = (row: Record<string, unknown>, key: string) => Number.isFinite(Number(row[key])) ? Number(row[key]) : 0;
function result(row: Record<string, unknown>, fileName: string, duplicate: boolean): SearchQueriesImportResult {
  const status = string(row, 'status');
  if (status !== 'published' && status !== 'failed') throw new Error(`V5-партия «Поисковых запросов» ещё не завершена: ${status || 'статус неизвестен'}`);
  return { batchId: string(row, 'batch_id'), status, duplicate, inputRows: number(row, 'input_rows'), acceptedRows: number(row, 'accepted_rows'),
    rejectedRows: number(row, 'rejected_rows'), errorCount: number(row, 'error_count'), canonicalRows: number(row, 'canonical_rows'),
    replacedDuplicateRows: number(row, 'replaced_duplicate_rows'), periodStart: string(row, 'period_start') || null,
    periodEnd: string(row, 'period_end') || null, fileName, importedAt: new Date().toISOString() };
}
async function sha256(file: File): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}
async function sourceExists(objectPath: string): Promise<boolean> {
  const index = objectPath.lastIndexOf('/'); const folder = objectPath.slice(0, index); const name = objectPath.slice(index + 1);
  const { data, error } = await supabase.storage.from(BUCKET).list(folder, { limit: 10, search: name });
  if (error) throw new Error(`Не удалось проверить исходный файл: ${error.message}`);
  return (data || []).some(item => item.name === name);
}
export async function importSearchQueriesToSupabase(file: File, workbook: SearchQueriesParsedWorkbook, onProgress?: (value: SearchQueriesImportProgress) => void): Promise<SearchQueriesImportResult> {
  if (!isV5SearchQueriesImportEnabled) throw new Error('Серверный импорт «Поисковых запросов» выключен feature flag');
  if (file.size <= 0 || file.size > SEARCH_QUERIES_MAX_FILE_BYTES) throw new Error('Файл «Поисковые запросы» должен быть не пустым и не больше 25 MiB');
  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError || !userData.user) throw new Error('Для импорта «Поисковых запросов» требуется авторизация в V5');
  onProgress?.({ stage: 'hashing', processed: 0, total: workbook.rows.length });
  const hash = await sha256(file);
  const { data: createData, error: createError } = await supabase.rpc('v5_search_queries_create_batch', {
    p_original_filename: file.name, p_content_type: file.type || 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', p_size_bytes: file.size, p_file_sha256: hash,
  });
  if (createError) throw new Error(`Не удалось создать V5-партию «Поисковых запросов»: ${createError.message}`);
  const created = object(createData, 'Создание партии поисковых запросов');
  const batchId = string(created, 'batch_id'); const objectPath = string(created, 'object_path'); const duplicate = created.duplicate === true;
  if (!batchId || !objectPath) throw new Error('Создание партии поисковых запросов: отсутствует идентификатор или путь исходника');
  if (duplicate && string(created, 'status') === 'published') return result({ batch_id: batchId, status: 'published', input_rows: workbook.inputRows,
    accepted_rows: workbook.inputRows, canonical_rows: workbook.rows.length, replaced_duplicate_rows: workbook.replacedDuplicateRows,
    period_start: workbook.dateStart, period_end: workbook.dateEnd }, file.name, true);
  onProgress?.({ stage: 'uploading', processed: 0, total: workbook.rows.length });
  if (!(duplicate && await sourceExists(objectPath))) {
    const { error } = await supabase.storage.from(BUCKET).upload(objectPath, file, { contentType: file.type || 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', upsert: false });
    if (error) throw new Error(`Не удалось сохранить исходный файл «Поисковых запросов»: ${error.message}`);
  }
  const { error: resetError } = await supabase.rpc('v5_search_queries_reset_staging', { p_batch_id: batchId });
  if (resetError) throw new Error(`Не удалось подготовить партию поисковых запросов: ${resetError.message}`);
  const staged = buildSearchQueriesStagedRows(workbook); let processed = 0;
  for (const chunk of splitSearchQueriesRows(staged)) {
    const { error } = await supabase.rpc('v5_search_queries_stage_rows', { p_batch_id: batchId, p_rows: chunk });
    if (error) throw new Error(`Не удалось передать строки «Поисковых запросов»: ${error.message}`);
    processed += chunk.length; onProgress?.({ stage: 'staging', processed, total: staged.length });
  }
  onProgress?.({ stage: 'publishing', processed: staged.length, total: staged.length });
  const { data: publishData, error: publishError } = await supabase.rpc('v5_search_queries_publish_batch', { p_batch_id: batchId });
  if (publishError) throw new Error(`Не удалось опубликовать V5-партию «Поисковых запросов»: ${publishError.message}`);
  return result({ ...object(publishData, 'Публикация поисковых запросов'), batch_id: batchId }, file.name, duplicate);
}
