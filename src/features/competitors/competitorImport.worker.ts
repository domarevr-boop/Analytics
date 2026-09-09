/// <reference lib="webworker" />

import readXlsxFile from 'read-excel-file/web-worker';
import { extractCompetitorWorkbook } from './competitorImportCore';
import type { CompetitorParsedWorkbook } from './competitorImportCore';

interface ParseRequest {
  id: string;
  buffer: ArrayBuffer;
  reportYear?: number;
}

interface ParseResponse {
  id: string;
  workbook: CompetitorParsedWorkbook | null;
  error?: string;
}

const workerScope = self as unknown as DedicatedWorkerGlobalScope;

workerScope.onmessage = async (event: MessageEvent<ParseRequest>) => {
  const { id, buffer, reportYear } = event.data;
  try {
    const sheets = await readXlsxFile(buffer);
    const workbook = extractCompetitorWorkbook(
      sheets.map(sheet => ({ name: sheet.sheet, data: sheet.data })),
      reportYear,
    );
    const response: ParseResponse = { id, workbook };
    workerScope.postMessage(response);
  } catch (error) {
    const response: ParseResponse = {
      id,
      workbook: null,
      error: error instanceof Error ? error.message : 'Не удалось прочитать отчёт «Конкуренты»',
    };
    workerScope.postMessage(response);
  }
};

export {};
