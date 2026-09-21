import { useEffect, useMemo, useState } from 'react';
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import DateRangeFilter from '../../components/DateRangeFilter';
import { AnalyticsPageHeader, AnalyticsPanel, AnalyticsToolbar, EmptyState, KpiTile, PanelHeader, SegmentedControl } from '../../components/AnalyticsPrimitives';
import { aggregateMarket, bucketDate, formatPeriod, getPercentDelta, getPointsDelta, normalizeSeries, previousPeriod, summarizeMarket, type ReportingGranularity, type ReportingPeriod } from '../../data/reportingCalculations';
import { loadFunnelBounds, loadFunnelFilterOptions, loadFunnelSeries, loadFunnelSummary } from '../../features/funnel/funnelData';
import type { FunnelFilterOptions, FunnelFilters, FunnelSeriesRow, FunnelSummary } from '../../features/funnel/funnelDataCore';
import { loadV5MarketData } from '../../features/market/marketData';
import { loadProfitabilityBounds, loadProfitabilityFilterOptions, loadProfitabilitySummary } from '../../features/profitability/profitabilityData';
import type { ProfitabilityFilterOptions, ProfitabilityFilters, ProfitabilitySummary } from '../../features/profitability/profitabilityDataCore';
import type { MarketDynamicsRecord } from '../../types';

type OwnMetric = 'orderedAmount' | 'orders' | 'adSpend' | 'drr';
type MarketView = 'index' | 'absolute' | 'share';
type Dimension = { id: string; name: string };
type OwnPoint = { date: string; orderedAmount: number; orders: number; adSpend: number; drr: number | null };
type CabinetRow = { id: string; name: string; currentOwn: FunnelSummary; previousOwn: FunnelSummary; currentFinance: ProfitabilitySummary; previousFinance: ProfitabilitySummary };

const EMPTY_FUNNEL: FunnelSummary = { impressions: 0, clicks: 0, carts: 0, orders: 0, orderedAmount: 0, adImpressions: 0, adClicks: 0, adOrdersQty: 0, adOrderedAmount: 0, adSpend: 0, productCount: 0 };
const EMPTY_PROFIT: ProfitabilitySummary = { quantity: 0, revenue: 0, directCosts: 0, grossProfit: 0, grossMargin: null, expenseAmount: null, netProfit: null, profitability: null, productCount: 0, expensesConfigured: false };
const EMPTY_OPTIONS: FunnelFilterOptions = { cabinets: [], categories: [], brands: [], groups: [] };
const nf = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 1 });
const compact = new Intl.NumberFormat('ru-RU', { notation: 'compact', maximumFractionDigits: 1 });
const money = (value: number | null) => value === null ? '—' : `${compact.format(value)} ₽`;
const number = (value: number) => nf.format(value);
const percent = (value: number | null) => value === null ? '—' : `${nf.format(value)}%`;
const delta = (value: number | null, points = false) => value === null ? '—' : `${value > 0 ? '+' : ''}${nf.format(value)}${points ? ' п.п.' : '%'}`;
const ids = (value: string) => value ? [value] : null;
const shiftDate = (value: string, days: number) => { const date = new Date(`${value}T00:00:00Z`); date.setUTCDate(date.getUTCDate() + days); return date.toISOString().slice(0, 10); };

function mergeDimensions(...sets: Dimension[][]): Dimension[] {
  const values = new Map<string, string>();
  sets.flat().forEach(item => values.set(item.id, item.name));
  return [...values].map(([id, name]) => ({ id, name })).sort((left, right) => left.name.localeCompare(right.name, 'ru'));
}

function initialCommonPeriod(ranges: Array<{ minDate: string | null; maxDate: string | null }>): ReportingPeriod | null {
  const complete = ranges.filter((range): range is { minDate: string; maxDate: string } => !!range.minDate && !!range.maxDate);
  if (!complete.length) return null;
  const minDate = complete.map(range => range.minDate).sort().at(-1) as string;
  const maxDate = complete.map(range => range.maxDate).sort()[0];
  if (minDate > maxDate) return { start: shiftDate(maxDate, -6), end: maxDate };
  return { start: minDate > shiftDate(maxDate, -6) ? minDate : shiftDate(maxDate, -6), end: maxDate };
}

function aggregateOwn(rows: FunnelSeriesRow[], granularity: ReportingGranularity): OwnPoint[] {
  const buckets = new Map<string, FunnelSeriesRow[]>();
  rows.forEach(row => { const key = bucketDate(row.date, granularity); buckets.set(key, [...(buckets.get(key) || []), row]); });
  return [...buckets.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([date, values]) => {
    const orderedAmount = values.reduce((sum, row) => sum + row.orderedAmount, 0);
    const orders = values.reduce((sum, row) => sum + row.orders, 0);
    const adSpend = values.reduce((sum, row) => sum + row.adSpend, 0);
    return { date, orderedAmount, orders, adSpend, drr: orderedAmount ? adSpend / orderedAmount * 100 : null };
  });
}

function ownMetricValue(point: OwnPoint, metric: OwnMetric) { return point[metric]; }
function shortDate(value: string) { return value.length >= 10 ? `${value.slice(8, 10)}.${value.slice(5, 7)}` : value; }
function tone(value: number | null): 'positive' | 'negative' | 'neutral' { return value === null || value === 0 ? 'neutral' : value > 0 ? 'positive' : 'negative'; }

export default function ReportingServerPage() {
  const today = useMemo(() => new Date().toISOString().slice(0, 10), []);
  const [period, setPeriod] = useState<ReportingPeriod>({ start: shiftDate(today, -6), end: today });
  const [defaultPeriod, setDefaultPeriod] = useState<ReportingPeriod | null>(null);
  const [maxDate, setMaxDate] = useState(today);
  const [marketRows, setMarketRows] = useState<MarketDynamicsRecord[]>([]);
  const [options, setOptions] = useState(EMPTY_OPTIONS);
  const [profitOptions, setProfitOptions] = useState<ProfitabilityFilterOptions>({ cabinets: [], categories: [], brands: [], groups: [] });
  const [ownCurrent, setOwnCurrent] = useState(EMPTY_FUNNEL);
  const [ownPrevious, setOwnPrevious] = useState(EMPTY_FUNNEL);
  const [financeCurrent, setFinanceCurrent] = useState(EMPTY_PROFIT);
  const [financePrevious, setFinancePrevious] = useState(EMPTY_PROFIT);
  const [seriesCurrent, setSeriesCurrent] = useState<FunnelSeriesRow[]>([]);
  const [seriesPrevious, setSeriesPrevious] = useState<FunnelSeriesRow[]>([]);
  const [cabinetRows, setCabinetRows] = useState<CabinetRow[]>([]);
  const [cabinet, setCabinet] = useState('');
  const [category, setCategory] = useState('');
  const [granularity, setGranularity] = useState<ReportingGranularity>('day');
  const [ownMetric, setOwnMetric] = useState<OwnMetric>('orderedAmount');
  const [marketView, setMarketView] = useState<MarketView>('index');
  const [ready, setReady] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [request, setRequest] = useState(0);

  useEffect(() => {
    let active = true;
    queueMicrotask(() => { if (active) { setLoading(true); setError(''); } });
    Promise.all([loadV5MarketData(), loadFunnelBounds(), loadProfitabilityBounds()]).then(async ([market, funnel, profit]) => {
      if (!active) return;
      const selected = initialCommonPeriod([market.bounds, funnel, profit]);
      if (!selected) throw new Error('Нет опубликованных данных для серверной отчётности');
      const [funnelOptions, nextProfitOptions] = await Promise.all([loadFunnelFilterOptions(selected), loadProfitabilityFilterOptions(selected)]);
      if (!active) return;
      setMarketRows(market.records); setOptions(funnelOptions); setProfitOptions(nextProfitOptions);
      setPeriod(selected); setDefaultPeriod(selected); setMaxDate([market.bounds.maxDate, funnel.maxDate, profit.maxDate].filter(Boolean).sort().at(-1) || selected.end); setReady(true);
    }).catch(reason => { if (active) setError(reason instanceof Error ? reason.message : 'Не удалось подготовить серверную отчётность'); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [request]);

  const comparison = useMemo(() => previousPeriod(period), [period]);
  const cabinets = useMemo(() => mergeDimensions(options.cabinets, profitOptions.cabinets), [options.cabinets, profitOptions.cabinets]);
  const categories = useMemo(() => mergeDimensions(options.categories, profitOptions.categories), [options.categories, profitOptions.categories]);

  useEffect(() => {
    if (!ready) return;
    let active = true;
    const common = { cabinetIds: ids(cabinet), categoryIds: ids(category) };
    const currentFunnel: FunnelFilters = { start: period.start, end: period.end, ...common };
    const previousFunnel: FunnelFilters = { start: comparison.start, end: comparison.end, ...common };
    const currentProfit: ProfitabilityFilters = { start: period.start, end: period.end, ...common };
    const previousProfit: ProfitabilityFilters = { start: comparison.start, end: comparison.end, ...common };
    const detailCabinets = cabinet ? cabinets.filter(item => item.id === cabinet) : cabinets;
    queueMicrotask(() => { if (active) { setLoading(true); setError(''); } });
    Promise.all([
      loadFunnelSummary(currentFunnel), loadFunnelSummary(previousFunnel), loadFunnelSeries(currentFunnel), loadFunnelSeries(previousFunnel),
      loadProfitabilitySummary(currentProfit), loadProfitabilitySummary(previousProfit),
      ...detailCabinets.map(async item => {
        const currentCabinet = { cabinetIds: [item.id], categoryIds: ids(category) };
        const [currentOwn, previousOwn, currentFinance, previousFinance] = await Promise.all([
          loadFunnelSummary({ start: period.start, end: period.end, ...currentCabinet }),
          loadFunnelSummary({ start: comparison.start, end: comparison.end, ...currentCabinet }),
          loadProfitabilitySummary({ start: period.start, end: period.end, ...currentCabinet }),
          loadProfitabilitySummary({ start: comparison.start, end: comparison.end, ...currentCabinet }),
        ]);
        return { id: item.id, name: item.name, currentOwn, previousOwn, currentFinance, previousFinance };
      }),
    ]).then(values => {
      if (!active) return;
      const [nextOwnCurrent, nextOwnPrevious, nextSeriesCurrent, nextSeriesPrevious, nextFinanceCurrent, nextFinancePrevious, ...details] = values;
      setOwnCurrent(nextOwnCurrent as FunnelSummary); setOwnPrevious(nextOwnPrevious as FunnelSummary);
      setSeriesCurrent(nextSeriesCurrent as FunnelSeriesRow[]); setSeriesPrevious(nextSeriesPrevious as FunnelSeriesRow[]);
      setFinanceCurrent(nextFinanceCurrent as ProfitabilitySummary); setFinancePrevious(nextFinancePrevious as ProfitabilitySummary);
      setCabinetRows((details as CabinetRow[]).filter(row => row.currentOwn.productCount || row.previousOwn.productCount || row.currentFinance.productCount || row.previousFinance.productCount));
    }).catch(reason => { if (active) setError(reason instanceof Error ? reason.message : 'Не удалось загрузить серверную отчётность'); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [cabinet, cabinets, category, comparison.end, comparison.start, period.end, period.start, ready]);

  const currentOwnPoints = useMemo(() => aggregateOwn(seriesCurrent, granularity), [granularity, seriesCurrent]);
  const previousOwnPoints = useMemo(() => aggregateOwn(seriesPrevious, granularity), [granularity, seriesPrevious]);
  const ownChart = useMemo(() => currentOwnPoints.map((point, index) => ({ date: point.date, current: ownMetricValue(point, ownMetric), previous: previousOwnPoints[index] ? ownMetricValue(previousOwnPoints[index], ownMetric) : null })), [currentOwnPoints, ownMetric, previousOwnPoints]);
  const marketCurrent = useMemo(() => summarizeMarket(marketRows, period), [marketRows, period]);
  const marketPrevious = useMemo(() => summarizeMarket(marketRows, comparison), [comparison, marketRows]);
  const marketPoints = useMemo(() => aggregateMarket(marketRows, period, granularity), [granularity, marketRows, period]);
  const marketChart = useMemo(() => {
    if (marketView === 'share') return marketPoints.map(point => ({ date: point.date, market: point.amountShare, own: point.ordersShare }));
    if (marketView === 'absolute') return marketPoints.map(point => ({ date: point.date, market: point.marketAmount, own: point.ownAmount }));
    const market = normalizeSeries(marketPoints.map(point => point.marketAmount)); const own = normalizeSeries(marketPoints.map(point => point.ownAmount));
    return marketPoints.map((point, index) => ({ date: point.date, market: market[index], own: own[index] }));
  }, [marketPoints, marketView]);
  const ownDelta = getPercentDelta(ownCurrent.orderedAmount, ownPrevious.orderedAmount);
  const marketDelta = getPercentDelta(marketCurrent.marketAmount, marketPrevious.marketAmount);
  const shareDelta = getPointsDelta(marketCurrent.amountShare, marketPrevious.amountShare);
  const ownAvg = ownCurrent.orders ? ownCurrent.orderedAmount / ownCurrent.orders : null;
  const previousOwnAvg = ownPrevious.orders ? ownPrevious.orderedAmount / ownPrevious.orders : null;

  return <section className="reporting-page overview-design-page analytics-page-shell ds-page">
    <AnalyticsPageHeader eyebrow="Аналитика › Управленческая сводка" title="Отчётность" description="Серверная сводка собственных результатов, финансов и положения на рынке." meta={<span>V5 · Supabase · без локального хранилища</span>} />
    <AnalyticsToolbar className="reporting-toolbar" status={<span>Сравнение: <strong>{formatPeriod(comparison)}</strong>. Рынок не распределяется по кабинетам и категориям.</span>} trailing={<><SegmentedControl value={granularity} label="Гранулярность" options={[{ value: 'day', label: 'День' }, { value: 'week', label: 'Неделя' }, { value: 'month', label: 'Месяц' }]} onChange={setGranularity} /><button className="ds-button reporting-reset" type="button" onClick={() => { if (defaultPeriod) setPeriod(defaultPeriod); setCabinet(''); setCategory(''); }}>Сбросить</button></>}>
      <DateRangeFilter label="Период" value={period} onChange={setPeriod} maxDate={maxDate} />
      <label className="reporting-entity-filter"><span>Кабинет</span><select aria-label="Кабинет" value={cabinet} onChange={event => setCabinet(event.target.value)}><option value="">Все кабинеты</option>{cabinets.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
      <label className="reporting-entity-filter"><span>Категория</span><select aria-label="Категория" value={category} onChange={event => setCategory(event.target.value)}><option value="">Все категории</option>{categories.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
    </AnalyticsToolbar>
    {error ? <EmptyState title="Не удалось загрузить отчётность V5" description={error} action={<button className="ds-button" type="button" onClick={() => setRequest(value => value + 1)}>Повторить</button>} /> : loading ? <EmptyState title="Загрузка отчётности V5" description="Получаем bounded-агрегаты из Supabase." /> : !ownCurrent.productCount && !marketPoints.length && !financeCurrent.productCount ? <EmptyState title="Нет данных за период" description="Измените период или импортируйте и опубликуйте данные V5." /> : <>
      <section className="reporting-kpis ds-kpi-grid">
        <KpiTile label="Заказы, ₽" value={money(ownCurrent.orderedAmount)} delta={delta(ownDelta)} deltaSuffix="" tone={tone(ownDelta)} details="серверная воронка" />
        <KpiTile label="Заказы, шт." value={number(ownCurrent.orders)} delta={delta(getPercentDelta(ownCurrent.orders, ownPrevious.orders))} deltaSuffix="" tone={tone(getPercentDelta(ownCurrent.orders, ownPrevious.orders))} />
        <KpiTile label="Валовая прибыль" value={money(financeCurrent.grossProfit)} delta={delta(getPercentDelta(financeCurrent.grossProfit, financePrevious.grossProfit))} deltaSuffix="" tone={tone(getPercentDelta(financeCurrent.grossProfit, financePrevious.grossProfit))} details={`Маржа ${percent(financeCurrent.grossMargin)}`} />
        <KpiTile label="Чистая прибыль" value={money(financeCurrent.netProfit)} delta={delta(financeCurrent.netProfit === null || financePrevious.netProfit === null ? null : getPercentDelta(financeCurrent.netProfit, financePrevious.netProfit))} deltaSuffix="" details={financeCurrent.expensesConfigured ? `Рентабельность ${percent(financeCurrent.profitability)}` : 'постоянные расходы не настроены'} />
        <KpiTile label="Доля рынка, ₽" value={percent(marketCurrent.amountShare)} delta={delta(shareDelta, true)} deltaSuffix="" tone={tone(shareDelta)} details="серверный отчёт «Рынок»" />
        <KpiTile label="Доля рынка, шт." value={percent(marketCurrent.ordersShare)} delta={delta(getPointsDelta(marketCurrent.ordersShare, marketPrevious.ordersShare), true)} deltaSuffix="" tone={tone(getPointsDelta(marketCurrent.ordersShare, marketPrevious.ordersShare))} />
        <KpiTile label="Средний чек наш" value={money(ownAvg)} delta={delta(ownAvg === null || previousOwnAvg === null ? null : getPercentDelta(ownAvg, previousOwnAvg))} deltaSuffix="" />
        <KpiTile label="Средний чек рынка" value={money(marketCurrent.marketCheck)} delta={delta(marketCurrent.marketCheck === null || marketPrevious.marketCheck === null ? null : getPercentDelta(marketCurrent.marketCheck, marketPrevious.marketCheck))} deltaSuffix="" />
      </section>
      {!financeCurrent.expensesConfigured && <section className="reporting-status page-card"><span className="reporting-status-icon">i</span><span>Чистая прибыль и рентабельность намеренно скрыты: постоянные расходы ещё не настроены для всего выбранного периода.</span></section>}
      <section className="reporting-main-grid">
        <AnalyticsPanel className="reporting-card"><PanelHeader eyebrow="1. СОБСТВЕННЫЕ РЕЗУЛЬТАТЫ" title="Динамика показателей" description="Сплошная линия — текущий период, пунктир — предыдущий." controls={<select aria-label="Показатель" value={ownMetric} onChange={event => setOwnMetric(event.target.value as OwnMetric)}><option value="orderedAmount">Заказы, ₽</option><option value="orders">Заказы, шт.</option><option value="adSpend">Расход рекламы</option><option value="drr">ДРР</option></select>} />
          <ResponsiveContainer width="100%" height={280}><LineChart data={ownChart}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="date" tickFormatter={shortDate} /><YAxis tickFormatter={value => ownMetric === 'orders' ? number(Number(value)) : ownMetric === 'drr' ? percent(Number(value)) : money(Number(value))} width={64} /><Tooltip formatter={value => value == null ? '—' : ownMetric === 'orders' ? number(Number(value)) : ownMetric === 'drr' ? percent(Number(value)) : money(Number(value))} /><Line dataKey="current" name="Текущий" stroke="#2563EB" strokeWidth={2.3} dot={false} /><Line dataKey="previous" name="Предыдущий" stroke="#9BB9EA" strokeDasharray="5 4" dot={false} /></LineChart></ResponsiveContainer>
        </AnalyticsPanel>
        <AnalyticsPanel className="reporting-card"><PanelHeader eyebrow="2. РЫНОК И НАША ПОЗИЦИЯ" title="Сравнение динамики" description="Агрегированные рыночные показатели." controls={<select aria-label="Вид рынка" value={marketView} onChange={event => setMarketView(event.target.value as MarketView)}><option value="index">Индекс</option><option value="absolute">Абсолют</option><option value="share">Доля</option></select>} />
          <ResponsiveContainer width="100%" height={280}><LineChart data={marketChart}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="date" tickFormatter={shortDate} /><YAxis tickFormatter={value => marketView === 'absolute' ? money(Number(value)) : percent(Number(value))} width={64} /><Tooltip formatter={value => value == null ? '—' : marketView === 'absolute' ? money(Number(value)) : percent(Number(value))} /><Line dataKey="market" name="Рынок" stroke="#2563EB" strokeWidth={2.3} dot={false} /><Line dataKey="own" name="Мы" stroke="#10A778" strokeWidth={2.3} dot={false} /></LineChart></ResponsiveContainer>
        </AnalyticsPanel>
        <aside className="reporting-card reporting-signals-card"><header className="reporting-card-head"><div><span>3. СИГНАЛЫ</span><h2>Изменения периода</h2><p>Диагностика без причинных выводов.</p></div></header>{[["Рост рынка, ₽", marketDelta], ["Рост наших заказов", ownDelta], ["Изменение доли", shareDelta]].map(([label, value]) => <article className={`reporting-signal reporting-signal-${value === null ? 'neutral' : Number(value) >= 0 ? 'green' : 'red'}`} key={String(label)}><span className="reporting-signal-icon">{value === null ? '—' : Number(value) >= 0 ? '↗' : '↘'}</span><div><strong>{label}</strong><small>к предыдущему периоду</small></div><b>{delta(value as number | null, label === 'Изменение доли')}</b></article>)}</aside>
      </section>
      <section className="reporting-card reporting-cabinets-card"><header className="reporting-card-head"><div><span>4. ДЕТАЛИЗАЦИЯ</span><h2>Собственные показатели по кабинетам</h2><p>Каждая строка рассчитана сервером; рынок по кабинетам не распределяется.</p></div><span className="reporting-count">{cabinetRows.length} кабинетов</span></header><div className="reporting-table-wrap"><table><thead><tr><th>Кабинет</th><th>Заказы, ₽</th><th>Пред. период</th><th>Динамика</th><th>Заказы, шт.</th><th>Валовая прибыль</th><th>Маржа</th><th>Чистая прибыль</th><th>Рентабельность</th></tr></thead><tbody>{cabinetRows.map(row => <tr key={row.id}><th>{row.name}</th><td>{money(row.currentOwn.orderedAmount)}</td><td>{money(row.previousOwn.orderedAmount)}</td><td>{delta(getPercentDelta(row.currentOwn.orderedAmount, row.previousOwn.orderedAmount))}</td><td>{number(row.currentOwn.orders)}</td><td>{money(row.currentFinance.grossProfit)}</td><td>{percent(row.currentFinance.grossMargin)}</td><td>{money(row.currentFinance.netProfit)}</td><td>{percent(row.currentFinance.profitability)}</td></tr>)}</tbody></table></div></section>
    </>}
  </section>;
}
