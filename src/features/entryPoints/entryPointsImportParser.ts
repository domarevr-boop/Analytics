import { ENTRY_POINTS_MAX_FILE_BYTES } from './entryPointsImportCore';
import type { EntryPointsParsedWorkbook } from './entryPointsImportCore';

export interface ParsedEntryPointsFile extends EntryPointsParsedWorkbook {
  fileName: string;
  pipeline: 'v5-entry-points';
}

interface ParseResponse { id: string; workbook: EntryPointsParsedWorkbook | null; error?: string }

export async function parseEntryPointsFileInWorker(file: File): Promise<ParsedEntryPointsFile> {
  if (file.name.split('.').pop()?.toLocaleLowerCase('en-US') !== 'xlsx') {
    throw new Error('Безопасный импорт «Точек входа» V5 поддерживает только .xlsx; старый .xls необходимо пересохранить в .xlsx.');
  }
  if (file.size <= 0 || file.size > ENTRY_POINTS_MAX_FILE_BYTES) throw new Error('Файл «Точки входа» должен быть не пустым и не больше 25 MiB');
  if (typeof Worker === 'undefined') throw new Error('Браузер не поддерживает безопасный фоновый разбор Excel');

  const worker = new Worker(new URL('./entryPointsImport.worker.ts', import.meta.url), { type: 'module' });
  const id = crypto.randomUUID();
  const buffer = await file.arrayBuffer();
  return new Promise<ParsedEntryPointsFile>((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      worker.terminate();
      reject(new Error('Разбор отчёта «Точки входа» превысил 90 секунд'));
    }, 90_000);
    worker.onmessage = (event: MessageEvent<ParseResponse>) => {
      if (event.data.id !== id) return;
      window.clearTimeout(timeout);
      worker.terminate();
      if (event.data.error) return reject(new Error(event.data.error));
      if (!event.data.workbook) return reject(new Error('Файл не содержит отчёта «Точки входа»'));
      resolve({ ...event.data.workbook, fileName: file.name, pipeline: 'v5-entry-points' });
    };
    worker.onerror = event => {
      window.clearTimeout(timeout);
      worker.terminate();
      reject(new Error(event.message || 'Ошибка фонового разбора отчёта «Точки входа»'));
    };
    worker.postMessage({ id, buffer }, [buffer]);
  });
}
