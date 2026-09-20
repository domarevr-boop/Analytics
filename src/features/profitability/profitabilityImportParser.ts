import { PROFITABILITY_MAX_FILE_BYTES, type ProfitabilityParsedWorkbook } from './profitabilityImportCore';

export interface ParsedProfitabilityFile extends ProfitabilityParsedWorkbook { fileName: string; pipeline: 'v5-profitability' }
interface ParseResponse { id: string; workbook: ProfitabilityParsedWorkbook | null; error?: string }

export async function parseProfitabilityFileInWorker(file: File): Promise<ParsedProfitabilityFile> {
  if (file.name.split('.').pop()?.toLocaleLowerCase('en-US') !== 'xlsx') throw new Error('Безопасный импорт «Рентабельности» V5 поддерживает только .xlsx.');
  if (file.size <= 0 || file.size > PROFITABILITY_MAX_FILE_BYTES) throw new Error('Файл «Рентабельность» должен быть не пустым и не больше 25 MiB');
  if (typeof Worker === 'undefined') throw new Error('Браузер не поддерживает безопасный фоновый разбор Excel');
  const worker = new Worker(new URL('./profitabilityImport.worker.ts', import.meta.url), { type: 'module' });
  const id = crypto.randomUUID(); const buffer = await file.arrayBuffer();
  return new Promise((resolve, reject) => {
    const timeout = window.setTimeout(() => { worker.terminate(); reject(new Error('Разбор отчёта «Рентабельность» превысил 90 секунд')); }, 90_000);
    worker.onmessage = (event: MessageEvent<ParseResponse>) => {
      if (event.data.id !== id) return; window.clearTimeout(timeout); worker.terminate();
      if (event.data.error) return reject(new Error(event.data.error));
      if (!event.data.workbook) return reject(new Error('Файл не содержит отчёта «Рентабельность»'));
      resolve({ ...event.data.workbook, fileName: file.name, pipeline: 'v5-profitability' });
    };
    worker.onerror = event => { window.clearTimeout(timeout); worker.terminate(); reject(new Error(event.message || 'Ошибка фонового разбора отчёта «Рентабельность»')); };
    worker.postMessage({ id, buffer }, [buffer]);
  });
}
