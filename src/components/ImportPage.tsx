import { useState, useCallback, useEffect, useMemo, useSyncExternalStore } from 'react';
import { importMappedData, getImportLog, subscribe, getVersion, deleteImportLogEntry } from '../data/store';
import { parseFile } from '../data/parseFile';
import type { ParsedFile } from '../data/parseFile';
import type { ColumnMapping } from '../data/columnMapping';
import type { ImportSource, ImportFileLog } from '../types';
import ImportColumnMapper from './ImportColumnMapper';
import DataCoverage from './DataCoverage';
import { getLatestReviewImport, importReviewsToSupabase } from '../features/clientExperience/reviewImport';
import type { ReviewImportSummary } from '../features/clientExperience/reviewImport';

const SOURCE_LABELS: Record<string, string> = {
  reviews: 'Отзывы WB',
  search_queries: 'Поисковые запросы WB',
  niche_dynamics: 'Динамика ниши',
  geography: 'География заказов',
  wb_funnel: 'WB Воронка',
  xway: 'XWay Реклама',
  profitability: 'Рентабельность',
  entry_points: 'Точки входа',
  plan_template: 'План',
};

const SOURCE_COLORS: Record<string, string> = {
  reviews: '#FFF7D6',
  search_queries: '#EAF2FF',
  niche_dynamics: '#E9F7F2',
  geography: '#DBEAFE',
  wb_funnel: '#F3F4F6',
  xway: '#F0FDF4',
  profitability: '#FEF9C3',
  entry_points: '#F3E8FF',
  plan_template: '#FFF7D6',
};

const FILE_TYPE_LABELS: Record<string, string> = {
  xlsx: 'Excel',
  xls: 'Excel',
  csv: 'CSV',
};
const DEV = import.meta.env.DEV;

function waitForPaint() {
  return new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
}

export default function ImportPage() {
  useSyncExternalStore(subscribe, getVersion);
  const logs = getImportLog();
  const latestLogs = useMemo(() => {
    const latest = new Map<ImportSource, ImportFileLog>();
    for (const log of logs) {
      if (!latest.has(log.source)) latest.set(log.source, log);
    }
    return [...latest.values()].sort((a, b) => (SOURCE_LABELS[a.source] || a.source).localeCompare(SOURCE_LABELS[b.source] || b.source, 'ru'));
  }, [logs]);
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState('');
  const [parsed, setParsed] = useState<ParsedFile | null>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [latestReviewImport, setLatestReviewImport] = useState<ReviewImportSummary | null>(null);

  useEffect(() => {
    void getLatestReviewImport().then(setLatestReviewImport);
  }, []);

  const handleFile = useCallback(async (file: File) => {
    const ext = file.name.split('.').pop()?.toLowerCase() || '';
    if (DEV) console.log('[import-ui] file received:', file.name, file.size, 'type:', ext);
    setLoading(true);
    setProgress(`Чтение ${file.name}...`);
    try {
      await waitForPaint();
      const result = await parseFile(file);
      if (DEV) console.log('[import-ui] parsed:', result.fileType, result.totalRows, 'rows,', result.headers.length, 'cols, headers:', result.headers);
      setParsed(result);
      setSelectedFile(file);
    } catch (err) {
      if (DEV) console.log('[import-ui] error:', err);
      alert(err instanceof Error ? err.message : 'Ошибка обработки файла');
    } finally {
      setLoading(false);
      setProgress('');
    }
  }, []);

  const handleConfirmMapping = useCallback(async (
    source: ImportSource,
    mapping: ColumnMapping,
    remapped: Record<string, string>[],
    dateOverride?: string,
    dateEndOverride?: string,
    dateYearOverride?: number,
  ) => {
    if (!parsed) return;
    if (DEV) console.log('[import-ui] source:', source, 'remapped rows:', remapped.length, 'dateOverride:', dateOverride);
    if (DEV && remapped.length > 0) console.log('[import-ui] first remapped row:', remapped[0], 'keys:', Object.keys(remapped[0]));

    setProgress(`Импорт ${remapped.length} строк...`);
    setLoading(true);
    try {
      await waitForPaint();
      if (source === 'reviews') {
        if (!selectedFile) throw new Error('Исходный файл отзывов не найден. Выберите файл повторно.');
        const result = await importReviewsToSupabase(selectedFile, remapped, mapping.map, current => {
          const stage = current.stage === 'uploading'
            ? 'Загрузка защищённой копии'
            : current.stage === 'verifying'
              ? 'Сверка строк'
              : current.stage === 'cleaning'
                ? 'Удаление исходного файла'
                : 'Запись отзывов';
          setProgress(`${stage}: ${current.processed}/${current.total}`);
        });
        setLatestReviewImport(await getLatestReviewImport());
        alert([
          'Импорт отзывов завершён и проверен.',
          `Строк: ${result.totalRows}`,
          `Текстовых отзывов: ${result.textRows}`,
          `Пустых оценок: ${result.emptyRows}`,
          `Дубликатов: ${result.duplicateRows}`,
          `Отклонено: ${result.rejectedRows}`,
          `Без связи с товаром: ${result.unmatchedProductRows}`,
          result.fileDeleted ? 'Исходный файл удалён с сервера.' : 'Исходный файл не удалён: требуется повторная очистка.',
        ].join('\n'));
        return;
      }
      const result = await importMappedData(parsed.fileName, source, remapped, dateOverride, dateEndOverride, dateYearOverride);
      if (DEV) console.log('[import-ui] importMappedData returned:', result.status, result.rowCount);
      if (result.status === 'error') {
        alert(`Ошибка импорта: ${result.error}`);
      }
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Ошибка импорта');
    } finally {
      setLoading(false);
      setProgress('');
      setParsed(null);
      setSelectedFile(null);
    }
  }, [parsed, selectedFile]);

  const handleCancelMapping = useCallback(() => {
    setParsed(null);
    setSelectedFile(null);
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
    <div className="import-page analytics-page-shell">
      <header className="analytics-page-header">
        <div><span>ДАННЫЕ</span><h1>Импорт отчётов</h1><p>Единая точка загрузки, проверки покрытия и обновления аналитических источников.</p></div>
      </header>
      {parsed && (
        <div className="import-mapper-wrapper">
          {loading && (
            <div className="import-mapper-loading">
              <span className="import-spinner" />
              <span>{progress || 'Импорт...'}</span>
            </div>
          )}
          <ImportColumnMapper
            parsed={parsed}
            onConfirm={handleConfirmMapping}
            onCancel={handleCancelMapping}
          />
        </div>
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
        <div className="dropzone-icon">{loading ? <span className="import-spinner" /> : '+'}</div>
        <div className="dropzone-text">
          {loading ? progress || 'Загрузка...' : 'Перетащите файлы сюда или нажмите для выбора'}
        </div>
        <div className="dropzone-hint">
          Поддерживаются: CSV, Excel (.xlsx, .xls) — аналитические отчёты и отзывы WB
        </div>
      </div>

      {latestReviewImport && (
        <div className="import-log import-review-latest">
          <div className="import-section-head">
            <div>
              <h3 className="log-title">Последний импорт отзывов WB</h3>
              <p>{latestReviewImport.fileName}</p>
            </div>
            <span>{latestReviewImport.status === 'completed' ? 'Проверен' : latestReviewImport.status}</span>
          </div>
          <table className="import-table">
            <thead><tr><th>Дата</th><th>Всего строк</th><th>С текстом</th><th>Без текста</th><th>Дубликаты</th><th>Отклонено</th><th>Исходный файл</th></tr></thead>
            <tbody><tr>
              <td>{formatDate(latestReviewImport.importedAt)}</td>
              <td>{latestReviewImport.totalRows}</td>
              <td>{latestReviewImport.textRows}</td>
              <td>{latestReviewImport.emptyRows}</td>
              <td>{latestReviewImport.duplicateRows}</td>
              <td>{latestReviewImport.rejectedRows}</td>
              <td>{latestReviewImport.fileDeletedAt ? 'Удалён после сверки' : 'Сохранён для диагностики'}</td>
            </tr></tbody>
          </table>
          {latestReviewImport.errorMessage && <p className="import-mapper-error">{latestReviewImport.errorMessage}</p>}
        </div>
      )}

      {latestLogs.length > 0 && (
        <div className="import-log import-latest-files">
          <div className="import-section-head"><div><h3 className="log-title">Последние файлы</h3><p>По одному последнему импорту для каждого типа отчёта</p></div><span>{latestLogs.length} источников</span></div>
          <table className="import-table">
            <thead>
              <tr>
                <th>Отчёт</th>
                <th>Последний файл</th>
                <th>Период файла</th>
                <th>Строк</th>
                <th>Загружен</th>
                <th>Статус</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {latestLogs.map(log => {
                const ext = log.fileName.split('.').pop()?.toLowerCase() || '';
                const fileType = FILE_TYPE_LABELS[ext] || ext.toUpperCase();
                return (
                  <tr key={log.id} className={`import-row-${log.status}`}>
                    <td>
                      <span
                        className="import-source-badge"
                        style={{ background: SOURCE_COLORS[log.source] || '#F3F4F6' }}
                      >
                        {SOURCE_LABELS[log.source] || log.source}
                      </span>
                    </td>
                    <td className="import-filename"><span>{log.fileName}</span><small>{fileType}</small></td>
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
