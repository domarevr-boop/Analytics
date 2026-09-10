import { supabase } from '../../lib/supabaseClient';
import { parseV5DirectoryFilters, type V5DirectoryDimension } from '../directory/directoryDataCore';
import { buildGeographyStagedRows, GEOGRAPHY_MAX_FILE_BYTES, splitGeographyRows } from './geographyImportCore';
import type { GeographyParsedWorkbook } from './geographyImportCore';

const BUCKET = 'v5-import-sources';
const isV5Environment = import.meta.env.VITE_APP_ENV === 'v5-development';
export const isV5GeographyImportEnabled = isV5Environment && import.meta.env.VITE_V5_GEOGRAPHY_IMPORT_ENABLED === 'true';

export type GeographyImportStage = 'hashing' | 'uploading' | 'staging' | 'publishing';
export interface GeographyImportProgress { stage: GeographyImportStage; processed: number; total: number }

export interface GeographyImportResult {
  batchId: string;
  status: 'published' | 'failed';
  duplicate: boolean;
  inputRows: number;
  acceptedRows: number;
  rejectedRows: number;
  errorCount: number;
  canonicalRows: number;
  replacedDuplicateRows: number;
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

function resultFromSummary(summary: Record<string, unknown>, fileName: string, duplicate: boolean): GeographyImportResult {
  const status = readString(summary, 'status');
  if (status !== 'published' && status !== 'failed') throw new Error(`V5-партия «Географии» ещё не завершена: ${status || 'статус неизвестен'}`);
  return {
    batchId: readString(summary, 'batch_id'), status, duplicate,
    inputRows: readNumber(summary, 'input_rows'), acceptedRows: readNumber(summary, 'accepted_rows'),
    rejectedRows: readNumber(summary, 'rejected_rows'), errorCount: readNumber(summary, 'error_count'),
    canonicalRows: readNumber(summary, 'canonical_rows'), replacedDuplicateRows: readNumber(summary, 'replaced_duplicate_rows'),
    periodStart: readString(summary, 'period_start') || null, periodEnd: readString(summary, 'period_end') || null,
    fileName, importedAt: new Date().toISOString(),
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

export async function loadGeographyImportCabinets(): Promise<V5DirectoryDimension[]> {
  if (!isV5GeographyImportEnabled) return [];
  const { data, error } = await supabase.rpc('v5_directory_filters');
  if (error) throw new Error(`Не удалось получить доступные кабинеты V5: ${error.message}`);
  return parseV5DirectoryFilters(data).cabinets;
}

export async function importGeographyToSupabase(
  file: File,
  cabinetId: string,
  workbook: GeographyParsedWorkbook,
  onProgress?: (progress: GeographyImportProgress) => void,
): Promise<GeographyImportResult> {
  if (!isV5GeographyImportEnabled) throw new Error('Серверный импорт «Географии заказов» выключен feature flag');
  if (!cabinetId) throw new Error('Перед импортом выберите кабинет');
  if (file.size <= 0 || file.size > GEOGRAPHY_MAX_FILE_BYTES) throw new Error('Файл «География заказов» должен быть не пустым и не больше 25 MiB');
  if (file.name.split('.').pop()?.toLocaleLowerCase('en-US') !== 'xlsx') throw new Error('V5 импорт «Географии заказов» поддерживает только .xlsx');
  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError || !userData.user) throw new Error('Для импорта «Географии заказов» требуется авторизация в V5');

  onProgress?.({ stage: 'hashing', processed: 0, total: workbook.rows.length });
  const hash = await fileSha256(file);
  const contentType = file.type || 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  const { data: createData, error: createError } = await supabase.rpc('v5_geography_create_batch', {
    p_cabinet_id: cabinetId,
    p_original_filename: file.name,
    p_content_type: contentType,
    p_size_bytes: file.size,
    p_file_sha256: hash,
  });
  if (createError) throw new Error(`Не удалось создать V5-партию «Географии»: ${createError.message}`);
  const created = asObject(createData, 'Создание партии географии');
  const batchId = readString(created, 'batch_id');
  const objectPath = readString(created, 'object_path');
  const existingStatus = readString(created, 'status');
  const duplicate = created.duplicate === true;
  if (!batchId || !objectPath) throw new Error('Создание партии географии: отсутствует идентификатор или путь исходника');
  if (duplicate && existingStatus === 'published') {
    return resultFromSummary({
      batch_id: batchId,
      status: 'published',
      input_rows: workbook.rows.length,
      accepted_rows: workbook.rows.length,
      canonical_rows: workbook.rows.length,
      replaced_duplicate_rows: workbook.replacedDuplicateRows,
      period_start: workbook.dateStart,
      period_end: workbook.dateEnd,
    }, file.name, true);
  }

  onProgress?.({ stage: 'uploading', processed: 0, total: workbook.rows.length });
  const alreadyUploaded = duplicate ? await sourceObjectExists(objectPath) : false;
  if (!alreadyUploaded) {
    const { error: uploadError } = await supabase.storage.from(BUCKET).upload(objectPath, file, { contentType, upsert: false });
    if (uploadError) throw new Error(`Не удалось сохранить исходный файл «Географии»: ${uploadError.message}`);
  }
  const { error: resetError } = await supabase.rpc('v5_geography_reset_staging', { p_batch_id: batchId });
  if (resetError) throw new Error(`Не удалось подготовить партию географии: ${resetError.message}`);

  const stagedRows = buildGeographyStagedRows(workbook);
  let processed = 0;
  for (const chunk of splitGeographyRows(stagedRows)) {
    const { error } = await supabase.rpc('v5_geography_stage_rows', { p_batch_id: batchId, p_rows: chunk });
    if (error) throw new Error(`Не удалось передать строки «Географии»: ${error.message}`);
    processed += chunk.length;
    onProgress?.({ stage: 'staging', processed, total: stagedRows.length });
  }
  onProgress?.({ stage: 'publishing', processed: stagedRows.length, total: stagedRows.length });
  const { data: publishData, error: publishError } = await supabase.rpc('v5_geography_publish_batch', { p_batch_id: batchId });
  if (publishError) throw new Error(`Не удалось опубликовать V5-партию «Географии»: ${publishError.message}`);
  return resultFromSummary({ ...asObject(publishData, 'Публикация географии'), batch_id: batchId }, file.name, duplicate);
}
