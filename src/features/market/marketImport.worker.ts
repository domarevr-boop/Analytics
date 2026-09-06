/// <reference lib="webworker" />

import readXlsxFile from 'read-excel-file/web-worker';
import { extractMarketTable } from './marketImportCore';
import type { MarketParsedCandidate } from './marketImportCore';

interface ParseRequest {
  id: string;
  fileName: string;
  buffer: ArrayBuffer;
}

interface ParseResponse {
  id: string;
  candidate: MarketParsedCandidate | null;
  error?: string;
}

function detectDelimiter(text: string): string {
  const firstLine = text.split(/\r?\n/, 1)[0] || '';
  const semicolons = (firstLine.match(/;/g) || []).length;
  const commas = (firstLine.match(/,/g) || []).length;
  return semicolons > commas ? ';' : ',';
}

function parseDelimited(text: string, delimiter: string): string[][] {
  const grid: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;

  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    if (char === '"') {
      if (quoted && text[index + 1] === '"') {
        cell += '"';
        index++;
      } else {
        quoted = !quoted;
      }
    } else if (char === delimiter && !quoted) {
      row.push(cell);
      cell = '';
    } else if ((char === '\n' || char === '\r') && !quoted) {
      if (char === '\r' && text[index + 1] === '\n') index++;
      row.push(cell);
      if (row.some(value => value.trim() !== '')) grid.push(row);
      row = [];
      cell = '';
    } else {
      cell += char;
    }
  }

  row.push(cell);
  if (row.some(value => value.trim() !== '')) grid.push(row);
  return grid;
}

const workerScope = self as unknown as DedicatedWorkerGlobalScope;

workerScope.onmessage = async (event: MessageEvent<ParseRequest>) => {
  const { id, fileName, buffer } = event.data;
  const extension = fileName.split('.').pop()?.toLocaleLowerCase('en-US');
  try {
    let candidate: MarketParsedCandidate | null = null;
    if (extension === 'csv') {
      const text = new TextDecoder('utf-8').decode(buffer).replace(/^\uFEFF/, '');
      candidate = extractMarketTable(parseDelimited(text, detectDelimiter(text)), 'Рынок');
    } else if (extension === 'xlsx') {
      const sheets = await readXlsxFile(buffer);
      for (const sheet of sheets) {
        const parsed = extractMarketTable(sheet.data, sheet.sheet);
        if (parsed) {
          candidate = parsed;
          break;
        }
      }
    }
    const response: ParseResponse = { id, candidate };
    workerScope.postMessage(response);
  } catch (error) {
    const response: ParseResponse = {
      id,
      candidate: null,
      error: error instanceof Error ? error.message : 'Не удалось прочитать отчёт «Рынок»',
    };
    workerScope.postMessage(response);
  }
};

export {};
