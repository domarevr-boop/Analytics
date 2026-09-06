import { useState, useSyncExternalStore, type ChangeEvent } from 'react';
import { subscribe, getVersion, getMetrics, getImportLog, clearMetricsRange, resetAllData, deleteImportLogEntry, previewDateMigration, migrateDateRange, clearMetricsAndImports, exportV4Backup, importV4Backup } from '../data/store';
import type { ImportSource, ImportFileLog } from '../types';
import { AnalyticsPageHeader, AnalyticsPanel, EmptyState, PanelHeader, SegmentedControl } from './AnalyticsPrimitives';

type DevTab = 'data' | 'formulas';

const SOURCE_LABELS: Record<string, string> = {
  geography: 'География заказов',
  wb_funnel: 'WB Воронка',
  xway: 'XWay Реклама',
  profitability: 'Рентабельность',
};

const SOURCE_COLORS: Record<string, string> = {
  geography: '#DBEAFE',
  wb_funnel: '#F3F4F6',
  xway: '#F0FDF4',
  profitability: '#FEF9C3',
};

const today = () => new Date().toISOString().slice(0, 10);

export default function DevPage() {
  useSyncExternalStore(subscribe, getVersion);
  const [tab, setTab] = useState<DevTab>('data');
  const [source, setSource] = useState<ImportSource>('xway');
  const [dateFrom, setDateFrom] = useState(today());
  const [dateTo, setDateTo] = useState(today());
  const [migrationStart, setMigrationStart] = useState(today());
  const [migrationEnd, setMigrationEnd] = useState(today());
  const [migrationDays, setMigrationDays] = useState(1);
  const [resultMsg, setResultMsg] = useState('');
  const logs = getImportLog();
  const metrics = getMetrics();
  const metricCount = metrics.length;

  const handleClearRange = () => {
    const n = clearMetricsRange(source, dateFrom, dateTo);
    setResultMsg(`Очищено ${n} метрик для ${SOURCE_LABELS[source]} за ${dateFrom} — ${dateTo}`);
  };

  const handleDateMigration = () => {
    const preview = previewDateMigration(migrationStart, migrationEnd, migrationDays);
    if (preview.conflicts > 0 || preview.partialRecords > 0) {
      setResultMsg(
        `Миграция остановлена: конфликтов ${preview.conflicts}, частично попавших периодов ${preview.partialRecords}.`,
      );
      return;
    }
    const confirmed = confirm(
      `Сдвинуть даты на ${migrationDays} дн.? Метрики: ${preview.metrics}, рентабельность: ${preview.profitability}, журналы: ${preview.importLogs}.`,
    );
    if (!confirmed) return;

    const result = migrateDateRange(migrationStart, migrationEnd, migrationDays);
    setResultMsg(
      result.applied
        ? `Миграция выполнена: метрики ${result.metrics}, рентабельность ${result.profitability}, журналы ${result.importLogs}.`
        : 'Миграция не выполнена.',
    );
  };

  const handleResetAll = () => {
    if (!confirm('Удалить ВСЕ данные? Справочники, метрики, планы. Отменить нельзя.')) return;
    resetAllData();
    setResultMsg('Все данные сброшены. Страница будет перезагружена.');
    setTimeout(() => location.reload(), 1500);
  };

  const handleDeleteLog = (log: ImportFileLog) => {
    const msg = log.dataStart
      ? `Удалить импорт "${log.fileName}" и очистить ${log.rowCount} метрик за период ${log.dataStart}—${log.dataEnd || log.dataStart}?`
      : `Удалить импорт "${log.fileName}" и все данные рекламы XWAY?`;
    if (confirm(msg)) {
      deleteImportLogEntry(log.id);
      setResultMsg(`Импорт ${log.fileName} удалён`);
    }
  };

  const handleExportBackup = () => {
    const backup = exportV4Backup();
    const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `analytics-v4-backup-${backup.exportedAt.slice(0, 10)}.json`;
    link.click();
    URL.revokeObjectURL(url);
    setResultMsg('Резервная копия V4 скачана. Сохраните файл до включения V5.');
  };

  const handleImportBackup = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (!confirm('Загрузить снимок V4 в текущую базу? Данные ядра Supabase будут обновлены из этого файла.')) return;
    try {
      const backup = JSON.parse(await file.text()) as unknown;
      const result = await importV4Backup(backup);
      setResultMsg(`Снимок загружен: ${result.products.toLocaleString('ru-RU')} товаров и ${result.metrics.toLocaleString('ru-RU')} метрик. Обновите страницу.`);
    } catch (error) {
      setResultMsg(`Ошибка загрузки снимка: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  const renderFormulas = () => (
    <div className="dev-formulas">
      <AnalyticsPanel className="dev-panel dev-table-panel" density="data">
        <div className="dev-panel-heading"><PanelHeader eyebrow="Контракт данных" title="Источники данных" description="Владение полями ежедневных метрик" /></div>
        <div className="dev-table-wrap"><table className="dev-table">
          <thead>
            <tr>
              <th>Источник</th>
              <th>Какие поля пишет</th>
              <th>Описание</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td><span className="dev-badge" style={{background:'#e9f2ff'}}>WB Воронка</span></td>
              <td><code>impressions, clicks, carts, orders, buyouts, cancellations, ordered_amount, buyout_amount, cancellation_amount</code></td>
              <td>Ежедневные данные по воронке продаж WB</td>
            </tr>
            <tr>
              <td><span className="dev-badge" style={{background:'#f0fdf4'}}>XWay</span></td>
              <td><code>ad_impressions, ad_clicks, ad_orders, ad_spend</code></td>
              <td>Рекламные метрики (показы, клики, заказы, расход)</td>
            </tr>
            <tr>
              <td><span className="dev-badge" style={{background:'#fef9e7'}}>Рентабельность</span></td>
              <td><code>actual_profit, actual_margin</code></td>
              <td>Фактическая прибыль и маржа по товарам</td>
            </tr>
          </tbody>
        </table></div>
      </AnalyticsPanel>

      <AnalyticsPanel className="dev-panel dev-table-panel" density="data">
        <div className="dev-panel-heading"><PanelHeader eyebrow="Расчёты" title="Формулы метрик" description="Технический справочник производных показателей" /></div>
        <div className="dev-table-wrap"><table className="dev-table">
          <thead>
            <tr>
              <th>Метрика (MetricValues)</th>
              <th>Формула</th>
              <th>Источник данных</th>
            </tr>
          </thead>
          <tbody>
            <tr><td><code>impressions</code></td><td><code>sum(impressions)</code></td><td>DailyMetrics (WB)</td></tr>
            <tr><td><code>clicks</code></td><td><code>sum(clicks)</code></td><td>DailyMetrics (WB)</td></tr>
            <tr><td><code>ctr</code></td><td><code>clicks / impressions * 100</code></td><td>&nbsp;</td></tr>
            <tr><td><code>carts</code></td><td><code>sum(carts)</code></td><td>DailyMetrics (WB)</td></tr>
            <tr><td><code>cr_cart</code></td><td><code>carts / impressions * 100</code></td><td>&nbsp;</td></tr>
            <tr><td><code>orders</code></td><td><code>sum(orders)</code></td><td>DailyMetrics (WB)</td></tr>
            <tr><td><code>cr_order</code></td><td><code>orders / impressions * 100</code></td><td>&nbsp;</td></tr>
            <tr><td><code>ad_spend</code></td><td><code>sum(ad_spend)</code></td><td>DailyMetrics (XWay)</td></tr>
            <tr><td><code>ad_clicks</code></td><td><code>sum(ad_clicks)</code></td><td>DailyMetrics (XWay)</td></tr>
            <tr><td><code>ad_orders</code></td><td><code>sum(ad_orders)</code></td><td>DailyMetrics (XWay)</td></tr>
            <tr><td><code>cpc</code></td><td><code>ad_spend / ad_clicks</code></td><td>&nbsp;</td></tr>
            <tr><td><code>cpo</code></td><td><code>ad_spend / ad_orders</code></td><td>&nbsp;</td></tr>
            <tr><td><code>drr</code></td><td><code>ad_spend / ordered_amount * 100</code></td><td>&nbsp;</td></tr>
            <tr><td><code>plan_orders</code></td><td><code>sum(totalRubles)</code></td><td>MonthlyPlanRecord</td></tr>
            <tr><td><code>fact_orders</code></td><td><code>sum(ordered_amount)</code></td><td>DailyMetrics (WB)</td></tr>
            <tr><td><code>plan_pct</code></td><td><code>fact_orders / plan_orders * 100</code></td><td>&nbsp;</td></tr>
            <tr><td><code>revenue</code></td><td><code>sum(buyout_amount)</code></td><td>DailyMetrics (WB)</td></tr>
            <tr><td><code>effectiveRevenue</code></td><td><code>ordered_amount * buyoutRate / 100</code></td><td>&nbsp;</td></tr>
            <tr><td><code>profit</code></td><td><code>sum(actual_profit)</code></td><td>DailyMetrics (Рентаб)</td></tr>
            <tr><td><code>margin</code></td><td><code>profit / revenue * 100</code></td><td>&nbsp;</td></tr>
            <tr><td><code>stock</code></td><td><code>avg(stock)</code></td><td>DailyMetrics (WB)</td></tr>
          </tbody>
        </table></div>
      </AnalyticsPanel>

      <AnalyticsPanel className="dev-panel dev-code-panel">
        <PanelHeader eyebrow="Схема" title="Структура DailyMetrics" description="Ключевые поля локальной ежедневной записи" />
        <pre className="dev-code">{`interface DailyMetrics {
  date: string;           // YYYY-MM-DD
  product_id: string;     // ссылка на Product.id
  // WB воронка:
  impressions: number;    clicks: number;    carts: number;
  orders: number;         buyouts: number;   cancellations: number;
  ordered_amount: number; buyout_amount: number; cancellation_amount: number;
  // XWay:
  ad_impressions: number; ad_clicks: number;
  ad_orders: number;      ad_spend: number;
  // Рентабельность:
  actual_profit: number;  actual_margin: number;
  // Прочее:
  stock: number;          plan_orders: number;
  forecast_profit_per_order: number;
}`}</pre>
      </AnalyticsPanel>
    </div>
  );

  return (
    <div className="dev-page analytics-page-shell ds-page dev-design-page">
      <AnalyticsPageHeader eyebrow="Система" title="Разработка" description="Диагностика данных, резервные копии, миграции и технические операции." actions={<SegmentedControl value={tab} label="Раздел страницы разработки" options={[{ value: 'data', label: 'Данные' }, { value: 'formulas', label: 'Формулы' }]} onChange={setTab} />} />

      {resultMsg && <div className="dev-toast" role="status">{resultMsg}</div>}

      {tab === 'data' ? (
        <div className="dev-data">
          <AnalyticsPanel className="dev-panel dev-backup-panel">
            <PanelHeader eyebrow="Сохранность" title="Резервная копия V4" />
            <p className="dev-hint">Сохраняет локальные данные, планы, рентабельность, аналитику и постоянные расходы в JSON-файл. Создайте копию до первого запуска V5.</p>
            <div className="dev-panel-actions"><button className="dev-btn" onClick={handleExportBackup}>Скачать резервную копию</button>
            <label className="dev-btn">
              Загрузить снимок V4 в Supabase
              <input type="file" accept="application/json,.json" onChange={handleImportBackup} hidden />
            </label></div>
          </AnalyticsPanel>

          <AnalyticsPanel className="dev-panel">
            <PanelHeader eyebrow="Миграция" title="Сдвиг диапазона дат" description="Применяется только после проверки конфликтов" />
            <div className="dev-clear-form">
              <label>С <input type="date" value={migrationStart} onChange={e => setMigrationStart(e.target.value)} /></label>
              <label>по <input type="date" value={migrationEnd} onChange={e => setMigrationEnd(e.target.value)} /></label>
              <label>
                Сдвиг, дней
                <input
                  type="number"
                  min="-31"
                  max="31"
                  value={migrationDays}
                  onChange={e => setMigrationDays(Number(e.target.value))}
                />
              </label>
              <button className="dev-btn dev-btn-danger" onClick={handleDateMigration}>
                Проверить и применить
              </button>
            </div>
            <div className="dev-hint">
              Миграция изменяет DailyMetrics, старые записи рентабельности и границы журналов импорта. При конфликте дат операция не выполняется.
            </div>
          </AnalyticsPanel>

          <AnalyticsPanel className="dev-panel">
            <PanelHeader eyebrow="Обслуживание" title="Очистка метрик по источнику и датам" description={`Всего метрик в БД: ${metricCount.toLocaleString('ru-RU')}`} />
            <div className="dev-clear-form">
              <select value={source} onChange={e => setSource(e.target.value as ImportSource)}>
                <option value="wb_funnel">WB Воронка</option>
                <option value="xway">XWay Реклама</option>
                <option value="profitability">Рентабельность</option>
              </select>
              <label>c <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} /></label>
              <label>по <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} /></label>
              <button className="dev-btn dev-btn-danger" onClick={handleClearRange}>
                Очистить
              </button>
            </div>
          </AnalyticsPanel>

          <AnalyticsPanel className="dev-panel dev-import-history dev-table-panel" density="data">
            <div className="dev-panel-heading"><PanelHeader eyebrow="Аудит" title="История импортов" description={`${logs.length} записей`} /></div>
            {logs.length === 0 ? (
              <EmptyState title="История пуста" description="Записи появятся после импорта локальных отчётов." />
            ) : (
              <div className="dev-table-wrap"><table className="dev-table">
                <thead>
                  <tr>
                    <th>Файл</th>
                    <th>Источник</th>
                    <th>Строк</th>
                    <th>Период</th>
                    <th>Статус</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {logs.map(log => (
                    <tr key={log.id}>
                      <td className="dev-cell-file">{log.fileName}</td>
                      <td>
                        <span className="dev-badge" style={{background: SOURCE_COLORS[log.source] || '#F3F4F6'}}>
                          {SOURCE_LABELS[log.source] || log.source}
                        </span>
                      </td>
                      <td>{log.rowCount.toLocaleString('ru-RU')}</td>
                      <td>{log.dataStart ? `${log.dataStart} — ${log.dataEnd || log.dataStart}` : '—'}</td>
                      <td>{log.status}</td>
                      <td>
                        <button className="dev-btn-sm dev-btn-danger" onClick={() => handleDeleteLog(log)}>
                          x
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table></div>
            )}
          </AnalyticsPanel>

          <AnalyticsPanel className="dev-panel dev-danger-zone">
            <PanelHeader eyebrow="Очистка" title="Очистить метрики" />
            <p className="dev-hint">Удалить только метрики и импорты. Справочники (кабинеты, товары) останутся.</p>
            <button className="dev-btn dev-btn-danger" onClick={() => {
              if (!confirm('Удалить метрики и импорты? Справочники останутся.')) return;
              clearMetricsAndImports();
              setResultMsg('Метрики и импорты очищены.');
            }}>
              Очистить метрики
            </button>
          </AnalyticsPanel>

          <AnalyticsPanel className="dev-panel dev-danger-zone dev-danger-zone-critical">
            <PanelHeader eyebrow="Необратимое действие" title="Сбросить все данные" />
            <p className="dev-hint">Полный сброс всех данных: справочники, метрики, планы. После сброса страница перезагрузится.</p>
            <button className="dev-btn dev-btn-danger" onClick={handleResetAll}>
              Сбросить все данные
            </button>
          </AnalyticsPanel>
        </div>
      ) : (
        renderFormulas()
      )}
    </div>
  );
}
