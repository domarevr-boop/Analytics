import { useState, useCallback, useSyncExternalStore } from 'react';
import { importMappedData, getImportLog, subscribe, getVersion, deleteImportLogEntry } from '../data/store';
import { parseFile } from '../data/parseFile';
import type { ParsedFile } from '../data/parseFile';
import type { ColumnMapping } from '../data/columnMapping';
import type { ImportSource, ImportFileLog } from '../types';
import ImportColumnMapper from './ImportColumnMapper';
import DataCoverage from './DataCoverage';

const SOURCE_LABELS: Record<string, string> = {
  wb_funnel: 'WB Воронка',
  xway: 'XWay Реклама',
  profitability: 'Рентабельность',
};

const SOURCE_COLORS: Record<string, string> = {
  wb_funnel: '#F3F4F6',
  xway: '#F0FDF4',
  profitability: '#FEF9C3',
};

const FILE_TYPE_LABELS: Record<string, string> = {
  xlsx: 'Excel',
  xls: 'Excel',
  csv: 'CSV',
};

export default function ImportPage() {
  const DEV = import.meta.env.DEV;
  useSyncExternalStore(subscribe, getVersion);
  const logs = getImportLog();
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState('');
  const [parsed, setParsed] = useState<ParsedFile | null>(null);

  const handleFile = useCallback(async (file: File) => {
    const ext = file.name.split('.').pop()?.toLowerCase() || '';
    if (DEV) console.log('[import-ui] file received:', file.name, file.size, 'type:', ext);
    setLoading(true);
    setProgress(`Чтение ${file.name}...`);
    try {
      const result = await parseFile(file);
      if (DEV) console.log('[import-ui] parsed:', result.fileType, result.totalRows, 'rows,', result.headers.length, 'cols, headers:', result.headers);
      setParsed(result);
    } catch (err) {
      if (DEV) console.log('[import-ui] error:', err);
      alert(err instanceof Error ? err.message : 'Ошибка обработки файла');
    } finally {
      setLoading(false);
      setProgress('');
    }
  }, []);

  const handleConfirmMapping = useCallback(async (source: ImportSource, _mapping: ColumnMapping, remapped: Record<string, string>[], dateOverride?: string) => {
    if (!parsed) return;
    if (DEV) console.log('[import-ui] source:', source, 'remapped rows:', remapped.length, 'dateOverride:', dateOverride);
    if (DEV && remapped.length > 0) console.log('[import-ui] first remapped row:', remapped[0], 'keys:', Object.keys(remapped[0]));

    setProgress(`Импорт ${remapped.length} строк...`);
    setLoading(true);
    try {
      const result = await importMappedData(parsed.fileName, source, remapped, dateOverride);
      if (DEV) console.log('[import-ui] importMappedData returned:', result.status, result.rowCount);
      if (result.status === 'error') {
        alert(`Ошибка импорта: ${result.error}`);
      }
    } finally {
      setLoading(false);
      setProgress('');
      setParsed(null);
    }
  }, [parsed]);

  const handleCancelMapping = useCallback(() => {
    setParsed(null);
  }, []);

  const handleDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault();
    const files = Array.from(e.dataTransfer.files).filter(f => {
      const ext = f.name.split('.').pop()?.toLowerCase();
      return ext === 'csv' || ext === 'xlsx' || ext === 'xls';
    });
    if (DEV) console.log('[import-ui] drop:', files.length, 'files');
    for (const f of files) {
      await handleFile(f);
    }
  }, [handleFile]);

  const handleInput = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []).filter(f => {
      const ext = f.name.split('.').pop()?.toLowerCase();
      return ext === 'csv' || ext === 'xlsx' || ext === 'xls';
    });
    if (DEV) console.log('[import-ui] input:', files.length, 'files');
    for (const f of files) {
      await handleFile(f);
    }
    e.target.value = '';
  }, [handleFile]);

  const handleDelete = useCallback(async (log: ImportFileLog) => {
    const msg = log.dataStart
      ? `Удалить импорт "${log.fileName}" и очистить ${log.rowCount} метрик за период ${log.dataStart}—${log.dataEnd || log.dataStart}?`
      : `Удалить импорт "${log.fileName}" и все данные рекламы XWAY?`;
    if (confirm(msg)) {
      await deleteImportLogEntry(log.id);
    }
  }, []);

  const formatPeriod = (log: ImportFileLog) => {
    if (!log.dataStart) return '—';
    const d = (s: string) => {
      const [y, m, d] = s.split('-');
      return `${d}.${m}.${y}`;
    };
    if (!log.dataStart) return '';
    if (!log.dataEnd || log.dataStart === log.dataEnd) return d(log.dataStart);
    return `${d(log.dataStart)} — ${d(log.dataEnd)}`;
  };

  const formatDate = (iso: string) => {
    const d = new Date(iso);
    return d.toLocaleString('ru-RU');
  };

  return (
    <div className="import-page">
      {parsed && (
        <ImportColumnMapper
          parsed={parsed}
          onConfirm={handleConfirmMapping}
          onCancel={handleCancelMapping}
        />
      )}

      <h2 className="import-title">Импорт данных</h2>

      <div
        className={`import-dropzone ${loading ? 'loading' : ''}`}
        onDragOver={e => e.preventDefault()}
        onDrop={handleDrop}
        onClick={() => document.getElementById('file-input')?.click()}
      >
        <input
          id="file-input"
          type="file"
          accept=".csv,.xlsx,.xls"
          multiple
          hidden
          onChange={handleInput}
        />
        <div className="dropzone-icon">{loading ? '...' : '+'}</div>
        <div className="dropzone-text">
          {loading ? progress || 'Загрузка...' : 'Перетащите файлы сюда или нажмите для выбора'}
        </div>
        <div className="dropzone-hint">
          Поддерживаются: CSV, Excel (.xlsx, .xls) — WB воронка, XWay, рентабельность
        </div>
      </div>

      {logs.length > 0 && (
        <div className="import-log">
          <h3 className="log-title">История загрузок</h3>
          <table className="import-table">
            <thead>
              <tr>
                <th>Файл</th>
                <th>Тип</th>
                <th>Источник</th>
                <th>Кабинет</th>
                <th>Период</th>
                <th>Строк</th>
                <th>Дата загрузки</th>
                <th>Статус</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {logs.map(log => {
                const ext = log.fileName.split('.').pop()?.toLowerCase() || '';
                const fileType = FILE_TYPE_LABELS[ext] || ext.toUpperCase();
                return (
                  <tr key={log.id} className={`import-row-${log.status}`}>
                    <td className="import-filename">{log.fileName}</td>
                    <td><span className="import-filetype">{fileType}</span></td>
                    <td>
                      <span
                        className="import-source-badge"
                        style={{ background: SOURCE_COLORS[log.source] || '#F3F4F6' }}
                      >
                        {SOURCE_LABELS[log.source] || log.source}
                      </span>
                    </td>
                    <td className="import-cabinet">{log.cabinetName || (log.cabinetId ? 'Каб.' : '—')}</td>
                    <td className="import-period">{formatPeriod(log)}</td>
                    <td className="import-count">{log.rowCount.toLocaleString('ru-RU')}</td>
                    <td className="import-date">{formatDate(log.uploadedAt)}</td>
                    <td>
                      {log.status === 'processing' ? (
                        <span className="import-status processing">... Обработка</span>
                      ) : log.status === 'success' ? (
                        <span className="import-status success">v Успешно</span>
                      ) : (
                        <span className="import-status error" title={log.error}>
                          x {log.error || 'Ошибка'}
                        </span>
                      )}
                    </td>
                    <td>
                      <button
                        className="import-delete-btn"
                        title="Удалить импорт"
                        onClick={() => handleDelete(log)}
                      >
                        x
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <DataCoverage />
    </div>
  );
}
