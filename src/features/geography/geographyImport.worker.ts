/// <reference lib="webworker" />

import readXlsxFile from 'read-excel-file/web-worker';
import { extractGeographyWorkbook } from './geographyImportCore';
import type { GeographyParsedWorkbook } from './geographyImportCore';

interface ParseRequest { id: string; buffer: ArrayBuffer }
interface ParseResponse { id: string; workbook: GeographyParsedWorkbook | null; error?: string }

const workerScope = self as unknown as DedicatedWorkerGlobalScope;

workerScope.onmessage = async (event: MessageEvent<ParseRequest>) => {
  const { id, buffer } = event.data;
  try {
    const sheets = await readXlsxFile(buffer);
    const workbook = extractGeographyWorkbook(sheets.map(sheet => ({ name: sheet.sheet, data: sheet.data })));
    workerScope.postMessage({ id, workbook } satisfies ParseResponse);
  } catch (error) {
    workerScope.postMessage({
      id,
      workbook: null,
      error: error instanceof Error ? error.message : 'Не удалось прочитать отчёт «География заказов»',
    } satisfies ParseResponse);
  }
};

export {};
