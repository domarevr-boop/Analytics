import { GEOGRAPHY_MAX_FILE_BYTES } from './geographyImportCore';
import type { GeographyParsedWorkbook } from './geographyImportCore';

export interface ParsedGeographyFile extends GeographyParsedWorkbook {
  fileName: string;
  pipeline: 'v5-geography';
}

interface ParseResponse { id: string; workbook: GeographyParsedWorkbook | null; error?: string }

export async function parseGeographyFileInWorker(file: File): Promise<ParsedGeographyFile> {
  if (file.name.split('.').pop()?.toLocaleLowerCase('en-US') !== 'xlsx') {
    throw new Error('Безопасный импорт «Географии заказов» V5 поддерживает только .xlsx; старый .xls необходимо пересохранить в .xlsx.');
  }
  if (file.size <= 0 || file.size > GEOGRAPHY_MAX_FILE_BYTES) throw new Error('Файл «География заказов» должен быть не пустым и не больше 25 MiB');
  if (typeof Worker === 'undefined') throw new Error('Браузер не поддерживает безопасный фоновый разбор Excel');

  const worker = new Worker(new URL('./geographyImport.worker.ts', import.meta.url), { type: 'module' });
  const id = crypto.randomUUID();
  const buffer = await file.arrayBuffer();
  return new Promise<ParsedGeographyFile>((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      worker.terminate();
      reject(new Error('Разбор отчёта «География заказов» превысил 90 секунд'));
    }, 90_000);
    worker.onmessage = (event: MessageEvent<ParseResponse>) => {
      if (event.data.id !== id) return;
      window.clearTimeout(timeout);
      worker.terminate();
      if (event.data.error) return reject(new Error(event.data.error));
      if (!event.data.workbook) return reject(new Error('Файл не содержит отчёта «География заказов»'));
      resolve({ ...event.data.workbook, fileName: file.name, pipeline: 'v5-geography' });
    };
    worker.onerror = event => {
      window.clearTimeout(timeout);
      worker.terminate();
      reject(new Error(event.message || 'Ошибка фонового разбора отчёта «География заказов»'));
    };
    worker.postMessage({ id, buffer }, [buffer]);
  });
}
