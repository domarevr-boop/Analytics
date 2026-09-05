import { useMemo, useState, useSyncExternalStore } from 'react';
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import AnalyticsHelp from '../../components/AnalyticsHelp';
import {
  AnalyticsPageHeader,
  AnalyticsPanel,
  AnalyticsToolbar,
  EmptyState,
  KpiTile,
  PanelHeader,
  SegmentedControl,
} from '../../components/AnalyticsPrimitives';
import DateRangeFilter from '../../components/DateRangeFilter';
import { getMarketDynamics, getVersion, subscribe } from '../../data/store';
import type { MarketDynamicsRecord } from '../../types';
import { marketHelp } from './analyticsHelpContent';
import MarketDeepDive from './MarketDeepDive';
import './MarketPage.css';

type Granularity = 'day' | 'week' | 'month';
type MetricKey = 'marketAmount' | 'ownAmount' | 'amountShare' | 'marketOrders' | 'ownOrders' | 'ordersShare' | 'marketCheck' | 'ownCheck';
type Point = { date: string; marketAmount: number; ownAmount: number; amountShare: number; marketOrders: number; ownOrders: number; ordersShare: number; marketCheck: number; ownCheck: number };

const pad = (value: number) => String(value).padStart(2, '0');
const fmt = (value: number, digits = 0) => new Intl.NumberFormat('ru-RU', { maximumFractionDigits: digits }).format(value || 0);
const shortDate = (value: string) => value.length === 10 ? `${value.slice(8, 10)}.${value.slice(5, 7)}` : value;
const addDays = (date: string, amount: number) => { const value = new Date(`${date}T00:00:00`); value.setDate(value.getDate() + amount); return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`; };
const previousPeriod = (start: string, end: string) => { const days = Math.round((new Date(`${end}T00:00:00`).getTime() - new Date(`${start}T00:00:00`).getTime()) / 86400000) + 1; const previousEnd = addDays(start, -1); return { start: addDays(previousEnd, -days + 1), end: previousEnd }; };
const bucketKey = (date: string, granularity: Granularity) => { if (granularity === 'month') return date.slice(0, 7); if (granularity === 'day') return date; const value = new Date(`${date}T00:00:00`); const day = value.getDay() || 7; value.setDate(value.getDate() - day + 1); return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`; };
const delta = (current: number, previous: number) => previous ? (current - previous) / Math.abs(previous) * 100 : current ? 100 : 0;

function aggregate(rows: MarketDynamicsRecord[], granularity: Granularity): Point[] {
  const buckets = new Map<string, MarketDynamicsRecord[]>();
  rows.forEach(row => { const key = bucketKey(row.date, granularity); buckets.set(key, [...(buckets.get(key) || []), row]); });
  return [...buckets.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([date, values]) => {
    const marketAmount = values.reduce((sum, row) => sum + row.market_ordered_amount, 0);
    const ownAmount = values.reduce((sum, row) => sum + row.own_ordered_amount, 0);
    const marketOrders = values.reduce((sum, row) => sum + row.market_orders, 0);
    const ownOrders = values.reduce((sum, row) => sum + row.own_orders, 0);
    return { date, marketAmount, ownAmount, amountShare: marketAmount ? ownAmount / marketAmount * 100 : 0, marketOrders, ownOrders, ordersShare: marketOrders ? ownOrders / marketOrders * 100 : 0, marketCheck: marketOrders ? marketAmount / marketOrders : 0, ownCheck: ownOrders ? ownAmount / ownOrders : 0 };
  });
}

function summarize(rows: MarketDynamicsRecord[]) {
  return aggregate(rows, 'month').reduce((total, point) => ({ ...total, marketAmount: total.marketAmount + point.marketAmount, ownAmount: total.ownAmount + point.ownAmount, marketOrders: total.marketOrders + point.marketOrders, ownOrders: total.ownOrders + point.ownOrders }), { marketAmount: 0, ownAmount: 0, marketOrders: 0, ownOrders: 0 });
}

function Sparkline({ values, color }: { values: number[]; color: string }) {
  const width = 60; const height = 22; const min = Math.min(...values, 0); const max = Math.max(...values, 1); const range = max - min || 1;
  const points = values.length > 1 ? values.map((value, index) => `${index / (values.length - 1) * width},${height - 2 - (value - min) / range * (height - 4)}`).join(' ') : '0,11 60,11';
  return <svg viewBox={`0 0 ${width} ${height}`} aria-hidden="true"><polyline points={points} fill="none" stroke={color} strokeWidth="2" /></svg>;
}

const metricMeta: Record<MetricKey, { title: string; color: string; percent?: boolean; money?: boolean }> = {
  marketAmount: { title: 'Рынок — сумма заказов', color: 'var(--ds-series-market)', money: true },
  ownAmount: { title: 'Наши заказы — сумма', color: 'var(--ds-series-own)', money: true },
  amountShare: { title: 'Доля рынка — сумма', color: 'var(--ds-series-own)', percent: true },
  marketOrders: { title: 'Рынок — заказы, шт', color: 'var(--ds-series-market)' },
  ownOrders: { title: 'Наши заказы — шт', color: 'var(--ds-series-own)' },
  ordersShare: { title: 'Доля рынка — шт', color: 'var(--ds-series-own)', percent: true },
  marketCheck: { title: 'Средний чек рынка', color: 'var(--ds-series-benchmark)', money: true },
  ownCheck: { title: 'Наш средний чек', color: 'var(--ds-series-own)', money: true },
};

export default function MarketPage() {
  useSyncExternalStore(subscribe, getVersion);
  const records = getMarketDynamics();
  const dates = useMemo(() => [...new Set(records.map(row => row.date))].sort(), [records]);
  const maxDate = dates.at(-1) || new Date().toISOString().slice(0, 10);
  const [period, setPeriod] = useState(() => ({ start: dates.at(0) || maxDate, end: maxDate }));
  const [granularity, setGranularity] = useState<Granularity>('day');
  const [showHelp, setShowHelp] = useState(false);
  const currentRows = useMemo(() => records.filter(row => row.date >= period.start && row.date <= period.end), [records, period]);
  const comparison = useMemo(() => previousPeriod(period.start, period.end), [period]);
  const previousRows = useMemo(() => records.filter(row => row.date >= comparison.start && row.date <= comparison.end), [records, comparison]);
  const points = useMemo(() => aggregate(currentRows, granularity), [currentRows, granularity]);
  const totals = useMemo(() => summarize(currentRows), [currentRows]);
  const previousTotals = useMemo(() => summarize(previousRows), [previousRows]);
  const amountShare = totals.marketAmount ? totals.ownAmount / totals.marketAmount * 100 : 0;
  const ordersShare = totals.marketOrders ? totals.ownOrders / totals.marketOrders * 100 : 0;
  const marketCheck = totals.marketOrders ? totals.marketAmount / totals.marketOrders : 0;
  const ownCheck = totals.ownOrders ? totals.ownAmount / totals.ownOrders : 0;
  const previousAmountShare = previousTotals.marketAmount ? previousTotals.ownAmount / previousTotals.marketAmount * 100 : 0;
  const previousOrdersShare = previousTotals.marketOrders ? previousTotals.ownOrders / previousTotals.marketOrders * 100 : 0;
  const previousMarketCheck = previousTotals.marketOrders ? previousTotals.marketAmount / previousTotals.marketOrders : 0;
  const previousOwnCheck = previousTotals.ownOrders ? previousTotals.ownAmount / previousTotals.ownOrders : 0;
  const kpis: Array<{ key: MetricKey; value: number; change: number; points?: boolean }> = [
    { key: 'marketAmount', value: totals.marketAmount, change: delta(totals.marketAmount, previousTotals.marketAmount) },
    { key: 'ownAmount', value: totals.ownAmount, change: delta(totals.ownAmount, previousTotals.ownAmount) },
    { key: 'amountShare', value: amountShare, change: amountShare - previousAmountShare, points: true },
    { key: 'marketOrders', value: totals.marketOrders, change: delta(totals.marketOrders, previousTotals.marketOrders) },
    { key: 'ownOrders', value: totals.ownOrders, change: delta(totals.ownOrders, previousTotals.ownOrders) },
    { key: 'ordersShare', value: ordersShare, change: ordersShare - previousOrdersShare, points: true },
    { key: 'marketCheck', value: marketCheck, change: delta(marketCheck, previousMarketCheck) },
    { key: 'ownCheck', value: ownCheck, change: delta(ownCheck, previousOwnCheck) },
  ];
  const chartPairs: Array<{ title: string; description: string; metrics: MetricKey[] }> = [
    { title: 'Динамика заказов по сумме', description: 'Сравнение рынка и наших заказов в денежном выражении.', metrics: ['marketAmount', 'ownAmount'] },
    { title: 'Динамика доли рынка по сумме', description: 'Наша доля в общей сумме заказов рынка.', metrics: ['amountShare'] },
    { title: 'Динамика заказов в штуках', description: 'Сравнение количества заказов рынка и наших заказов.', metrics: ['marketOrders', 'ownOrders'] },
    { title: 'Динамика доли рынка в штуках', description: 'Наша доля в общем количестве заказов рынка.', metrics: ['ordersShare'] },
  ];
  const insights = [
    { label: 'Рост рынка по сумме', change: delta(totals.marketAmount, previousTotals.marketAmount), format: `${fmt(totals.marketAmount)} ₽` },
    { label: 'Рост наших заказов', change: delta(totals.ownAmount, previousTotals.ownAmount), format: `${fmt(totals.ownAmount)} ₽` },
    { label: 'Изменение доли по сумме', change: amountShare - previousAmountShare, format: `${fmt(amountShare, 2)}%`, points: true },
    { label: 'Средний чек: рынок / мы', change: marketCheck ? (ownCheck - marketCheck) / marketCheck * 100 : 0, format: `${fmt(marketCheck)} ₽ / ${fmt(ownCheck)} ₽` },
  ];

  if (showHelp) return <AnalyticsHelp data={marketHelp} onClose={() => setShowHelp(false)} />;

  return <div className="market-page-pilot analytics-page-shell ds-page">
    <AnalyticsPageHeader eyebrow="Аналитика › Рынок" title="Рынок" description="Сравнение объёма рынка и наших результатов по сумме заказов, штукам, доле и среднему чеку." meta={<span>Данные по {shortDate(maxDate)}</span>} actions={<button type="button" className="ds-button" onClick={() => setShowHelp(true)}>Справка</button>} />
    <AnalyticsToolbar trailing={<><SegmentedControl value={granularity} label="Гранулярность графиков" options={[{ value: 'day', label: 'День' }, { value: 'week', label: 'Неделя' }, { value: 'month', label: 'Месяц' }]} onChange={setGranularity} /><button type="button" className="ds-button" onClick={() => setPeriod({ start: dates.at(0) || maxDate, end: maxDate })}>Сбросить</button></>}>
      <DateRangeFilter label="Период" value={period} onChange={setPeriod} maxDate={maxDate} />
    </AnalyticsToolbar>
    {!currentRows.length ? <EmptyState title="Нет данных рынка в выбранном периоде" description="Импортируйте файл с колонками «Дата», «Заказы рынок», «Наши заказы» и показателями в штуках." /> : <>
      <section className="ds-kpi-grid market-pilot-kpis" aria-label="Ключевые показатели рынка">{kpis.map(item => { const meta = metricMeta[item.key]; return <KpiTile key={item.key} label={meta.title} value={meta.percent ? `${fmt(item.value, 2)}%` : meta.money ? `${fmt(item.value)} ₽` : fmt(item.value)} delta={fmt(Math.abs(item.change), item.points ? 2 : 1)} deltaSuffix={item.points ? ' п.п.' : '%'} comparison="к пред. периоду" tone={item.change > 0 ? 'positive' : item.change < 0 ? 'negative' : 'neutral'} visual={<Sparkline values={points.map(point => Number(point[item.key]))} color={meta.color} />} />; })}</section>
      <section className="market-pilot-chart-grid">{chartPairs.map(chart => <AnalyticsPanel key={chart.title} className="market-pilot-chart" density="analytics">
        <PanelHeader title={chart.title} description={chart.description} controls={<span className="market-pilot-period-label">{granularity === 'day' ? 'По дням' : granularity === 'week' ? 'По неделям' : 'По месяцам'}</span>} />
        <ResponsiveContainer width="100%" height={245}><LineChart data={points} margin={{ top: 10, right: 14, left: 6, bottom: 2 }}><CartesianGrid stroke="var(--ds-color-border-soft)" strokeDasharray="3 3" /><XAxis dataKey="date" tickFormatter={shortDate} tick={{ fontSize: 9 }} /><YAxis tick={{ fontSize: 9 }} tickFormatter={value => chart.metrics.some(metric => metricMeta[metric].percent) ? `${fmt(Number(value), 1)}%` : fmt(Number(value))} /><Tooltip labelFormatter={label => shortDate(String(label ?? ''))} formatter={(value, name) => { const meta = metricMeta[name as MetricKey]; return [meta.percent ? `${fmt(Number(value), 2)}%` : meta.money ? `${fmt(Number(value))} ₽` : fmt(Number(value)), meta.title]; }} />{chart.metrics.map(metric => <Line key={metric} type="monotone" dataKey={metric} stroke={metricMeta[metric].color} strokeWidth={2} dot={false} />)}</LineChart></ResponsiveContainer>
        <div className="market-pilot-legend">{chart.metrics.map(metric => <span key={metric}><i style={{ background: metricMeta[metric].color }} />{metricMeta[metric].title}</span>)}</div>
      </AnalyticsPanel>)}</section>
      <MarketDeepDive
        points={points}
        currentTotals={totals}
        previousTotals={previousTotals}
        comparisonLabel={`${shortDate(comparison.start)} — ${shortDate(comparison.end)}`}
      />
      <AnalyticsPanel className="market-pilot-insights" density="data">
        <div className="market-pilot-table-heading"><PanelHeader title="Ключевые выводы" description={`Сравнение с предыдущим равным периодом: ${shortDate(comparison.start)} — ${shortDate(comparison.end)}`} /></div>
        <div className="market-pilot-insight-table"><div className="head"><span>Показатель</span><span>Текущее значение</span><span>Изменение</span><span>Тренд</span><span>Комментарий</span></div>{insights.map((item, index) => <div key={item.label}><strong>{item.label}</strong><span>{item.format}</span><b className={item.change > 0 ? 'positive' : item.change < 0 ? 'negative' : ''}>{item.change > 0 ? '+' : ''}{fmt(item.change, item.points ? 2 : 1)}{item.points ? ' п.п.' : '%'}</b><Sparkline values={index === 0 ? points.map(point => point.marketAmount) : index === 1 ? points.map(point => point.ownAmount) : index === 2 ? points.map(point => point.amountShare) : points.map(point => point.ownCheck)} color={index === 0 ? 'var(--ds-series-market)' : 'var(--ds-series-own)'} /><span>{index === 0 ? 'Показывает изменение общего спроса.' : index === 1 ? item.change >= 0 ? 'Наши продажи растут.' : 'Наши продажи снижаются.' : index === 2 ? item.change >= 0 ? 'Доля рынка укрепилась.' : 'Доля рынка снизилась.' : ownCheck >= marketCheck ? 'Наш средний чек выше рыночного.' : 'Наш средний чек ниже рыночного.'}</span></div>)}</div>
      </AnalyticsPanel>
    </>}
  </div>;
}
