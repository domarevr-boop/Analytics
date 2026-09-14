import { useEffect, useMemo, useState } from 'react';
import { CartesianGrid, Cell, Line, LineChart, ResponsiveContainer, Scatter, ScatterChart, Tooltip, XAxis, YAxis, ZAxis } from 'recharts';
import DateRangeFilter from '../../components/DateRangeFilter';
import { AnalyticsPageHeader, AnalyticsPanel, AnalyticsToolbar, EmptyState, KpiTile, PanelHeader } from '../../components/AnalyticsPrimitives';
import { loadFunnelBounds, loadFunnelFilterOptions, loadFunnelRows, loadFunnelSeries, loadFunnelSummary } from '../../features/funnel/funnelData';
import { calculateFunnelRates, type FunnelFilterOptions, type FunnelFilters, type FunnelMetrics, type FunnelRow, type FunnelSeriesRow, type FunnelSort, type FunnelSummary } from '../../features/funnel/funnelDataCore';

const EMPTY_METRICS: FunnelMetrics = { impressions: 0, clicks: 0, carts: 0, orders: 0, orderedAmount: 0, adImpressions: 0, adClicks: 0, adOrdersQty: 0, adOrderedAmount: 0, adSpend: 0 };
const EMPTY_SUMMARY: FunnelSummary = { ...EMPTY_METRICS, productCount: 0 };
const EMPTY_OPTIONS: FunnelFilterOptions = { cabinets: [], categories: [], brands: [], groups: [] };
const nf = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 1 });
const compact = new Intl.NumberFormat('ru-RU', { notation: 'compact', maximumFractionDigits: 1 });
const money = (value: number) => `${nf.format(value)} ₽`;
const percent = (value: number) => `${nf.format(value)}%`;

function shiftDate(value: string, days: number) { const date = new Date(`${value}T00:00:00Z`); date.setUTCDate(date.getUTCDate() + days); return date.toISOString().slice(0, 10); }
function ids(value: string) { return value ? [value] : null; }

export default function FunnelServerPage() {
  const today = useMemo(() => new Date().toISOString().slice(0, 10), []);
  const [period, setPeriod] = useState({ start: shiftDate(today, -731), end: today });
  const [bounds, setBounds] = useState({ minDate: '', maxDate: '' });
  const [options, setOptions] = useState(EMPTY_OPTIONS);
  const [summary, setSummary] = useState(EMPTY_SUMMARY);
  const [series, setSeries] = useState<FunnelSeriesRow[]>([]);
  const [analysisRows, setAnalysisRows] = useState<FunnelRow[]>([]);
  const [tableRows, setTableRows] = useState<FunnelRow[]>([]);
  const [cabinet, setCabinet] = useState(''); const [category, setCategory] = useState(''); const [brand, setBrand] = useState(''); const [group, setGroup] = useState('');
  const [search, setSearch] = useState(''); const [appliedSearch, setAppliedSearch] = useState('');
  const [sort, setSort] = useState<FunnelSort>('ordered_amount'); const [page, setPage] = useState(0);
  const [ready, setReady] = useState(false); const [loading, setLoading] = useState(true); const [error, setError] = useState(''); const [request, setRequest] = useState(0);
  const pageSize = 50;

  useEffect(() => {
    let active = true; queueMicrotask(() => { if (active) { setLoading(true); setError(''); } });
    loadFunnelBounds().then(value => {
      if (!active) return;
      if (value.minDate && value.maxDate) { setBounds({ minDate: value.minDate, maxDate: value.maxDate }); setPeriod({ start: value.minDate, end: value.maxDate }); }
      setReady(true);
    }).catch(reason => { if (active) setError(reason instanceof Error ? reason.message : 'Не удалось определить период воронки'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [request]);

  useEffect(() => {
    if (!ready) return;
    let active = true;
    const filters: FunnelFilters = { start: period.start, end: period.end, cabinetIds: ids(cabinet), categoryIds: ids(category), brandIds: ids(brand), groupIds: ids(group), search: appliedSearch || null };
    queueMicrotask(() => { if (active) { setLoading(true); setError(''); } });
    Promise.all([loadFunnelFilterOptions(filters), loadFunnelSummary(filters), loadFunnelSeries(filters), loadFunnelRows(filters, 'ordered_amount', 0, 1000), loadFunnelRows(filters, sort, page * pageSize, pageSize)])
      .then(([nextOptions, nextSummary, nextSeries, nextAnalysis, nextTable]) => {
        if (!active) return; setOptions(nextOptions); setSummary(nextSummary); setSeries(nextSeries); setAnalysisRows(nextAnalysis); setTableRows(nextTable);
      }).catch(reason => {
        if (!active) return; setSummary(EMPTY_SUMMARY); setSeries([]); setAnalysisRows([]); setTableRows([]); setError(reason instanceof Error ? reason.message : 'Не удалось загрузить серверную воронку');
      }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [appliedSearch, brand, cabinet, category, group, page, period.end, period.start, ready, sort]);

  const rates = useMemo(() => calculateFunnelRates(summary), [summary]);
  const plotted = useMemo(() => analysisRows.slice(0, 250).map(row => ({ ...row, ...calculateFunnelRates(row) })), [analysisRows]);
  const segments = useMemo(() => [[0, 1000], [1000, 2000], [2000, 4000], [4000, Infinity]].map(([from, to]) => {
    const rows = analysisRows.filter(row => { const avg = calculateFunnelRates(row).avgPrice; return avg >= from && avg < to; });
    const orders = rows.reduce((sum, row) => sum + row.orders, 0); const amount = rows.reduce((sum, row) => sum + row.orderedAmount, 0);
    return { label: `${nf.format(from)}–${to === Infinity ? '∞' : nf.format(to)} ₽`, products: rows.length, orderShare: summary.orders ? orders / summary.orders * 100 : 0, amountShare: summary.orderedAmount ? amount / summary.orderedAmount * 100 : 0 };
  }), [analysisRows, summary]);
  const totalCount = tableRows[0]?.totalCount || 0; const pageCount = Math.max(1, Math.ceil(totalCount / pageSize));
  const stages = [
    ['Показы', summary.impressions, `CTR ${percent(rates.ctr)}`], ['Переходы', summary.clicks, `CR корзины ${percent(rates.cartCr)}`],
    ['Корзины', summary.carts, `CR заказа ${percent(rates.orderCr)}`], ['Заказы', summary.orders, `Средний чек ${money(rates.avgPrice)}`],
    ['Заказано', summary.orderedAmount, `CR показ → заказ ${percent(rates.impressionOrderCr)}`],
  ] as const;

  return <section className="funnel-page funnel-page-v2 analytics-page-shell ds-page">
    <AnalyticsPageHeader eyebrow="Аналитика › Трафик" title="Воронка продаж" description="Серверные WB-этапы и XWay-реклама с раздельными заказами в штуках и рублях." meta={<span>V5 · Supabase{bounds.maxDate ? ` · данные по ${bounds.maxDate}` : ''}</span>} />
    <AnalyticsToolbar className="funnel-toolbar" status={<span>Частичные импорты разрешаются по последнему непустому значению каждой метрики</span>} trailing={<button className="ds-button" type="button" onClick={() => { setCabinet(''); setCategory(''); setBrand(''); setGroup(''); setSearch(''); setAppliedSearch(''); setSort('ordered_amount'); setPage(0); if (bounds.minDate) setPeriod({ start: bounds.minDate, end: bounds.maxDate }); }}>Сбросить</button>}>
      <DateRangeFilter label="Период" value={period} onChange={value => { setPeriod(value); setPage(0); }} maxDate={bounds.maxDate || today} />
      {[['Кабинет', cabinet, setCabinet, options.cabinets], ['Категория', category, setCategory, options.categories], ['Бренд', brand, setBrand, options.brands], ['Склейка', group, setGroup, options.groups]].map(([label, value, setter, items]) => <select key={String(label)} aria-label={String(label)} value={String(value)} onChange={event => { (setter as (value: string) => void)(event.target.value); setPage(0); }}><option value="">Все: {String(label).toLocaleLowerCase('ru-RU')}</option>{(items as FunnelFilterOptions['cabinets']).map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select>)}
      <form className="entry-server-search" onSubmit={event => { event.preventDefault(); setAppliedSearch(search.trim()); setPage(0); }}><input aria-label="Поиск товара" value={search} onChange={event => setSearch(event.target.value)} placeholder="SKU или товар" /><button className="ds-button" type="submit">Найти</button></form>
    </AnalyticsToolbar>

    {loading ? <EmptyState title="Загрузка воронки V5" description="Получаем ограниченные серверные агрегаты и строки." /> : error ? <EmptyState title="Не удалось загрузить «Воронку» V5" description={error} action={<button className="ds-button" type="button" onClick={() => { setReady(false); setRequest(value => value + 1); }}>Повторить</button>} /> : !summary.productCount ? <EmptyState title="Нет опубликованной воронки" description="Импортируйте WB-воронку и XWay в V5 или измените фильтры." /> : <>
      <AnalyticsPanel className="funnel-overview"><PanelHeader title="Воронка продаж" description={`${nf.format(summary.productCount)} товаров в выбранном срезе`} /><div className="funnel-stage-row">{stages.map(([label, value, detail], index) => <div className="funnel-stage-wrap" key={label}><div className={`funnel-stage ${['blue', 'sky', 'teal', 'green', 'lime'][index]}`}><span>{index + 1}. {label}</span><strong>{index === 4 ? money(value) : compact.format(value)}</strong></div><small>{detail}</small></div>)}</div></AnalyticsPanel>
      <section className="ds-kpi-grid"><KpiTile label="Рекламный расход" value={money(summary.adSpend)} details={`${nf.format(summary.adClicks)} кликов`} /><KpiTile label="Рекламные заказы" value={nf.format(summary.adOrdersQty)} details={`${money(summary.adOrderedAmount)} заказано`} /><KpiTile label="CPO" value={money(rates.cpo)} details="Расход ÷ заказы, шт" /><KpiTile label="ДРР" value={percent(rates.drr)} details="Расход ÷ заказы, руб" /></section>
      <div className="funnel-analysis-grid">
        <AnalyticsPanel className="funnel-map-card"><PanelHeader title="Матрица эффективности" description={`До ${Math.min(250, plotted.length)} лидеров по сумме заказов`} /><ResponsiveContainer width="100%" height={320}><ScatterChart><CartesianGrid strokeDasharray="3 3" /><XAxis type="number" dataKey="impressions" tickFormatter={value => compact.format(Number(value))} /><YAxis type="number" dataKey="impressionOrderCr" unit="%" /><ZAxis dataKey="orderedAmount" range={[40, 700]} /><Tooltip formatter={value => nf.format(Number(value))} /><Scatter data={plotted}>{plotted.map(row => <Cell key={`${row.productId}:${row.groupId || ''}`} fill={row.cpo > rates.cpo ? '#E9735A' : '#1A9D78'} />)}</Scatter></ScatterChart></ResponsiveContainer></AnalyticsPanel>
        <AnalyticsPanel><PanelHeader title="Динамика" description="Заказы и рекламные расходы по дням" /><ResponsiveContainer width="100%" height={320}><LineChart data={series}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="date" tickFormatter={value => String(value).slice(5)} minTickGap={28} /><YAxis yAxisId="orders" /><YAxis yAxisId="spend" orientation="right" /><Tooltip formatter={value => nf.format(Number(value))} /><Line yAxisId="orders" dataKey="orders" name="Заказы, шт" stroke="#2563EB" dot={false} /><Line yAxisId="spend" dataKey="adSpend" name="Расход, ₽" stroke="#E9735A" dot={false} /></LineChart></ResponsiveContainer></AnalyticsPanel>
      </div>
      <AnalyticsPanel className="funnel-segments-card"><PanelHeader title="Ценовые сегменты" description={`Расчёт по ${analysisRows.length} лидерам bounded-среза; доли — от полной серверной сводки`} /><div className="funnel-segment-grid">{segments.map(segment => <article key={segment.label}><header><div><strong>{segment.label}</strong><small>{segment.products} строк товаров/склеек</small></div></header><dl><div><dt>Доля заказов</dt><dd>{percent(segment.orderShare)}</dd></div><div><dt>Доля суммы</dt><dd>{percent(segment.amountShare)}</dd></div></dl></article>)}</div></AnalyticsPanel>
      <AnalyticsPanel className="entry-table-card" density="data"><PanelHeader title="Товары и датированные склейки" description={`${totalCount} строк · серверная сортировка`} controls={<select aria-label="Сортировка" value={sort} onChange={event => { setSort(event.target.value as FunnelSort); setPage(0); }}><option value="ordered_amount">Сумма заказов</option><option value="orders">Заказы</option><option value="impressions">Показы</option><option value="ctr">CTR</option><option value="order_cr">CR заказа</option><option value="ad_spend">Расход</option><option value="cpo">CPO</option><option value="drr">ДРР</option></select>} /><div className="entry-table-wrap"><table><thead><tr><th>Кабинет / склейка / товар</th><th>Показы</th><th>Клики</th><th>Корзины</th><th>Заказы</th><th>Заказано</th><th>Расход</th><th>CPO</th><th>ДРР</th></tr></thead><tbody>{tableRows.map(row => { const rowRates = calculateFunnelRates(row); return <tr key={`${row.productId}:${row.groupId || ''}`}><td><strong>{row.sellerSku || row.wbSku || row.productId}</strong><small>{row.cabinetName} · {row.groupName || 'Без склейки'} · {row.productName}</small></td><td>{nf.format(row.impressions)}</td><td>{nf.format(row.clicks)}</td><td>{nf.format(row.carts)}</td><td>{nf.format(row.orders)}</td><td>{money(row.orderedAmount)}</td><td>{money(row.adSpend)}</td><td>{money(rowRates.cpo)}</td><td>{percent(rowRates.drr)}</td></tr>; })}</tbody></table></div><footer className="funnel-table-footer"><span>Страница {page + 1} из {pageCount}</span><div><button type="button" disabled={page === 0} onClick={() => setPage(value => Math.max(0, value - 1))}>←</button><button type="button" disabled={page + 1 >= pageCount} onClick={() => setPage(value => value + 1)}>→</button></div></footer></AnalyticsPanel>
    </>}
  </section>;
}
