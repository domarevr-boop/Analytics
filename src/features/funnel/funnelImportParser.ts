import { FUNNEL_MAX_FILE_BYTES, type FunnelImportSource, type FunnelParsedWorkbook } from './funnelImportCore';

export interface ParsedFunnelFile extends FunnelParsedWorkbook { fileName: string; pipeline: 'v5-funnel' }
interface Response { id: string; workbook: FunnelParsedWorkbook | null; error?: string }

export async function parseFunnelFileInWorker(file: File, source: FunnelImportSource): Promise<ParsedFunnelFile> {
  if (file.name.split('.').pop()?.toLocaleLowerCase('en-US') !== 'xlsx') throw new Error('Безопасный импорт «Воронки/рекламы» V5 поддерживает только .xlsx');
  if (file.size <= 0 || file.size > FUNNEL_MAX_FILE_BYTES) throw new Error('Файл должен быть не пустым и не больше 25 MiB');
  if (typeof Worker === 'undefined') throw new Error('Браузер не поддерживает безопасный фоновый разбор Excel');
  const worker = new Worker(new URL('./funnelImport.worker.ts', import.meta.url), { type: 'module' });
  const id = crypto.randomUUID(); const buffer = await file.arrayBuffer();
  return new Promise((resolve, reject) => {
    const timeout = window.setTimeout(() => { worker.terminate(); reject(new Error('Разбор отчёта превысил 90 секунд')); }, 90_000);
    worker.onmessage = (event: MessageEvent<Response>) => {
      if (event.data.id !== id) return; window.clearTimeout(timeout); worker.terminate();
      if (event.data.error) return reject(new Error(event.data.error));
      if (!event.data.workbook) return reject(new Error('Файл воронки не распознан'));
      resolve({ ...event.data.workbook, fileName: file.name, pipeline: 'v5-funnel' });
    };
    worker.onerror = event => { window.clearTimeout(timeout); worker.terminate(); reject(new Error(event.message || 'Ошибка фонового разбора воронки')); };
    worker.postMessage({ id, buffer, source }, [buffer]);
  });
}
