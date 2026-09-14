/// <reference lib="webworker" />
import readXlsxFile from 'read-excel-file/web-worker';
import { extractFunnelWorkbook, type FunnelImportSource, type FunnelParsedWorkbook } from './funnelImportCore';

interface Request { id: string; buffer: ArrayBuffer; source: FunnelImportSource }
interface Response { id: string; workbook: FunnelParsedWorkbook | null; error?: string }
const workerScope = self as unknown as DedicatedWorkerGlobalScope;

workerScope.onmessage = async (event: MessageEvent<Request>) => {
  const { id, buffer, source } = event.data;
  try {
    const sheets = await readXlsxFile(buffer);
    const workbook = extractFunnelWorkbook(sheets.map(sheet => ({ name: sheet.sheet, data: sheet.data })), source);
    workerScope.postMessage({ id, workbook } satisfies Response);
  } catch (error) {
    workerScope.postMessage({ id, workbook: null, error: error instanceof Error ? error.message : 'Не удалось прочитать отчёт воронки' } satisfies Response);
  }
};
export {};
