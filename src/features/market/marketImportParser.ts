import type { ParsedFile } from '../../data/parseFile';
import { MARKET_MAX_FILE_BYTES } from './marketImportCore';
import type { MarketParsedCandidate } from './marketImportCore';

export interface ParsedMarketFile extends ParsedFile {
  sourceRowNumbers: number[];
  sheetName: string;
  pipeline: 'v5-market';
}

interface ParseResponse {
  id: string;
  candidate: MarketParsedCandidate | null;
  error?: string;
}

export async function parseMarketFileInWorker(file: File): Promise<ParsedMarketFile | null> {
  const extension = file.name.split('.').pop()?.toLocaleLowerCase('en-US');
  if (extension !== 'xlsx' && extension !== 'csv') return null;
  if (file.size <= 0 || file.size > MARKET_MAX_FILE_BYTES) {
    throw new Error('Файл «Рынок» должен быть не пустым и не больше 10 MiB');
  }
  if (typeof Worker === 'undefined') throw new Error('Браузер не поддерживает безопасный фоновый разбор Excel');

  const worker = new Worker(new URL('./marketImport.worker.ts', import.meta.url), { type: 'module' });
  const id = crypto.randomUUID();
  const buffer = await file.arrayBuffer();

  return new Promise<ParsedMarketFile | null>((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      worker.terminate();
      reject(new Error('Разбор отчёта «Рынок» превысил 60 секунд'));
    }, 60_000);

    worker.onmessage = (event: MessageEvent<ParseResponse>) => {
      if (event.data.id !== id) return;
      window.clearTimeout(timeout);
      worker.terminate();
      if (event.data.error) {
        reject(new Error(event.data.error));
        return;
      }
      const candidate = event.data.candidate;
      if (!candidate) {
        resolve(null);
        return;
      }
      resolve({
        fileName: file.name,
        fileType: extension,
        headers: candidate.headers,
        rawHeaders: candidate.rawHeaders,
        rows: candidate.rows,
        totalRows: candidate.rows.length,
        sourceRowNumbers: candidate.sourceRowNumbers,
        sheetName: candidate.sheetName,
        pipeline: 'v5-market',
      });
    };
    worker.onerror = event => {
      window.clearTimeout(timeout);
      worker.terminate();
      reject(new Error(event.message || 'Ошибка фонового разбора отчёта «Рынок»'));
    };
    worker.postMessage({ id, fileName: file.name, buffer }, [buffer]);
  });
}
