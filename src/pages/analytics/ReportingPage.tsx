import { useMemo, useState, useSyncExternalStore } from 'react';
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import AnalyticsHelp from '../../components/AnalyticsHelp';
import { AnalyticsPageHeader, AnalyticsToolbar, EmptyState, KpiTile as CommonKpiTile, SegmentedControl } from '../../components/AnalyticsPrimitives';
import DateRangeFilter from '../../components/DateRangeFilter';
import { getCabinetExtraExpense, getExtraExpensesVersion, subscribeExtraExpenses } from '../../data/profitStore';
import { getCabinets, getMarketDynamics, getMetrics, getProducts, getProfitabilityRecords, getVersion, subscribe } from '../../data/store';
import type { Cabinet, DailyMetrics, Product } from '../../types';
import {
  aggregateMarket,
  aggregateOwnMetrics,
  formatPeriod,
  getPercentDelta,
  getPointsDelta,
  normalizeSeries,
  previousPeriod,
  summarizeFinance,
  summarizeMarket,
  summarizeOwnMetrics,
  type FinanceSummary,
  type MarketPoint,
  type OwnPoint,
  type OwnSummary,
  type ReportingGranularity,
  type ReportingPeriod,
} from '../../data/reportingCalculations';
import { reportingHelp } from './analyticsHelpContent';

type OwnMetric = 'orderedAmount' | 'orders' | 'adSpend' | 'drr';
type MarketView = 'index' | 'absolute' | 'share';

const ownMetricMeta: Record<OwnMetric, { label: string; color: string; format: (value: number) => string }> = {
  orderedAmount: { label: 'Заказы, ₽', color: '#2563EB', format: value => formatMoney(value) },
  orders: { label: 'Заказы, шт.', color: '#10A778', format: value => formatNumber(value) },
  adSpend: { label: 'Рекламные расходы', color: '#8B5CF6', format: value => formatMoney(value) },
  drr: { label: 'ДРР', color: '#E59B18', format: value => formatPercent(value) },
};

const numberFormatter = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 1 });
const moneyFormatter = new Intl.NumberFormat('ru-RU', { notation: 'compact', maximumFractionDigits: 1 });
const percentFormatter = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 1 });
const twoDecimalFormatter = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 });

function formatNumber(value: number) {
  return numberFormatter.format(value);
}

function formatMoney(value: number) {
  return `${moneyFormatter.format(value)} ₽`;
}

function formatMoneyOrDash(value: number | null) {
  return value === null ? '—' : formatMoney(value);
}

function formatPercent(value: number) {
  return `${percentFormatter.format(value)}%`;
}

function formatPercentOrDash(value: number | null) {
  return value === null ? '—' : formatPercent(value);
}

function formatCheck(value: number | null) {
  return value === null ? '—' : `${numberFormatter.format(value)} ₽`;
}

function formatDelta(value: number | null, points = false) {
  if (value === null) return '—';
  const sign = value > 0 ? '+' : '';
  return `${sign}${points ? twoDecimalFormatter.format(value) : percentFormatter.format(value)}${points ? ' п.п.' : '%'}`;
}

function shortDate(value: string) {
  return value.length >= 10 ? `${value.slice(8, 10)}.${value.slice(5, 7)}` : value;
}

function getInitialPeriod(dates: string[]): ReportingPeriod {
  const end = dates.at(-1) || new Date().toISOString().slice(0, 10);
  const start = dates[Math.max(0, dates.length - 7)] || end;
  return { start, end };
}

function getMetricValue(point: OwnPoint, metric: OwnMetric): number | null {
  return point[metric];
}

function Sparkline({ values, color }: { values: Array<number | null>; color: string }) {
  const usable = values.filter((value): value is number => value !== null && Number.isFinite(value));
  const width = 68;
  const height = 24;
  if (usable.length < 2) return <svg className="reporting-sparkline" viewBox={`0 0 ${width} ${height}`} aria-hidden="true"><line x1="0" y1="12" x2={width} y2="12" stroke={color} strokeWidth="2" /></svg>;
  const min = Math.min(...usable);
  const max = Math.max(...usable);
  const range = max - min || 1;
  const points = values.map((value, index) => {
    const x = index / Math.max(1, values.length - 1) * width;
    const y = value === null ? height / 2 : height - 2 - (value - min) / range * (height - 4);
    return `${x},${y}`;
  }).join(' ');
  return <svg className="reporting-sparkline" viewBox={`0 0 ${width} ${height}`} aria-hidden="true"><polyline points={points} fill="none" stroke={color} strokeWidth="2" /></svg>;
}

function KpiTile({ label, value, delta, points, values, color, note }: { label: string; value: string; delta: number | null; points?: boolean; values?: Array<number | null>; color: string; note?: string }) {
  return <CommonKpiTile
    className="reporting-kpi"
    label={label}
    value={value}
    delta={formatDelta(delta, points)}
    deltaSuffix=""
    tone={delta === null ? 'neutral' : delta > 0 ? 'positive' : delta < 0 ? 'negative' : 'neutral'}
    visual={values ? <Sparkline values={values} color={color} /> : undefined}
    details={note}
  />;
}

function DeltaValue({ value, points = false }: { value: number | null; points?: boolean }) {
  return <span className={value === null ? 'neutral' : value >= 0 ? 'positive' : 'negative'}>{formatDelta(value, points)}</span>;
}

function ownSummaryWithFinance(own: OwnSummary, finance: FinanceSummary) {
  return { ...own, ...finance };
}

interface CabinetRow {
  id: string;
  name: string;
  current: OwnSummary & FinanceSummary;
  previous: OwnSummary & FinanceSummary;
  currentOwnData: boolean;
  previousOwnData: boolean;
  currentFinanceData: boolean;
  previousFinanceData: boolean;
}

function buildCabinetRows(
  cabinets: Cabinet[],
  products: Product[],
  metrics: DailyMetrics[],
  profitability: ReturnType<typeof getProfitabilityRecords>,
  current: ReportingPeriod,
  previous: ReportingPeriod,
  getExpense: (month: string, cabinetId: string) => number,
): CabinetRow[] {
  const cabinetMap = new Map(cabinets.map(cabinet => [cabinet.id, cabinet]));
  const productIdsByCabinet = new Map<string, Set<string>>();
  products.forEach(product => {
    const id = product.cabinet_id || 'without-cabinet';
    const ids = productIdsByCabinet.get(id) || new Set<string>();
    ids.add(product.id);
    productIdsByCabinet.set(id, ids);
  });
  const productMap = new Map(products.map(product => [product.id, product]));
  return [...productIdsByCabinet.entries()]
    .map(([id, ids]) => {
      const ownCurrent = summarizeOwnMetrics(metrics, current, ids);
      const ownPrevious = summarizeOwnMetrics(metrics, previous, ids);
      const financeCurrent = summarizeFinance(profitability, productMap, current, getExpense, ids);
      const financePrevious = summarizeFinance(profitability, productMap, previous, getExpense, ids);
      return {
        id,
        name: cabinetMap.get(id)?.name || 'Без кабинета',
        current: ownSummaryWithFinance(ownCurrent, financeCurrent),
        previous: ownSummaryWithFinance(ownPrevious, financePrevious),
        currentOwnData: metrics.some(row => row.date >= current.start && row.date <= current.end && ids.has(row.product_id)),
        previousOwnData: metrics.some(row => row.date >= previous.start && row.date <= previous.end && ids.has(row.product_id)),
        currentFinanceData: profitability.some(row => row.period_end >= current.start && row.period_start <= current.end && ids.has(row.product_id)),
        previousFinanceData: profitability.some(row => row.period_end >= previous.start && row.period_start <= previous.end && ids.has(row.product_id)),
      };
    })
    .filter(row => row.current.orderedAmount || row.current.orders || row.current.revenue || row.previous.orderedAmount || row.previous.orders || row.previous.revenue)
    .sort((left, right) => right.current.orderedAmount - left.current.orderedAmount);
}

function buildOwnChartData(points: OwnPoint[], previousPoints: OwnPoint[], metric: OwnMetric) {
  return points.map((point, index) => ({
    date: point.date,
    current: getMetricValue(point, metric),
    previous: previousPoints[index] ? getMetricValue(previousPoints[index], metric) : null,
  }));
}

function buildMarketChartData(points: MarketPoint[], view: MarketView) {
  if (view === 'share') return points.map(point => ({ date: point.date, market: point.amountShare, own: point.ordersShare }));
  if (view === 'absolute') return points.map(point => ({ date: point.date, market: point.marketAmount, own: point.ownAmount }));
  const market = normalizeSeries(points.map(point => point.marketAmount));
  const own = normalizeSeries(points.map(point => point.ownAmount));
  return points.map((point, index) => ({ date: point.date, market: market[index], own: own[index] }));
}

function MarketTooltip({ active, payload, label, view }: { active?: boolean; payload?: Array<{ dataKey?: string; value?: number | null }>; label?: string; view: MarketView }) {
  if (!active || !payload?.length) return null;
  const valueLabel = (value: number | null | undefined) => value === null || value === undefined ? '—' : view === 'absolute' ? formatMoney(value) : view === 'share' ? formatPercent(value) : `${numberFormatter.format(value)}%`;
  return <div className="reporting-tooltip"><strong>{shortDate(String(label || ''))}</strong>{payload.map(item => <span key={item.dataKey}>{item.dataKey === 'market' ? 'Рынок' : 'Мы'}: {valueLabel(item.value)}</span>)}</div>;
}

export default function ReportingPage() {
  useSyncExternalStore(subscribe, getVersion);
  const expenseVersion = useSyncExternalStore(subscribeExtraExpenses, getExtraExpensesVersion);
  const metrics = getMetrics();
  const marketRows = getMarketDynamics();
  const products = getProducts();
  const cabinets = getCabinets();
  const profitability = getProfitabilityRecords();
  const [period, setPeriod] = useState<ReportingPeriod>(() => getInitialPeriod([...new Set([...metrics.map(row => row.date), ...marketRows.map(row => row.date), ...profitability.flatMap(row => [row.period_start, row.period_end])])].sort()));
  const [granularity, setGranularity] = useState<ReportingGranularity>('day');
  const [ownMetric, setOwnMetric] = useState<OwnMetric>('orderedAmount');
  const [marketView, setMarketView] = useState<MarketView>('index');
  const [cabinetFilter, setCabinetFilter] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [showHelp, setShowHelp] = useState(false);
  const productMap = useMemo(() => new Map(products.map(product => [product.id, product])), [products]);
  const categories = useMemo(() => [...new Set(products
    .filter(product => !cabinetFilter || product.cabinet_id === cabinetFilter)
    .map(product => product.category || 'Без категории'))]
    .sort((left, right) => left.localeCompare(right, 'ru')), [products, cabinetFilter]);
  const filteredProducts = useMemo(() => products.filter(product =>
    (!cabinetFilter || product.cabinet_id === cabinetFilter)
    && (!categoryFilter || (product.category || 'Без категории') === categoryFilter),
  ), [products, cabinetFilter, categoryFilter]);
  const filteredProductIds = useMemo(() => new Set(filteredProducts.map(product => product.id)), [filteredProducts]);
  const activeProductIds = cabinetFilter || categoryFilter ? filteredProductIds : undefined;
  const dates = useMemo(() => [...new Set([...metrics.map(row => row.date), ...marketRows.map(row => row.date), ...profitability.flatMap(row => [row.period_start, row.period_end])])].sort(), [metrics, marketRows, profitability]);
  const maxDate = dates.at(-1) || period.end;
  const comparison = useMemo(() => previousPeriod(period), [period]);
  const currentOwn = useMemo(() => summarizeOwnMetrics(metrics, period, activeProductIds), [metrics, period, activeProductIds]);
  const previousOwn = useMemo(() => summarizeOwnMetrics(metrics, comparison, activeProductIds), [metrics, comparison, activeProductIds]);
  const currentFinance = useMemo(() => { void expenseVersion; return summarizeFinance(profitability, productMap, period, getCabinetExtraExpense, activeProductIds); }, [profitability, productMap, period, expenseVersion, activeProductIds]);
  const previousFinance = useMemo(() => { void expenseVersion; return summarizeFinance(profitability, productMap, comparison, getCabinetExtraExpense, activeProductIds); }, [profitability, productMap, comparison, expenseVersion, activeProductIds]);
  const currentMarket = useMemo(() => summarizeMarket(marketRows, period), [marketRows, period]);
  const previousMarket = useMemo(() => summarizeMarket(marketRows, comparison), [marketRows, comparison]);
  const ownPoints = useMemo(() => aggregateOwnMetrics(metrics, period, granularity, activeProductIds), [metrics, period, granularity, activeProductIds]);
  const previousOwnPoints = useMemo(() => aggregateOwnMetrics(metrics, comparison, granularity, activeProductIds), [metrics, comparison, granularity, activeProductIds]);
  const marketPoints = useMemo(() => aggregateMarket(marketRows, period, granularity), [marketRows, period, granularity]);
  const ownChartData = useMemo(() => buildOwnChartData(ownPoints, previousOwnPoints, ownMetric), [ownPoints, previousOwnPoints, ownMetric]);
  const marketChartData = useMemo(() => buildMarketChartData(marketPoints, marketView), [marketPoints, marketView]);
  const cabinetRows = useMemo(() => { void expenseVersion; return buildCabinetRows(cabinets, filteredProducts, metrics, profitability, period, comparison, getCabinetExtraExpense); }, [cabinets, filteredProducts, metrics, profitability, period, comparison, expenseVersion]);
  const ownDataAvailable = metrics.some(row => row.date >= period.start && row.date <= period.end && (!activeProductIds || activeProductIds.has(row.product_id)));
  const financeDataAvailable = profitability.some(row => row.period_end >= period.start && row.period_start <= period.end && (!activeProductIds || activeProductIds.has(row.product_id)));
  const previousOwnDataAvailable = metrics.some(row => row.date >= comparison.start && row.date <= comparison.end && (!activeProductIds || activeProductIds.has(row.product_id)));
  const previousFinanceDataAvailable = profitability.some(row => row.period_end >= comparison.start && row.period_start <= comparison.end && (!activeProductIds || activeProductIds.has(row.product_id)));
  const marketDataAvailable = marketRows.some(row => row.date >= period.start && row.date <= period.end);
  const previousMarketDataAvailable = marketRows.some(row => row.date >= comparison.start && row.date <= comparison.end);
  const ownDelta = getPercentDelta(currentOwn.orderedAmount, previousOwn.orderedAmount);
  const marketDelta = getPercentDelta(currentMarket.marketAmount, previousMarket.marketAmount);
  const amountShareDelta = getPointsDelta(currentMarket.amountShare, previousMarket.amountShare);
  const ownCheckDelta = getPercentDelta(currentOwn.avgCheck || 0, previousOwn.avgCheck || 0);
  const marketCheckDelta = getPercentDelta(currentMarket.marketCheck || 0, previousMarket.marketCheck || 0);

  if (showHelp) return <AnalyticsHelp data={reportingHelp} onClose={() => setShowHelp(false)} />;

  return <div className="reporting-page overview-design-page analytics-page-shell ds-page">
    <AnalyticsPageHeader eyebrow="Аналитика › Управленческая сводка" title="Отчётность" description="Собственные результаты, положение на рынке и изменения за сопоставимые периоды." actions={<button type="button" className="ds-button" onClick={() => setShowHelp(true)}>Справка</button>} />

    <AnalyticsToolbar className="reporting-toolbar" trailing={<><SegmentedControl value={granularity} label="Гранулярность отчётности" options={[{ value: 'day', label: 'День' }, { value: 'week', label: 'Неделя' }, { value: 'month', label: 'Месяц' }]} onChange={setGranularity} /><button type="button" className="ds-button reporting-reset" onClick={() => { setPeriod(getInitialPeriod(dates)); setCabinetFilter(''); setCategoryFilter(''); }}>Сбросить</button></>}>
      <DateRangeFilter label="Период" value={period} onChange={setPeriod} maxDate={maxDate} />
      <label className="reporting-entity-filter">
        <span>Кабинет</span>
        <select value={cabinetFilter} onChange={event => { setCabinetFilter(event.target.value); setCategoryFilter(''); }}>
          <option value="">Все кабинеты</option>
          {cabinets.map(cabinet => <option key={cabinet.id} value={cabinet.id}>{cabinet.name}</option>)}
        </select>
      </label>
      <label className="reporting-entity-filter">
        <span>Категория</span>
        <select value={categoryFilter} onChange={event => setCategoryFilter(event.target.value)}>
          <option value="">Все категории</option>
          {categories.map(category => <option key={category} value={category}>{category}</option>)}
        </select>
      </label>
      <span className="reporting-comparison">Сравнение: <strong>{formatPeriod(comparison)}</strong></span>
    </AnalyticsToolbar>

    {!ownDataAvailable && !marketDataAvailable ? <EmptyState title="Нет данных для отчётности" description="Импортируйте локальные метрики или отчёт «Рынок», затем выберите период с данными." /> : <>
      <section className="reporting-kpis ds-kpi-grid">
        <KpiTile label="Заказы, ₽" value={ownDataAvailable ? formatMoney(currentOwn.orderedAmount) : '—'} delta={ownDataAvailable ? ownDelta : null} values={ownPoints.map(point => point.orderedAmount)} color="#2563EB" note="локальные метрики" />
        <KpiTile label="Заказы, шт." value={ownDataAvailable ? formatNumber(currentOwn.orders) : '—'} delta={ownDataAvailable ? getPercentDelta(currentOwn.orders, previousOwn.orders) : null} values={ownPoints.map(point => point.orders)} color="#10A778" />
        <KpiTile label="Рентабельность" value={financeDataAvailable ? formatPercentOrDash(currentFinance.profitability) : '—'} delta={financeDataAvailable ? getPointsDelta(currentFinance.profitability, previousFinance.profitability) : null} points values={undefined} color="#8B5CF6" />
        <KpiTile label="Чистая прибыль" value={financeDataAvailable ? formatMoneyOrDash(currentFinance.netProfit) : '—'} delta={financeDataAvailable ? getPercentDelta(currentFinance.netProfit, previousFinance.netProfit) : null} color="#10A778" />
        <KpiTile label="Доля рынка, ₽" value={marketDataAvailable ? formatPercentOrDash(currentMarket.amountShare) : '—'} delta={marketDataAvailable ? amountShareDelta : null} points values={marketPoints.map(point => point.amountShare)} color="#347FF0" note="отчёт «Рынок»" />
        <KpiTile label="Доля рынка, шт." value={marketDataAvailable ? formatPercentOrDash(currentMarket.ordersShare) : '—'} delta={marketDataAvailable ? getPointsDelta(currentMarket.ordersShare, previousMarket.ordersShare) : null} points values={marketPoints.map(point => point.ordersShare)} color="#10A778" />
        <KpiTile label="Средний чек наш" value={ownDataAvailable ? formatCheck(currentOwn.avgCheck) : '—'} delta={ownDataAvailable ? ownCheckDelta : null} color="#E59B18" />
        <KpiTile label="Средний чек рынка" value={marketDataAvailable ? formatCheck(currentMarket.marketCheck) : '—'} delta={marketDataAvailable ? marketCheckDelta : null} color="#64748B" />
      </section>

      <section className="reporting-status page-card"><span className="reporting-status-icon">i</span><span>Период {formatPeriod(period)} сравнивается с равным предыдущим периодом. Кабинет и категория фильтруют собственные KPI, график и таблицу; данные рынка остаются агрегированными.</span></section>

      <section className="reporting-main-grid">
        <article className="reporting-card reporting-own-card">
          <header className="reporting-card-head"><div><span>1. СОБСТВЕННЫЕ РЕЗУЛЬТАТЫ</span><h2>Динамика своих показателей</h2><p>Сплошная линия — текущий период, пунктир — предыдущий.</p></div><div className="reporting-chart-controls"><div className="entry-segmented">{(Object.keys(ownMetricMeta) as OwnMetric[]).map(metric => <button type="button" key={metric} className={ownMetric === metric ? 'active' : ''} onClick={() => setOwnMetric(metric)}>{ownMetricMeta[metric].label}</button>)}</div></div></header>
          {ownChartData.length ? <ResponsiveContainer width="100%" height={280}><LineChart data={ownChartData} margin={{ top: 12, right: 14, left: 2, bottom: 2 }}><CartesianGrid stroke="#E8EDF3" strokeDasharray="3 3" /><XAxis dataKey="date" tickFormatter={shortDate} tick={{ fontSize: 9 }} /><YAxis tickFormatter={value => ownMetricMeta[ownMetric].format(Number(value))} tick={{ fontSize: 9 }} width={62} /><Tooltip labelFormatter={label => shortDate(String(label))} formatter={(value, name) => [value === null || value === undefined ? '—' : ownMetricMeta[ownMetric].format(Number(value)), name === 'current' ? 'Текущий период' : 'Предыдущий период']} /><Line type="monotone" dataKey="current" name="Текущий период" stroke={ownMetricMeta[ownMetric].color} strokeWidth={2.4} dot={{ r: 2 }} connectNulls={false} /><Line type="monotone" dataKey="previous" name="Предыдущий период" stroke="#9BB9EA" strokeWidth={1.7} strokeDasharray="5 4" dot={false} connectNulls={false} /></LineChart></ResponsiveContainer> : <div className="reporting-chart-empty">Нет дневных данных в выбранном периоде.</div>}
          <div className="reporting-summary-grid"><SummaryRow label="Заказы, ₽" current={ownDataAvailable ? formatMoney(currentOwn.orderedAmount) : '—'} previous={previousOwnDataAvailable ? formatMoney(previousOwn.orderedAmount) : '—'} delta={ownDataAvailable ? ownDelta : null} /><SummaryRow label="Заказы, шт." current={ownDataAvailable ? formatNumber(currentOwn.orders) : '—'} previous={previousOwnDataAvailable ? formatNumber(previousOwn.orders) : '—'} delta={ownDataAvailable ? getPercentDelta(currentOwn.orders, previousOwn.orders) : null} /><SummaryRow label="Рентабельность" current={financeDataAvailable ? formatPercentOrDash(currentFinance.profitability) : '—'} previous={previousFinanceDataAvailable ? formatPercentOrDash(previousFinance.profitability) : '—'} delta={financeDataAvailable ? getPointsDelta(currentFinance.profitability, previousFinance.profitability) : null} points /></div>
        </article>

        <article className="reporting-card reporting-market-card">
          <header className="reporting-card-head"><div><span>2. РЫНОК И НАША ПОЗИЦИЯ</span><h2>Сравнение динамики</h2><p>Данные отчёта «Рынок» без товарной детализации.</p></div><div className="entry-segmented"><button type="button" className={marketView === 'index' ? 'active' : ''} onClick={() => setMarketView('index')}>Индекс</button><button type="button" className={marketView === 'absolute' ? 'active' : ''} onClick={() => setMarketView('absolute')}>Абсолют</button><button type="button" className={marketView === 'share' ? 'active' : ''} onClick={() => setMarketView('share')}>Доля</button></div></header>
          {marketDataAvailable && marketChartData.length ? <ResponsiveContainer width="100%" height={280}><LineChart data={marketChartData} margin={{ top: 12, right: 14, left: 2, bottom: 2 }}><CartesianGrid stroke="#E8EDF3" strokeDasharray="3 3" /><XAxis dataKey="date" tickFormatter={shortDate} tick={{ fontSize: 9 }} /><YAxis tickFormatter={value => marketView === 'absolute' ? formatMoney(Number(value)) : `${numberFormatter.format(Number(value))}%`} tick={{ fontSize: 9 }} width={62} /><Tooltip content={<MarketTooltip view={marketView} />} /><Line type="monotone" dataKey="market" name="Рынок" stroke="#2563EB" strokeWidth={2.3} dot={{ r: 2 }} connectNulls={false} /><Line type="monotone" dataKey="own" name="Мы" stroke="#10A778" strokeWidth={2.3} dot={{ r: 2 }} connectNulls={false} /></LineChart></ResponsiveContainer> : <div className="reporting-chart-empty">Нет отчёта «Рынок» в выбранном периоде.</div>}
          <div className="reporting-market-summary"><SummaryRow label="Рынок, ₽" current={marketDataAvailable ? formatMoney(currentMarket.marketAmount) : '—'} previous={previousMarketDataAvailable ? formatMoney(previousMarket.marketAmount) : '—'} delta={marketDataAvailable ? marketDelta : null} /><SummaryRow label="Наша доля по сумме" current={marketDataAvailable ? formatPercentOrDash(currentMarket.amountShare) : '—'} previous={previousMarketDataAvailable ? formatPercentOrDash(previousMarket.amountShare) : '—'} delta={marketDataAvailable ? amountShareDelta : null} points /><SummaryRow label="Наша доля по штукам" current={marketDataAvailable ? formatPercentOrDash(currentMarket.ordersShare) : '—'} previous={previousMarketDataAvailable ? formatPercentOrDash(previousMarket.ordersShare) : '—'} delta={marketDataAvailable ? getPointsDelta(currentMarket.ordersShare, previousMarket.ordersShare) : null} points /></div>
        </article>

        <aside className="reporting-card reporting-signals-card"><header className="reporting-card-head"><div><span>3. ДРАЙВЕРЫ И СИГНАЛЫ</span><h2>Изменения периода</h2><p>Диагностические сравнения без причинных выводов.</p></div></header><Signal title="Рост рынка, ₽" value={marketDataAvailable ? formatDelta(marketDelta) : '—'} note="к пред. периоду" tone={marketDelta === null ? 'neutral' : marketDelta >= 0 ? 'green' : 'red'} /><Signal title="Рост наших заказов" value={ownDataAvailable ? formatDelta(ownDelta) : '—'} note="локальные метрики" tone={ownDelta === null ? 'neutral' : ownDelta >= 0 ? 'green' : 'red'} /><Signal title="Изменение нашей доли" value={marketDataAvailable ? formatDelta(amountShareDelta, true) : '—'} note="п.п. по сумме" tone={amountShareDelta === null ? 'neutral' : amountShareDelta >= 0 ? 'green' : 'red'} /><Signal title="Изменение среднего чека рынка" value={marketDataAvailable ? formatDelta(marketCheckDelta) : '—'} note="к пред. периоду" tone={marketCheckDelta === null ? 'neutral' : marketCheckDelta >= 0 ? 'green' : 'red'} /></aside>
      </section>

    <section className="reporting-card reporting-cabinets-card"><header className="reporting-card-head"><div><span>4. ДЕТАЛИЗАЦИЯ ПО КАБИНЕТАМ</span><h2>Собственные показатели по кабинетам</h2><p>Суммы и прибыль рассчитаны только по локальным данным; рынок в эту таблицу не распределяется.</p></div><span className="reporting-count">{cabinetRows.length} кабинетов</span></header><div className="reporting-table-wrap"><table><thead><tr><th rowSpan={2}>Кабинет</th><th colSpan={3}>Заказы, ₽</th><th colSpan={3}>Заказы, шт.</th><th colSpan={3}>Рентабельность</th><th colSpan={3}>Чистая прибыль</th><th colSpan={2}>Средний чек</th></tr><tr><th>Текущие</th><th>Пред.</th><th>Динамика</th><th>Текущие</th><th>Пред.</th><th>Динамика</th><th>Текущая</th><th>Пред.</th><th>Δ п.п.</th><th>Текущая</th><th>Пред.</th><th>Динамика</th><th>Текущий</th><th>Пред.</th></tr></thead><tbody>{cabinetRows.map(row => <tr key={row.id}><th>{row.name}</th><td>{row.currentOwnData ? formatMoney(row.current.orderedAmount) : '—'}</td><td>{row.previousOwnData ? formatMoney(row.previous.orderedAmount) : '—'}</td><td><DeltaValue value={row.currentOwnData ? getPercentDelta(row.current.orderedAmount, row.previous.orderedAmount) : null} /></td><td>{row.currentOwnData ? formatNumber(row.current.orders) : '—'}</td><td>{row.previousOwnData ? formatNumber(row.previous.orders) : '—'}</td><td><DeltaValue value={row.currentOwnData ? getPercentDelta(row.current.orders, row.previous.orders) : null} /></td><td>{row.currentFinanceData ? formatPercentOrDash(row.current.profitability) : '—'}</td><td>{row.previousFinanceData ? formatPercentOrDash(row.previous.profitability) : '—'}</td><td><DeltaValue value={row.currentFinanceData ? getPointsDelta(row.current.profitability, row.previous.profitability) : null} points /></td><td>{row.currentFinanceData && row.current.revenue ? formatMoney(row.current.netProfit) : '—'}</td><td>{row.previousFinanceData && row.previous.revenue ? formatMoney(row.previous.netProfit) : '—'}</td><td><DeltaValue value={row.currentFinanceData && row.previousFinanceData ? getPercentDelta(row.current.netProfit, row.previous.netProfit) : null} /></td><td>{row.currentOwnData ? formatCheck(row.current.avgCheck) : '—'}</td><td>{row.previousOwnData ? formatCheck(row.previous.avgCheck) : '—'}</td></tr>)}{cabinetRows.length > 0 && <tr className="reporting-total-row"><th>Итого</th><td>{ownDataAvailable ? formatMoney(currentOwn.orderedAmount) : '—'}</td><td>{previousOwnDataAvailable ? formatMoney(previousOwn.orderedAmount) : '—'}</td><td><DeltaValue value={ownDataAvailable ? ownDelta : null} /></td><td>{ownDataAvailable ? formatNumber(currentOwn.orders) : '—'}</td><td>{previousOwnDataAvailable ? formatNumber(previousOwn.orders) : '—'}</td><td><DeltaValue value={ownDataAvailable ? getPercentDelta(currentOwn.orders, previousOwn.orders) : null} /></td><td>{financeDataAvailable ? formatPercentOrDash(currentFinance.profitability) : '—'}</td><td>{previousFinanceDataAvailable ? formatPercentOrDash(previousFinance.profitability) : '—'}</td><td><DeltaValue value={financeDataAvailable ? getPointsDelta(currentFinance.profitability, previousFinance.profitability) : null} points /></td><td>{financeDataAvailable ? formatMoney(currentFinance.netProfit) : '—'}</td><td>{previousFinanceDataAvailable ? formatMoney(previousFinance.netProfit) : '—'}</td><td><DeltaValue value={financeDataAvailable && previousFinanceDataAvailable ? getPercentDelta(currentFinance.netProfit, previousFinance.netProfit) : null} /></td><td>{ownDataAvailable ? formatCheck(currentOwn.avgCheck) : '—'}</td><td>{previousOwnDataAvailable ? formatCheck(previousOwn.avgCheck) : '—'}</td></tr>}</tbody></table></div>{!cabinetRows.length && <div className="reporting-table-empty">Нет локальных данных по кабинетам за выбранный период.</div>}</section>
    </>}
  </div>;
}

function SummaryRow({ label, current, previous, delta, points = false }: { label: string; current: string; previous: string; delta: number | null; points?: boolean }) {
  return <div className="reporting-summary-row"><strong>{label}</strong><span>{current}</span><span>{previous}</span><DeltaValue value={delta} points={points} /></div>;
}

function Signal({ title, value, note, tone }: { title: string; value: string; note: string; tone: 'green' | 'red' | 'neutral' }) {
  return <article className={`reporting-signal reporting-signal-${tone}`}><span className="reporting-signal-icon">{tone === 'green' ? '↗' : tone === 'red' ? '↘' : '—'}</span><div><strong>{title}</strong><small>{note}</small></div><b>{value}</b></article>;
}
