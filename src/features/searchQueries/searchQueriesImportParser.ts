import { SEARCH_QUERIES_MAX_FILE_BYTES } from './searchQueriesImportCore';
import type { SearchQueriesParsedWorkbook } from './searchQueriesImportCore';

export interface ParsedSearchQueriesFile extends SearchQueriesParsedWorkbook {
  fileName: string;
  pipeline: 'v5-search-queries';
}

interface ParseResponse { id: string; workbook: SearchQueriesParsedWorkbook | null; error?: string }

export async function parseSearchQueriesFileInWorker(file: File): Promise<ParsedSearchQueriesFile> {
  if (file.name.split('.').pop()?.toLocaleLowerCase('en-US') !== 'xlsx') throw new Error('Безопасный импорт «Поисковых запросов» V5 поддерживает только .xlsx.');
  if (file.size <= 0 || file.size > SEARCH_QUERIES_MAX_FILE_BYTES) throw new Error('Файл «Поисковые запросы» должен быть не пустым и не больше 25 MiB');
  if (typeof Worker === 'undefined') throw new Error('Браузер не поддерживает безопасный фоновый разбор Excel');
  const worker = new Worker(new URL('./searchQueriesImport.worker.ts', import.meta.url), { type: 'module' });
  const id = crypto.randomUUID();
  const buffer = await file.arrayBuffer();
  return new Promise<ParsedSearchQueriesFile>((resolve, reject) => {
    const timeout = window.setTimeout(() => { worker.terminate(); reject(new Error('Разбор отчёта «Поисковые запросы» превысил 90 секунд')); }, 90_000);
    worker.onmessage = (event: MessageEvent<ParseResponse>) => {
      if (event.data.id !== id) return;
      window.clearTimeout(timeout); worker.terminate();
      if (event.data.error) return reject(new Error(event.data.error));
      if (!event.data.workbook) return reject(new Error('Файл не содержит отчёта «Поисковые запросы»'));
      resolve({ ...event.data.workbook, fileName: file.name, pipeline: 'v5-search-queries' });
    };
    worker.onerror = event => { window.clearTimeout(timeout); worker.terminate(); reject(new Error(event.message || 'Ошибка фонового разбора отчёта «Поисковые запросы»')); };
    worker.postMessage({ id, buffer }, [buffer]);
  });
}
