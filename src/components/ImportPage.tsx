import { useState, useCallback, useEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import { importCompetitorWorkbook, importMappedData, getImportLog, subscribe, getVersion, deleteImportLogEntry } from '../data/store';
import { parseFile } from '../data/parseFile';
import { parseCompetitorWorkbook } from '../data/competitorImport';
import type { CompetitorWorkbookData } from '../data/competitorImport';
import type { ParsedFile } from '../data/parseFile';
import type { ColumnMapping } from '../data/columnMapping';
import type { ImportSource, ImportFileLog } from '../types';
import ImportColumnMapper from './ImportColumnMapper';
import DataCoverage from './DataCoverage';
import { AnalyticsPageHeader, AnalyticsPanel, PanelHeader } from './AnalyticsPrimitives';
import { getLatestReviewImport, importReviewsToSupabase } from '../features/clientExperience/reviewImport';
import type { ReviewImportSummary } from '../features/clientExperience/reviewImport';
import { parseMarketFileInWorker } from '../features/market/marketImportParser';
import type { ParsedMarketFile } from '../features/market/marketImportParser';
import { getLatestMarketImport, importMarketToSupabase } from '../features/market/marketImport';
import type { MarketImportResult } from '../features/market/marketImport';

const SOURCE_LABELS: Record<string, string> = {
  reviews: 'Отзывы WB',
  search_queries: 'Поисковые запросы WB',
  niche_dynamics: 'Динамика ниши',
  market_dynamics: 'Рынок',
  competitors: 'Конкуренты',
  geography: 'География заказов',
  wb_funnel: 'WB Воронка',
  xway: 'XWay Реклама',
  profitability: 'Рентабельность',
  entry_points: 'Точки входа',
  plan_template: 'План',
  group_history: 'История склеек',
};

const SOURCE_COLORS: Record<string, string> = {
  reviews: '#FFF7D6',
  search_queries: '#EAF2FF',
  niche_dynamics: '#E9F7F2',
  market_dynamics: '#EEF5FF',
  competitors: '#E8F5FF',
  geography: '#DBEAFE',
  wb_funnel: '#F3F4F6',
  xway: '#F0FDF4',
  profitability: '#FEF9C3',
  entry_points: '#F3E8FF',
  plan_template: '#FFF7D6',
  group_history: '#FDE68A',
};

const FILE_TYPE_LABELS: Record<string, string> = {
  xlsx: 'Excel',
  xls: 'Excel',
  csv: 'CSV',
};
const DEV = import.meta.env.DEV;

interface ImportPageProps {
  serverOnly?: boolean;
}

function waitForPaint() {
  return new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
}

export default function ImportPage({ serverOnly = false }: ImportPageProps) {
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
  const [marketParseContext, setMarketParseContext] = useState<Pick<ParsedMarketFile, 'sourceRowNumbers' | 'sheetName'> | null>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [competitorPreview, setCompetitorPreview] = useState<CompetitorWorkbookData | null>(null);
  const [competitorYear, setCompetitorYear] = useState(new Date().getFullYear());
  const [latestReviewImport, setLatestReviewImport] = useState<ReviewImportSummary | null>(null);
  const [latestMarketImport, setLatestMarketImport] = useState<MarketImportResult | null>(null);
  const importRunningRef = useRef(false);

  useEffect(() => {
    if (!serverOnly) void getLatestReviewImport().then(setLatestReviewImport);
    void getLatestMarketImport().then(setLatestMarketImport);
  }, [serverOnly]);

  const handleFile = useCallback(async (file: File) => {
    const ext = file.name.split('.').pop()?.toLowerCase() || '';
    if (DEV) console.log('[import-ui] file received:', file.name, file.size, 'type:', ext);
    setLoading(true);
    setMarketParseContext(null);
    setProgress(`Чтение ${file.name}...`);
    try {
      await waitForPaint();
      if (ext === 'xlsx' || ext === 'csv') {
        const marketFile = await parseMarketFileInWorker(file);
        if (marketFile) {
          setParsed(marketFile);
          setMarketParseContext({ sourceRowNumbers: marketFile.sourceRowNumbers, sheetName: marketFile.sheetName });
          setSelectedFile(file);
          return;
        }
      }
      if (serverOnly) throw new Error('Для роли importer в V5 разрешён только серверный отчёт «Рынок» (.xlsx или .csv).');
      if (ext === 'xlsx' || ext === 'xls') {
        try {
          const competitorData = await parseCompetitorWorkbook(file);
          setCompetitorPreview(competitorData);
          setCompetitorYear(competitorData.inferredYear || new Date().getFullYear());
          setSelectedFile(file);
          return;
        } catch (error) {
          if (DEV) console.debug('[import-ui] not a competitors workbook:', error);
        }
      }
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
  }, [serverOnly]);

  const handleCompetitorImport = useCallback(async () => {
    if (!selectedFile || !competitorPreview || importRunningRef.current) return;
    importRunningRef.current = true;
    setLoading(true);
    setProgress('Проверка четырёх листов и сохранение...');
    try {
      await waitForPaint();
      const data = await parseCompetitorWorkbook(selectedFile, competitorYear);
      const result = await importCompetitorWorkbook(selectedFile.name, data);
      if (result.status === 'error') throw new Error(result.error || 'Не удалось сохранить данные конкурентов');
      alert(`Импорт конкурентов завершён. Загружено ${result.rowCount} строк из 4 листов.`);
    } catch (error) {
      alert(error instanceof Error ? error.message : 'Ошибка импорта конкурентов');
    } finally {
      importRunningRef.current = false;
      setLoading(false);
      setProgress('');
      setCompetitorPreview(null);
      setSelectedFile(null);
    }
  }, [selectedFile, competitorPreview, competitorYear]);

  const handleConfirmMapping = useCallback(async (
    source: ImportSource,
    mapping: ColumnMapping,
    remapped: Record<string, string>[],
    dateOverride?: string,
    dateEndOverride?: string,
    dateYearOverride?: number,
  ) => {
    if (!parsed || importRunningRef.current) return;
    if (serverOnly && source !== 'market_dynamics') {
      alert('Для роли importer в V5 разрешён только серверный отчёт «Рынок».');
      return;
    }
    importRunningRef.current = true;
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
      if (source === 'market_dynamics') {
        if (!selectedFile) throw new Error('Исходный файл «Рынок» не найден. Выберите файл повторно.');
        const result = await importMarketToSupabase(selectedFile, remapped, {
          sourceRowNumbers: marketParseContext?.sourceRowNumbers,
          sheetName: marketParseContext?.sheetName,
          dateOverride,
          fallbackYear: dateYearOverride,
          onProgress: current => {
            const stage = current.stage === 'hashing'
              ? 'Контрольная сумма'
              : current.stage === 'uploading'
                ? 'Сохранение исходника'
                : current.stage === 'staging'
                  ? 'Передача строк'
                  : 'Серверная проверка и публикация';
            setProgress(`${stage}: ${current.processed}/${current.total}`);
          },
        });
        setLatestMarketImport(result);
        if (result.status === 'failed') {
          alert(`Импорт «Рынка» отклонён сервером. Ошибочных строк: ${result.rejectedRows}, ошибок: ${result.errorCount}. Исходный файл и журнал сохранены в V5.`);
        } else if (result.duplicate) {
          alert('Этот файл «Рынка» уже опубликован в V5. Повторная запись не создавалась.');
        } else {
          alert(`Импорт «Рынка» опубликован в V5. Строк: ${result.acceptedRows}. Период: ${result.periodStart || '—'} — ${result.periodEnd || '—'}.`);
        }
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
      importRunningRef.current = false;
      setLoading(false);
      setProgress('');
      setParsed(null);
      setMarketParseContext(null);
      setSelectedFile(null);
    }
  }, [parsed, selectedFile, marketParseContext, serverOnly]);

  const handleCancelMapping = useCallback(() => {
    setParsed(null);
    setMarketParseContext(null);
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
    <div className="import-page analytics-page-shell ds-page import-design-page">
      <AnalyticsPageHeader eyebrow="Данные" title="Импорт отчётов" description={serverOnly ? 'Безопасная загрузка серверного отчёта «Рынок» в V5.' : 'Единая точка загрузки, проверки покрытия и обновления аналитических источников.'} />
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
      {!serverOnly && competitorPreview && (
        <div className="import-mapper-wrapper">
          <div className="import-mapper-overlay">
            <div className="import-mapper competitor-import-preview">
              <div className="import-mapper-header">
                <div className="import-mapper-header-info"><h3>Импорт конкурентов: {selectedFile?.name}</h3><span className="import-mapper-summary">Все 4 листа распознаны</span></div>
                <span className="import-mapper-date"><label>Год отчёта:</label><input type="number" className="daterange-input" min="2000" max="2100" value={competitorYear} onChange={event => setCompetitorYear(Number(event.target.value))} /></span>
              </div>
              <div className="import-mapper-body">
                <div className="import-date-coverage"><span>Покрытие дат</span><strong>{competitorPreview.dateStart} — {competitorPreview.dateEnd}</strong></div>
                <div className="competitor-import-grid">
                  <article><span>Заказы и воронка</span><strong>{competitorPreview.funnel.length}</strong><small>{competitorPreview.sheetNames.funnel}</small></article>
                  <article><span>Поисковые запросы</span><strong>{competitorPreview.search.length}</strong><small>{competitorPreview.sheetNames.search}</small></article>
                  <article><span>Склады и остатки</span><strong>{competitorPreview.stocks.length}</strong><small>{competitorPreview.sheetNames.stocks}</small></article>
                  <article><span>Позиции ТОП-50</span><strong>{competitorPreview.positions.length}</strong><small>{competitorPreview.sheetNames.positions}</small></article>
                </div>
                <p className="import-preview-note">Импорт заменит только предыдущий набор данных страницы «Конкуренты». Остальные локальные отчёты и отзывы на сервере не изменятся.</p>
              </div>
              <div className="import-mapper-footer"><button type="button" className="btn-secondary" onClick={() => { setCompetitorPreview(null); setSelectedFile(null); }}>Отмена</button><button type="button" className="btn-primary" onClick={handleCompetitorImport}>Импортировать 4 листа</button></div>
            </div>
          </div>
        </div>
      )}
      <div
        className={`import-dropzone ${loading ? 'loading' : ''}`}
        role="button"
        tabIndex={0}
        aria-disabled={loading}
        onDragOver={e => e.preventDefault()}
        onDrop={handleDrop}
        onClick={() => document.getElementById('file-input')?.click()}
        onKeyDown={event => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            document.getElementById('file-input')?.click();
          }
        }}
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
          {serverOnly ? 'Поддерживаются: отчёт «Рынок» в CSV или Excel (.xlsx)' : 'Поддерживаются: CSV, Excel (.xlsx, .xls) — аналитические отчёты и отзывы WB'}
        </div>
      </div>

      {!serverOnly && latestReviewImport && (
        <AnalyticsPanel className="import-log import-review-latest" density="data">
          <div className="import-section-head"><PanelHeader eyebrow="Серверный контур" title="Последний импорт отзывов WB" description={latestReviewImport.fileName} controls={<span>{latestReviewImport.status === 'completed' ? 'Проверен' : latestReviewImport.status}</span>} /></div>
          <div className="import-table-wrap"><table className="import-table">
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
          </table></div>
          {latestReviewImport.errorMessage && <p className="import-mapper-error">{latestReviewImport.errorMessage}</p>}
        </AnalyticsPanel>
      )}

      {latestMarketImport && (
        <AnalyticsPanel className="import-log import-market-latest" density="data">
          <div className="import-section-head"><PanelHeader eyebrow="Серверный контур V5" title="Текущий импорт «Рынка»" description={latestMarketImport.fileName} controls={<span>{latestMarketImport.status === 'published' ? 'Опубликован' : 'Отклонён'}</span>} /></div>
          <div className="import-table-wrap"><table className="import-table">
            <thead><tr><th>Дата</th><th>Период</th><th>Всего строк</th><th>Принято</th><th>Отклонено</th><th>Повтор</th><th>Исходный файл</th></tr></thead>
            <tbody><tr>
              <td>{formatDate(latestMarketImport.importedAt)}</td>
              <td>{latestMarketImport.periodStart ? `${latestMarketImport.periodStart} — ${latestMarketImport.periodEnd || latestMarketImport.periodStart}` : '—'}</td>
              <td>{latestMarketImport.inputRows}</td>
              <td>{latestMarketImport.acceptedRows}</td>
              <td>{latestMarketImport.rejectedRows}</td>
              <td>{latestMarketImport.duplicate ? 'Да' : 'Нет'}</td>
              <td>Сохранён в private Storage</td>
            </tr></tbody>
          </table></div>
        </AnalyticsPanel>
      )}

      {!serverOnly && latestLogs.length > 0 && (
        <AnalyticsPanel className="import-log import-latest-files" density="data">
          <div className="import-section-head"><PanelHeader eyebrow="Локальные данные" title="Последние файлы" description="По одному последнему импорту для каждого типа отчёта" controls={<span>{latestLogs.length} источников</span>} /></div>
          <div className="import-table-wrap"><table className="import-table">
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
          </table></div>
        </AnalyticsPanel>
      )}

      {!serverOnly && <DataCoverage />}
    </div>
  );
}
