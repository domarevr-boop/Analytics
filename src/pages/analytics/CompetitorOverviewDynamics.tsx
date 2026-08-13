import { useMemo, useState } from 'react';
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import DateRangeFilter from '../../components/DateRangeFilter';
import { aggregateCompetitorBrands } from '../../data/competitorCalculations';
import type { CompetitorBrandSummary } from '../../data/competitorCalculations';
import type { CompetitorFunnelRecord } from '../../types';

type TrendMetricKey = 'amount' | 'orders' | 'price' | 'share' | 'impressions' | 'ctr' | 'carts' | 'cartCr' | 'orderCr' | 'buyoutRate';
type MetricKind = 'money' | 'count' | 'percent';

const number = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 1 });
const money = (value: number) => `${number.format(value)} ₽`;
const percent = (value: number) => `${number.format(value)}%`;
const shortDate = (value: string) => value.slice(5).split('-').reverse().join('.');
const colors = ['#2563EB', '#10A778', '#F59E0B', '#8B5CF6', '#EF5B70', '#0EA5E9', '#64748B', '#84CC16'];

const metrics: Record<TrendMetricKey, { label: string; kind: MetricKind; value: (row: CompetitorBrandSummary) => number }> = {
  amount: { label: 'Сумма заказов', kind: 'money', value: row => row.amount },
  orders: { label: 'Заказы', kind: 'count', value: row => row.orders },
  price: { label: 'Средняя цена', kind: 'money', value: row => row.price },
  share: { label: 'Доля среза', kind: 'percent', value: row => row.share },
  impressions: { label: 'Показы', kind: 'count', value: row => row.impressions },
  ctr: { label: 'CTR', kind: 'percent', value: row => row.ctr },
  carts: { label: 'Корзины', kind: 'count', value: row => row.carts },
  cartCr: { label: 'CR показ → корзина', kind: 'percent', value: row => row.cartCr },
  orderCr: { label: 'CR показ → заказ', kind: 'percent', value: row => row.orderCr },
  buyoutRate: { label: 'Выкуп', kind: 'percent', value: row => row.buyoutRate },
};
const metricKeys = Object.keys(metrics) as TrendMetricKey[];
const formatMetric = (value: number, kind: MetricKind) => kind === 'money' ? money(value) : kind === 'percent' ? percent(value) : number.format(value);

function MultiChoice({ label, values, options, max, onChange }: { label: string; values: string[]; options: Array<{ value: string; label: string }>; max: number; onChange: (values: string[]) => void }) {
  return <details className="competitor-multi-choice"><summary><span>{label}</span><strong>{values.length ? `${values.length} выбрано` : 'Не выбрано'}</strong></summary><div>{options.map(option => { const checked = values.includes(option.value); const disabled = !checked && values.length >= max; return <label key={option.value}><input type="checkbox" checked={checked} disabled={disabled} onChange={() => onChange(checked ? values.filter(value => value !== option.value) : [...values, option.value])} /><span>{option.label}</span></label>; })}<small>Можно выбрать до {max}</small></div></details>;
}

export default function CompetitorOverviewDynamics({ rows, ownArticles }: { rows: CompetitorFunnelRecord[]; ownArticles: Set<string> }) {
  const dates = useMemo(() => [...new Set(rows.map(row => row.date))].sort(), [rows]);
  const allBrands = useMemo(() => aggregateCompetitorBrands(rows, ownArticles), [rows, ownArticles]);
  const defaultBrands = useMemo(() => {
    const own = allBrands.find(row => row.own);
    return [own, ...allBrands.filter(row => !row.own).slice(0, own ? 2 : 3)].filter(Boolean).map(row => row!.key);
  }, [allBrands]);
  const [start, setStart] = useState(dates[0] || '');
  const [end, setEnd] = useState(dates.at(-1) || '');
  const [selectedBrands, setSelectedBrands] = useState<string[]>(defaultBrands);
  const [selectedMetrics, setSelectedMetrics] = useState<string[]>(['amount', 'orders']);
  const activeStart = start || dates[0] || '';
  const activeEnd = end || dates.at(-1) || '';
  const activeBrands = selectedBrands.filter(key => allBrands.some(row => row.key === key));
  const effectiveBrands = activeBrands.length ? activeBrands : defaultBrands;
  const activeMetrics = selectedMetrics.filter((key): key is TrendMetricKey => key in metrics);
  const effectiveMetrics: TrendMetricKey[] = activeMetrics.length ? activeMetrics : ['amount'];
  const visibleDates = dates.filter(date => date >= activeStart && date <= activeEnd);
  const daily = useMemo(() => visibleDates.map(date => ({ date, brands: aggregateCompetitorBrands(rows.filter(row => row.date === date), ownArticles) })), [visibleDates, rows, ownArticles]);
  const series = effectiveBrands.flatMap(brandKey => effectiveMetrics.map(metric => ({ id: `${brandKey}::${metric}`, brandKey, metric })));
  const valueAt = (brands: CompetitorBrandSummary[], brandKey: string, metric: TrendMetricKey) => {
    const brand = brands.find(row => row.key === brandKey);
    return brand ? metrics[metric].value(brand) : 0;
  };
  const bases = new Map(series.map(item => [item.id, daily.map(point => valueAt(point.brands, item.brandKey, item.metric)).find(value => value > 0) || 0]));
  const chartData = daily.map(point => {
    const record: Record<string, string | number | null | Record<string, number>> = { date: point.date };
    const actual: Record<string, number> = {};
    series.forEach(item => {
      const value = valueAt(point.brands, item.brandKey, item.metric);
      const base = bases.get(item.id) || 0;
      record[item.id] = base ? value / base * 100 : null;
      actual[item.id] = value;
    });
    record.actual = actual;
    return record;
  });
  const brandByKey = new Map(allBrands.map(row => [row.key, row]));

  return <section className="competitors-section competitor-overview-trend">
    <header><div><span>ДИНАМИКА ПОКАЗАТЕЛЕЙ</span><h2>Бренды и метрики во времени</h2><p>Чтобы сопоставлять рубли, штуки и проценты, каждый ряд показан индексом: первое ненулевое значение периода = 100.</p></div></header>
    <div className="competitor-trend-toolbar"><DateRangeFilter label="Период графика" value={{ start: activeStart, end: activeEnd }} onChange={period => { setStart(period.start); setEnd(period.end); }} maxDate={dates.at(-1) || activeEnd} /><MultiChoice label="Бренды" values={effectiveBrands} options={allBrands.map(row => ({ value: row.key, label: row.brand }))} max={4} onChange={setSelectedBrands} /><MultiChoice label="Метрики" values={effectiveMetrics} options={metricKeys.map(key => ({ value: key, label: metrics[key].label }))} max={2} onChange={setSelectedMetrics} /><span>{visibleDates.length} дней · {series.length} рядов</span></div>
    {visibleDates.length > 1 && series.length ? <ResponsiveContainer width="100%" height={320}><LineChart data={chartData} margin={{ top: 12, right: 18, left: 2, bottom: 2 }}><CartesianGrid stroke="#E6ECF2" strokeDasharray="3 3" vertical={false} /><XAxis dataKey="date" tickFormatter={shortDate} minTickGap={24} tick={{ fontSize: 9 }} /><YAxis tickFormatter={value => `${number.format(Number(value))}`} width={44} tick={{ fontSize: 9 }} /><Tooltip content={({ active, payload, label }) => { if (!active || !payload?.length) return null; const actual = payload[0]?.payload?.actual as Record<string, number>; return <div className="competitor-tooltip competitor-trend-tooltip"><strong>{shortDate(String(label))}</strong>{payload.map(item => { const itemId = String(item.dataKey); const [brandKey, metricKey] = itemId.split('::') as [string, TrendMetricKey]; return <span key={itemId}><i style={{ background: item.color }} />{brandByKey.get(brandKey)?.brand} · {metrics[metricKey].label}: <b>{formatMetric(actual[itemId] || 0, metrics[metricKey].kind)}</b> <em>({number.format(Number(item.value))})</em></span>; })}</div>; }} />{series.map((item, index) => <Line key={item.id} type="monotone" dataKey={item.id} name={`${brandByKey.get(item.brandKey)?.brand} · ${metrics[item.metric].label}`} stroke={colors[index % colors.length]} strokeWidth={2} dot={visibleDates.length <= 10 ? { r: 2 } : false} connectNulls />)}</LineChart></ResponsiveContainer> : <div className="competitor-trend-empty">Для динамики нужны минимум две даты и хотя бы один выбранный бренд и показатель.</div>}
    <div className="competitor-trend-legend">{series.map((item, index) => <span key={item.id}><i style={{ background: colors[index % colors.length] }} />{brandByKey.get(item.brandKey)?.brand} · {metrics[item.metric].label}</span>)}</div>
  </section>;
}
