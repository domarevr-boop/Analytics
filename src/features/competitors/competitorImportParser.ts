import { COMPETITOR_MAX_FILE_BYTES } from './competitorImportCore';
import type { CompetitorParsedWorkbook } from './competitorImportCore';

export interface ParsedCompetitorFile extends CompetitorParsedWorkbook {
  fileName: string;
  pipeline: 'v5-competitors';
}

interface ParseResponse {
  id: string;
  workbook: CompetitorParsedWorkbook | null;
  error?: string;
}

export async function parseCompetitorFileInWorker(file: File, reportYear?: number): Promise<ParsedCompetitorFile> {
  const extension = file.name.split('.').pop()?.toLocaleLowerCase('en-US');
  if (extension !== 'xlsx') throw new Error('Безопасный импорт «Конкурентов» V5 поддерживает только .xlsx; старый .xls необходимо пересохранить в .xlsx.');
  if (file.size <= 0 || file.size > COMPETITOR_MAX_FILE_BYTES) throw new Error('Файл «Конкуренты» должен быть не пустым и не больше 25 MiB');
  if (typeof Worker === 'undefined') throw new Error('Браузер не поддерживает безопасный фоновый разбор Excel');

  const worker = new Worker(new URL('./competitorImport.worker.ts', import.meta.url), { type: 'module' });
  const id = crypto.randomUUID();
  const buffer = await file.arrayBuffer();
  return new Promise<ParsedCompetitorFile>((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      worker.terminate();
      reject(new Error('Разбор отчёта «Конкуренты» превысил 90 секунд'));
    }, 90_000);
    worker.onmessage = (event: MessageEvent<ParseResponse>) => {
      if (event.data.id !== id) return;
      window.clearTimeout(timeout);
      worker.terminate();
      if (event.data.error) return reject(new Error(event.data.error));
      if (!event.data.workbook) return reject(new Error('Файл не содержит полного четырёхлистового отчёта «Конкуренты»'));
      resolve({ ...event.data.workbook, fileName: file.name, pipeline: 'v5-competitors' });
    };
    worker.onerror = event => {
      window.clearTimeout(timeout);
      worker.terminate();
      reject(new Error(event.message || 'Ошибка фонового разбора отчёта «Конкуренты»'));
    };
    worker.postMessage({ id, buffer, reportYear }, [buffer]);
  });
}
