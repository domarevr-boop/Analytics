import { useState, useSyncExternalStore } from 'react';
import { subscribe, getVersion, getMetrics, getImportLog, clearMetricsRange, resetAllData, deleteImportLogEntry } from '../data/store';
import type { ImportSource, ImportFileLog } from '../types';

type DevTab = 'data' | 'formulas';

const SOURCE_LABELS: Record<string, string> = {
  wb_funnel: 'WB Воронка',
  xway: 'XWay Реклама',
  profitability: 'Рентабельность',
};

const SOURCE_COLORS: Record<string, string> = {
  wb_funnel: '#e9f2ff',
  xway: '#f0fdf4',
  profitability: '#fef9e7',
};

const today = () => new Date().toISOString().slice(0, 10);

export default function DevPage() {
  useSyncExternalStore(subscribe, getVersion);
  const [tab, setTab] = useState<DevTab>('data');
  const [source, setSource] = useState<ImportSource>('xway');
  const [dateFrom, setDateFrom] = useState(today());
  const [dateTo, setDateTo] = useState(today());
  const [resultMsg, setResultMsg] = useState('');
  const logs = getImportLog();
  const metrics = getMetrics();
  const metricCount = metrics.length;

  const handleClearRange = () => {
    const n = clearMetricsRange(source, dateFrom, dateTo);
    setResultMsg(`Очищено ${n} метрик для ${SOURCE_LABELS[source]} за ${dateFrom} — ${dateTo}`);
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

  const renderFormulas = () => (
    <div className="dev-formulas">
      <section>
        <h3 className="dev-section-title">Источники данных</h3>
        <table className="dev-table">
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
        </table>
      </section>

      <section>
        <h3 className="dev-section-title">Формулы метрик</h3>
        <table className="dev-table">
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
        </table>
      </section>

      <section>
        <h3 className="dev-section-title">Структура DailyMetrics</h3>
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
      </section>
    </div>
  );

  return (
    <div className="dev-page">
      <div className="dev-tabs">
        <span className={`dev-tab ${tab === 'data' ? 'active' : ''}`} onClick={() => setTab('data')}>
          Данные
        </span>
        <span className={`dev-tab ${tab === 'formulas' ? 'active' : ''}`} onClick={() => setTab('formulas')}>
          Формулы
        </span>
      </div>

      {resultMsg && <div className="dev-toast">{resultMsg}</div>}

      {tab === 'data' ? (
        <div className="dev-data">
          <section>
            <h3 className="dev-section-title">Очистка метрик по источнику и датам</h3>
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
            <div className="dev-hint">
              Всего метрик в БД: <strong>{metricCount.toLocaleString('ru-RU')}</strong>
            </div>
          </section>

          <section>
            <h3 className="dev-section-title">История импортов</h3>
            {logs.length === 0 ? (
              <div className="dev-hint">История пуста</div>
            ) : (
              <table className="dev-table">
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
                        <span className="dev-badge" style={{background: SOURCE_COLORS[log.source] || '#eee'}}>
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
              </table>
            )}
          </section>

          <section className="dev-danger-zone">
            <h3 className="dev-section-title">Опасная зона</h3>
            <p className="dev-hint">Полный сброс всех данных: справочники, метрики, планы. После сброса страница перезагрузится.</p>
            <button className="dev-btn dev-btn-danger" onClick={handleResetAll}>
              Сбросить все данные
            </button>
          </section>
        </div>
      ) : (
        renderFormulas()
      )}
    </div>
  );
}
