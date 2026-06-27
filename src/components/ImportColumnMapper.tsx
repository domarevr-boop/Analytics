import { useMemo, useState } from 'react';
import type { ParsedFile } from '../data/parseFile';
import { autoDetectMapping, remapRows, FIELD_LABELS, getRequiredFields, detectSourceFromHeaders } from '../data/columnMapping';
import type { ColumnMapping } from '../data/columnMapping';
import type { ImportSource } from '../types';
import { getCabinets, detectSourceFromFilename } from '../data/store';

const SOURCE_OPTIONS: { value: ImportSource; label: string }[] = [
  { value: 'wb_funnel', label: 'WB Воронка' },
  { value: 'xway', label: 'XWay Реклама' },
  { value: 'profitability', label: 'Рентабельность' },
];

interface Props {
  parsed: ParsedFile;
  onConfirm: (source: ImportSource, mapping: ColumnMapping, remapped: Record<string, string>[], dateOverride?: string, cabinetId?: string, cabinetName?: string) => void;
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
  const [source, setSource] = useState<ImportSource>(() => detectSourceFromHeaders(parsed.headers) || detectSourceFromFilename(parsed.fileName));
  const [xwayDate, setXwayDate] = useState(todayStr);
  const [cabinetId, setCabinetId] = useState('');
  const cabinets = getCabinets();

  const mapping = useMemo(() => autoDetectMapping(parsed.headers, source), [parsed.headers, source]);
  const required = useMemo(() => getRequiredFields(source), [source]);

  const finalMap = mapping.map;
  const remapped = useMemo(() => remapRows(parsed.rows, finalMap), [parsed.rows, finalMap]);

  console.log('[ImportColumnMapper] render:', { source, xwayDate, totalRows: parsed.totalRows, finalMap, unmapped: mapping.unmapped, remappedLen: remapped.length });
  if (remapped.length > 0) console.log('[ImportColumnMapper] first remapped:', remapped[0]);

  const mappedFields = Object.values(finalMap);
  const hasDateColumn = mappedFields.includes('date');
  const mappedCount = Object.keys(finalMap).length;
  const totalCount = parsed.headers.length;
  const missingRequired = required.filter(f => !mappedFields.includes(f));
  const missingCabinet = source !== 'profitability' && !cabinetId;

  const previewHeaders = ['sku', ...(source === 'xway' && !hasDateColumn ? [] : ['date']), ...mappedFields.filter(f => f !== 'sku' && f !== 'date').slice(0, 6)];
  const previewRows = remapped.slice(0, 5);

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
            {source !== 'profitability' && (
              <span className="import-mapper-cabinet">
                <label>Кабинет:</label>
                <select value={cabinetId} onChange={e => setCabinetId(e.target.value)}>
                  <option value="">— Выберите кабинет —</option>
                  {cabinets.map(c => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              </span>
            )}
            {source === 'xway' && hasDateColumn && (
              <span className="import-mapper-date-hint">Дата из файла</span>
            )}
            {source === 'xway' && !hasDateColumn && (
              <span className="import-mapper-date">
                <label>Дата отчёта:</label>
                <input type="date" className="daterange-input" value={xwayDate} onChange={e => setXwayDate(e.target.value)} />
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
                  {source === 'xway'
                    ? 'Импорт невозможен без колонки, содержащей артикул (SKU).'
                    : 'Импорт невозможен без колонок, содержащих артикул (SKU) и дату.'}
                  Убедитесь, что в файле есть соответствующие колонки.
                </p>
              </div>
            </div>
          )}

          {missingCabinet && (
            <div className="map-section">
              <div className="map-section-title map-section-error">
                ! Не выбран кабинет
              </div>
              <div className="map-section-body">
                <p className="map-error-desc">Выберите кабинет, к которому относятся данные в файле.</p>
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

          {mapping.unmapped.length === 0 && missingRequired.length === 0 && !missingCabinet && (
            <div className="map-section">
              <div className="map-section-title map-section-ok">
                v Все {mappedCount} колонок распознаны
              </div>
            </div>
          )}

          <div className="import-preview">
            <h4>Предпросмотр (первые {previewRows.length} строк)</h4>
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
            ) : missingCabinet ? (
              <span className="import-mapper-error">Импорт заблокирован — не выбран кабинет</span>
            ) : (
              <span className="import-mapper-ok">
                v Импорт {remapped.length} строк готов
                {mapping.unmapped.length > 0 && ` (${mapping.unmapped.length} колонок будет проигнорировано)`}
              </span>
            )}
          </div>
          <div className="import-mapper-buttons">
            <button className="dict-btn" onClick={onCancel}>Отмена</button>
            <button
              className="dict-btn dict-btn-primary"
              disabled={missingRequired.length > 0 || missingCabinet}
              onClick={() => {
                const c = cabinets.find(c => c.id === cabinetId);
                onConfirm(source, mapping, remapped, source === 'xway' && !hasDateColumn ? xwayDate : undefined, cabinetId || undefined, c?.name);
              }}
            >
              Импортировать {remapped.length} строк
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
