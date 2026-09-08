import { supabase } from '../../lib/supabaseClient';
import {
  DIRECTORY_BOOTSTRAP_MAX_FILE_BYTES,
  parseDirectoryBootstrapManifest,
  type DirectoryBootstrapManifest,
} from './directoryBootstrapImportCore';

const BUCKET = 'v5-import-sources';

export const isV5DirectoryBootstrapEnvironment = import.meta.env.VITE_APP_ENV === 'v5-development';
export const isV5DirectoryBootstrapEnabled = isV5DirectoryBootstrapEnvironment
  && import.meta.env.VITE_V5_DIRECTORY_BOOTSTRAP_ENABLED === 'true';

export interface PreparedDirectoryBootstrap {
  file: File;
  fileSha256: string;
  manifest: DirectoryBootstrapManifest;
}

export interface DirectoryBootstrapResult {
  batchId: string;
  status: 'published';
  acceptedRows: number;
  rejectedRows: number;
  duplicate: boolean;
  periodStart: string | null;
  periodEnd: string | null;
}

function asRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label}: сервер вернул неожиданный ответ`);
  return value as Record<string, unknown>;
}

function readString(record: Record<string, unknown>, key: string): string {
  return typeof record[key] === 'string' ? record[key] as string : '';
}

function readNumber(record: Record<string, unknown>, key: string): number {
  const value = Number(record[key]);
  if (!Number.isFinite(value)) throw new Error(`Ответ bootstrap: некорректное поле ${key}`);
  return value;
}

async function sha256(file: File): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
  return [...new Uint8Array(digest)].map(value => value.toString(16).padStart(2, '0')).join('');
}

async function sourceObjectExists(objectPath: string): Promise<boolean> {
  const separator = objectPath.lastIndexOf('/');
  const directory = separator >= 0 ? objectPath.slice(0, separator) : '';
  const fileName = separator >= 0 ? objectPath.slice(separator + 1) : objectPath;
  const { data, error } = await supabase.storage.from(BUCKET).list(directory, { search: fileName, limit: 10 });
  if (error) throw new Error(`Не удалось проверить bootstrap-файл: ${error.message}`);
  return (data || []).some(item => item.name === fileName);
}

export async function prepareDirectoryBootstrap(file: File): Promise<PreparedDirectoryBootstrap> {
  if (!isV5DirectoryBootstrapEnvironment) throw new Error('Bootstrap справочника доступен только в окружении V5');
  if (file.size <= 0 || file.size > DIRECTORY_BOOTSTRAP_MAX_FILE_BYTES) throw new Error('Bootstrap-файл должен быть не пустым и не больше 5 MiB');
  if (!file.name.toLocaleLowerCase('en-US').endsWith('.json')) throw new Error('Выберите JSON-манифест справочника V5');
  const manifest = parseDirectoryBootstrapManifest(await file.text());
  return { file, fileSha256: await sha256(file), manifest };
}

export async function publishDirectoryBootstrap(prepared: PreparedDirectoryBootstrap): Promise<DirectoryBootstrapResult> {
  if (!isV5DirectoryBootstrapEnabled) throw new Error('Постоянная загрузка справочника заблокирована до проверки восстановления V5');
  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError || !userData.user) throw new Error('Для bootstrap справочника требуется авторизация администратора V5');

  const { data: createData, error: createError } = await supabase.rpc('v5_directory_create_batch', {
    p_original_filename: prepared.file.name,
    p_size_bytes: prepared.file.size,
    p_file_sha256: prepared.fileSha256,
    p_source_backup_sha256: prepared.manifest.source.sha256,
  });
  if (createError) throw new Error(`Не удалось создать bootstrap-партию: ${createError.message}`);
  const created = asRecord(createData, 'Создание bootstrap-партии');
  const batchId = readString(created, 'batch_id');
  const objectPath = readString(created, 'object_path');
  const duplicate = created.duplicate === true;
  if (!batchId || !objectPath) throw new Error('Создание bootstrap-партии: отсутствует идентификатор или путь файла');

  const alreadyUploaded = duplicate ? await sourceObjectExists(objectPath) : false;
  if (!alreadyUploaded) {
    const { error } = await supabase.storage.from(BUCKET).upload(objectPath, prepared.file, {
      contentType: 'application/json',
      upsert: false,
    });
    if (error) throw new Error(`Не удалось сохранить bootstrap-манифест: ${error.message}`);
  }

  const { data: publishData, error: publishError } = await supabase.rpc('v5_directory_publish_bootstrap', {
    p_batch_id: batchId,
    p_manifest: prepared.manifest,
  });
  if (publishError) throw new Error(`Не удалось опубликовать справочник V5: ${publishError.message}`);
  const published = asRecord(publishData, 'Публикация bootstrap-партии');
  if (readString(published, 'status') !== 'published') throw new Error('Bootstrap-партия не получила статус published');

  return {
    batchId,
    status: 'published',
    acceptedRows: readNumber(published, 'accepted_rows'),
    rejectedRows: readNumber(published, 'rejected_rows'),
    duplicate: published.duplicate === true || duplicate,
    periodStart: readString(published, 'period_start') || null,
    periodEnd: readString(published, 'period_end') || null,
  };
}
