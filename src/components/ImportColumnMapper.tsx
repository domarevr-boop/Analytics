import { useMemo, useState } from 'react';
import type { ParsedFile } from '../data/parseFile';
import { autoDetectMapping, remapRows, FIELD_LABELS, getRequiredFields, detectSourceFromHeaders } from '../data/columnMapping';
import type { ColumnMapping } from '../data/columnMapping';
import type { ImportSource } from '../types';
import { detectSourceFromFilename } from '../data/store';
import { normalizeImportDate } from '../data/dateUtils';
import { analyzeGroupHistoryImport } from '../data/groupHistoryImport';
import type { GroupHistoryImportOptions } from '../data/groupHistoryImport';
import { classifySku } from '../data/rules';

const SOURCE_OPTIONS: { value: ImportSource; label: string }[] = [
  { value: 'reviews', label: 'Отзывы WB (Клиентский опыт)' },
  { value: 'niche_dynamics', label: 'Динамика ниши' },
  { value: 'market_dynamics', label: 'Рынок' },
  { value: 'search_queries', label: 'Поисковые запросы WB' },
  { value: 'entry_points', label: 'Точки входа' },
  { value: 'group_history', label: 'История склеек' },
  { value: 'geography', label: 'География заказов' },
  { value: 'wb_funnel', label: 'WB Воронка' },
  { value: 'xway', label: 'XWay Реклама' },
  { value: 'profitability', label: 'Рентабельность' },
];

interface Props {
  parsed: ParsedFile;
  onConfirm: (
    source: ImportSource,
    mapping: ColumnMapping,
    remapped: Record<string, string>[],
    dateOverride?: string,
    dateEndOverride?: string,
    dateYearOverride?: number,
    groupHistoryOptions?: GroupHistoryImportOptions,
  ) => void;
  onCancel: () => void;
}

function todayStr() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export default function ImportColumnMapper({ parsed, onConfirm, onCancel }: Props) {
  const DEV = import.meta.env.DEV;
  const [source, setSource] = useState<ImportSource>(() => detectSourceFromHeaders(parsed.headers) || detectSourceFromFilename(parsed.fileName));
  const [manualDateStart, setManualDateStart] = useState(todayStr);
  const [manualDateEnd, setManualDateEnd] = useState(todayStr);
  const [reportYear, setReportYear] = useState(() => new Date().getFullYear());
  const [acceptGroupHistoryAnomalies, setAcceptGroupHistoryAnomalies] = useState(false);

  const mapping = useMemo(() => autoDetectMapping(parsed.headers, source), [parsed.headers, source]);
  const required = useMemo(() => getRequiredFields(source), [source]);

  const finalMap = mapping.map;
  const remapped = useMemo(() => remapRows(parsed.rows, finalMap), [parsed.rows, finalMap]);
  const groupHistoryAnalysis = useMemo(() => source === 'group_history'
    ? analyzeGroupHistoryImport(remapped, undefined, reportYear, {
      acceptAnomalies: acceptGroupHistoryAnomalies,
      inferCabinetId: identity => classifySku(identity).cabinetId,
    })
    : null, [remapped, source, reportYear, acceptGroupHistoryAnomalies]);

  if (DEV) console.log('[ImportColumnMapper] render:', { source, manualDateStart, manualDateEnd, totalRows: parsed.totalRows, finalMap, unmapped: mapping.unmapped, remappedLen: remapped.length });
  if (DEV && remapped.length > 0) console.log('[ImportColumnMapper] first remapped:', remapped[0]);

  const mappedFields = Object.values(finalMap);
  const hasDateColumn = mappedFields.includes('date');
  const hasPeriodStartColumn = mappedFields.includes('period_start');
  const hasPeriodEndColumn = mappedFields.includes('period_end');
  const hasSourceDate = source === 'profitability'
    ? hasDateColumn || hasPeriodStartColumn
    : hasDateColumn;
  const mappedCount = Object.keys(finalMap).length;
  const totalCount = parsed.headers.length;
  const missingRequired = source === 'group_history'
    ? [
      ...(!mappedFields.includes('date') ? ['date'] : []),
      ...(!mappedFields.includes('sku') && !mappedFields.includes('wb_sku') ? ['sku'] : []),
      ...(!mappedFields.includes('group_code') ? ['group_code'] : []),
    ]
    : required.filter(f => !mappedFields.includes(f));
  const hasYearlessDates = hasSourceDate && remapped.some(row =>
    /^(\d{1,2})[./](\d{1,2})$/.test(String(row.date || row.period_start || '').trim()),
  );

  const previewHeaders = source === 'niche_dynamics'
    ? ['date', 'niche_category', 'niche_subject', 'niche_sellers', 'niche_active_sellers', 'niche_revenue', 'niche_avg_check']
    : source === 'market_dynamics'
    ? ['date', 'market_ordered_amount', 'market_own_ordered_amount', 'market_amount_share', 'market_orders', 'market_own_orders', 'market_orders_share', 'market_own_avg_check', 'market_avg_check']
    : source === 'search_queries'
    ? ['date', 'search_query', 'search_category', 'search_requests', 'search_card_clicks', 'search_carts', 'search_orders']
    : source === 'reviews'
    ? ['review_cabinet', 'review_id', 'date', 'sku', 'wb_sku', 'review_rating', 'review_text']
    : source === 'group_history'
    ? ['date', 'sku', 'wb_sku', 'group_code']
    : source === 'profitability'
    ? ['sku', ...(!hasSourceDate ? [] : mappedFields.filter(field => ['date', 'period_start', 'period_end'].includes(field))), 'profit_revenue', 'actual_profit', 'actual_margin'].filter((field, index, fields) => mappedFields.includes(field) && fields.indexOf(field) === index)
    : [
      'sku',
      ...(!hasSourceDate ? [] : mappedFields.filter(field => ['date', 'period_start', 'period_end'].includes(field))),
      ...mappedFields.filter(field => !['sku', 'date', 'period_start', 'period_end'].includes(field)).slice(0, 6),
    ];
  const previewRows = remapped.slice(0, 5);
  const dateCoverage = useMemo(() => {
    let start = '';
    let end = '';
    let invalidRows = 0;
    let datedRows = 0;

    for (const row of remapped) {
      if (source === 'search_queries'
        ? !row.search_query
        : source === 'niche_dynamics'
          ? !row.niche_subject
          : source === 'market_dynamics'
            ? !row.date
          : source === 'reviews'
            ? !row.review_id
            : !(row.sku || row.wb_sku)) continue;
      const rowStart = source === 'profitability'
        ? normalizeImportDate(hasSourceDate ? (row.date || row.period_start || '') : manualDateStart, reportYear)
        : normalizeImportDate(hasSourceDate ? row.date : manualDateStart, reportYear);
      const rowEnd = source === 'profitability'
        ? normalizeImportDate(hasPeriodEndColumn ? row.period_end : (!hasSourceDate ? manualDateEnd : ''), reportYear) || rowStart
        : rowStart;

      if (!rowStart || !rowEnd || rowEnd < rowStart) {
        invalidRows++;
        continue;
      }
      datedRows++;
      if (!start || rowStart < start) start = rowStart;
      if (!end || rowEnd > end) end = rowEnd;
    }

    return { start, end, invalidRows, datedRows };
  }, [remapped, source, hasSourceDate, hasPeriodEndColumn, manualDateStart, manualDateEnd, reportYear]);
  const dateError = dateCoverage.invalidRows > 0
    ? `Некорректная дата или период в ${dateCoverage.invalidRows} строках`
    : '';
  const groupHistoryError = groupHistoryAnalysis?.errors.join(' ') || '';
  const importRowCount = source === 'group_history'
    ? groupHistoryAnalysis?.acceptedRows.length || 0
    : remapped.length;

  return (
    <div className="import-mapper-overlay">
      <div className="import-mapper">
        <div className="import-mapper-header">
          <div className="import-mapper-header-info">
            <h3>Импорт: {parsed.fileName}</h3>
            <span className="import-mapper-rows">{parsed.totalRows} строк</span>
            <span className="import-mapper-summary">
              {mappedCount}/{totalCount} колонок распознано
              {missingRequired.length === 0 && ' v'}
            </span>
          </div>
          <div className="import-mapper-source">
            <label>Источник:</label>
            <select value={source} onChange={e => setSource(e.target.value as ImportSource)}>
              {SOURCE_OPTIONS.map(o => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
            {(source === 'xway' || source === 'profitability') && hasSourceDate && (
              <span className="import-mapper-date-hint">Дата из файла</span>
            )}
            {hasYearlessDates && (
              <span className="import-mapper-date">
                <label>Год отчёта:</label>
                <input
                  type="number"
                  className="daterange-input"
                  min="2000"
                  max="2100"
                  value={reportYear}
                  onChange={e => setReportYear(Number(e.target.value))}
                />
              </span>
            )}
            {(source === 'xway' || source === 'profitability') && !hasSourceDate && (
              <span className="import-mapper-date">
                <label>{source === 'profitability' ? 'Период:' : 'Дата отчёта:'}</label>
                <input type="date" className="daterange-input" value={manualDateStart} onChange={e => setManualDateStart(e.target.value)} />
                {source === 'profitability' && (
                  <>
                    <span>—</span>
                    <input type="date" className="daterange-input" value={manualDateEnd} onChange={e => setManualDateEnd(e.target.value)} />
                  </>
                )}
              </span>
            )}
          </div>
        </div>

        <div className="import-mapper-body">
          {missingRequired.length > 0 && (
            <div className="map-section">
              <div className="map-section-title map-section-error">
                ! Отсутствуют обязательные поля: {missingRequired.map(f => FIELD_LABELS[f]).join(', ')}
              </div>
              <div className="map-section-body">
                <p className="map-error-desc">
                  {source === 'reviews'
                    ? 'Импорт невозможен без кабинета, ID отзыва, даты и количества звёзд.'
                    : source === 'xway'
                    ? 'Импорт невозможен без колонки, содержащей артикул (SKU).'
                    : 'Импорт невозможен без колонок, содержащих артикул (SKU) и дату.'}
                  Убедитесь, что в файле есть соответствующие колонки.
                </p>
              </div>
            </div>
          )}

          {mapping.unmapped.length > 0 && (
            <div className="map-section">
              <div className="map-section-title map-section-ignore">
                Неизвестные колонки ({mapping.unmapped.length}) — будут проигнорированы
              </div>
              <div className="map-unmapped-list">
                {mapping.unmapped.map(h => (
                  <span key={h} className="map-unmapped-tag">{h}</span>
                ))}
              </div>
            </div>
          )}

          {mapping.unmapped.length === 0 && missingRequired.length === 0 && (
            <div className="map-section">
              <div className="map-section-title map-section-ok">
                v Все {mappedCount} колонок распознаны
              </div>
            </div>
          )}

          {source === 'group_history' && groupHistoryAnalysis && (groupHistoryAnalysis.warnings.length > 0 || groupHistoryError) && (
            <div className="map-section">
              <div className={`map-section-title ${groupHistoryError ? 'map-section-error' : 'map-section-warning'}`}>
                {groupHistoryError ? 'Импорт склеек заблокирован' : 'Проверка истории склеек'}
              </div>
              <div className="map-section-body group-history-checks">
                {groupHistoryError && <p className="map-error-desc">{groupHistoryError}</p>}
                {groupHistoryAnalysis.warnings.slice(0, 8).map(message => <p key={message}>{message}</p>)}
                {groupHistoryAnalysis.warnings.length > 8 && <p>Ещё предупреждений: {groupHistoryAnalysis.warnings.length - 8}.</p>}
                {groupHistoryAnalysis.anomalies.length > 0 && (
                  <label className="group-history-confirm">
                    <input
                      type="checkbox"
                      checked={acceptGroupHistoryAnomalies}
                      onChange={event => setAcceptGroupHistoryAnomalies(event.target.checked)}
                    />
                    <span>Подтверждаю все резкие изменения более 15% состава кабинета</span>
                  </label>
                )}
                {groupHistoryAnalysis.excludedRowIndexes.size > 0 && (
                  <p><strong>{groupHistoryAnalysis.excludedRowIndexes.size} строк будут пропущены.</strong> Для них сохранится предыдущее состояние.</p>
                )}
              </div>
            </div>
          )}

          <div className="import-preview">
            <h4>Предпросмотр (первые {previewRows.length} строк)</h4>
            <div className={`import-date-coverage${dateError ? ' error' : ''}`}>
              <span>Покрытие дат</span>
              <strong>
                {dateError || (dateCoverage.start
                  ? `${dateCoverage.start} — ${dateCoverage.end} · ${dateCoverage.datedRows} строк`
                  : 'Дата не определена')}
              </strong>
            </div>
            <div className="import-preview-table-wrap">
              <table className="import-preview-table">
                <thead>
                  <tr>
                    {previewHeaders.map(f => (
                      <th key={f}>{FIELD_LABELS[f]}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {previewRows.map((row, i) => (
                    <tr key={i}>
                      {previewHeaders.map(f => (
                        <td key={f}>{row[f] || ''}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        <div className="import-mapper-footer">
          <div className="import-mapper-status">
            {missingRequired.length > 0 ? (
              <span className="import-mapper-error">Импорт заблокирован — нет обязательных полей</span>
            ) : groupHistoryError ? (
              <span className="import-mapper-error">Импорт заблокирован — проверьте историю склеек</span>
            ) : dateError || dateCoverage.datedRows === 0 ? (
              <span className="import-mapper-error">Импорт заблокирован — проверьте покрытие дат</span>
            ) : (
              <span className="import-mapper-ok">
                v Импорт {importRowCount} строк готов
                {mapping.unmapped.length > 0 && ` (${mapping.unmapped.length} колонок будет проигнорировано)`}
              </span>
            )}
          </div>
          <div className="import-mapper-buttons">
            <button className="dict-btn" onClick={onCancel}>Отмена</button>
            <button
              className="dict-btn dict-btn-primary"
              disabled={missingRequired.length > 0 || Boolean(dateError) || dateCoverage.datedRows === 0 || Boolean(groupHistoryError)}
                onClick={() => {
                const needsDateOverride = (source === 'xway' || source === 'profitability') && !hasSourceDate;
                onConfirm(
                  source,
                  mapping,
                  remapped,
                  needsDateOverride ? manualDateStart : undefined,
                  needsDateOverride && source === 'profitability' ? manualDateEnd : undefined,
                  hasYearlessDates ? reportYear : undefined,
                  source === 'group_history' ? { acceptAnomalies: acceptGroupHistoryAnomalies } : undefined,
                );
              }}
            >
              Импортировать {importRowCount} строк
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
