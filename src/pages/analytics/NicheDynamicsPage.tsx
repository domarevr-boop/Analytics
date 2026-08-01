import { Fragment, useMemo, useState, useSyncExternalStore } from 'react';
import { Area, Bar, BarChart, CartesianGrid, ComposedChart, Line, PolarAngleAxis, PolarGrid, PolarRadiusAxis, Radar, RadarChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import DateRangeFilter from '../../components/DateRangeFilter';
import { getMetrics, getNicheDynamics, getProducts, getVersion, subscribe } from '../../data/store';
import type { NicheDynamicsRecord } from '../../types';

type Granularity = 'day' | 'month' | 'quarter';
type MetricKey = 'marketAmount' | 'marketUnits' | 'ownAmount' | 'ownUnits' | 'marketShareAmount' | 'marketShareUnits' | 'sellers' | 'activeSellers' | 'avgCheck' | 'productCards' | 'activeCards' | 'activeCardShare' | 'monopolization' | 'turnover' | 'avgStock' | 'buyoutRate' | 'avgRating';
type MatrixGroup = 'Рынок' | 'Наши показатели' | 'Структура рынка';

interface MarketPoint {
  period: string;
  date: string;
  marketAmount: number;
  marketUnits: number;
  ownAmount: number;
  ownUnits: number;
  marketShareAmount: number;
  marketShareUnits: number;
  sellers: number;
  activeSellers: number;
  activeSellerShare: number;
  avgCheck: number;
  productCards: number;
  activeCards: number;
  activeCardShare: number;
  monopolization: number;
  turnover: number;
  availability: string;
  avgStock: number;
  buyoutRate: number;
  avgRating: number;
  matchedSubjects: number;
  totalSubjects: number;
}

interface MatrixRow {
  key: MetricKey | 'activeSellerShare';
  label: string;
  group: MatrixGroup;
  values: number[];
  format: (value: number) => string;
  inverse?: boolean;
}

const metricLabels: Record<MetricKey, string> = {
  marketAmount: 'Рынок — сумма заказов', marketUnits: 'Рынок — заказы, шт.', ownAmount: 'Наши — сумма заказов', ownUnits: 'Наши — заказы, шт.',
  marketShareAmount: 'Доля рынка, сум', marketShareUnits: 'Доля рынка, шт', sellers: 'Продавцы', activeSellers: 'Продавцы с заказами', avgCheck: 'Средний чек',
  productCards: 'Карточки товара', activeCards: 'Карточки с заказами', activeCardShare: 'Доля карточек с заказами', monopolization: 'Монополизация', turnover: 'Оборачиваемость',
  avgStock: 'Средние остатки', buyoutRate: 'Процент выкупа', avgRating: 'Средний рейтинг',
};
const percentMetrics = new Set<MetricKey>(['marketShareAmount', 'marketShareUnits', 'activeCardShare', 'monopolization', 'buyoutRate']);
const matrixGroups: MatrixGroup[] = ['Рынок', 'Наши показатели', 'Структура рынка'];
const fmt = (value: number, digits = 0) => new Intl.NumberFormat('ru-RU', { maximumFractionDigits: digits }).format(value || 0);
const normalize = (value: string) => value.trim().toLocaleLowerCase('ru-RU').replace(/ё/g, 'е').replace(/\s+/g, ' ');
const addDays = (date: string, amount: number) => { const value = new Date(`${date}T00:00:00`); value.setDate(value.getDate() + amount); return value.toISOString().slice(0, 10); };
const shortDate = (value: string) => value.includes('-') && value.length === 10 ? value.slice(5).split('-').reverse().join('.') : value;

function weighted(rows: NicheDynamicsRecord[], field: keyof NicheDynamicsRecord) {
  const weight = rows.reduce((sum, row) => sum + row.revenue, 0);
  return weight ? rows.reduce((sum, row) => sum + Number(row[field] || 0) * row.revenue, 0) / weight : 0;
}

function quarterKey(date: string) {
  const month = Number(date.slice(5, 7));
  return `${date.slice(0, 4)} Q${Math.ceil(month / 3)}`;
}

function combinePoints(period: string, points: MarketPoint[]): MarketPoint {
  const marketAmount = points.reduce((sum, point) => sum + point.marketAmount, 0);
  const marketUnits = points.reduce((sum, point) => sum + point.marketUnits, 0);
  const ownAmount = points.reduce((sum, point) => sum + point.ownAmount, 0);
  const ownUnits = points.reduce((sum, point) => sum + point.ownUnits, 0);
  const weightedValue = (field: keyof MarketPoint) => marketAmount ? points.reduce((sum, point) => sum + Number(point[field] || 0) * point.marketAmount, 0) / marketAmount : 0;
  const sellers = points.reduce((sum, point) => sum + point.sellers, 0);
  const activeSellers = points.reduce((sum, point) => sum + point.activeSellers, 0);
  const productCards = points.reduce((sum, point) => sum + point.productCards, 0);
  const activeCards = points.reduce((sum, point) => sum + point.activeCards, 0);
  return { period, date: points.at(-1)?.date || '', marketAmount, marketUnits, ownAmount, ownUnits, marketShareAmount: marketAmount ? ownAmount / marketAmount * 100 : 0, marketShareUnits: marketUnits ? ownUnits / marketUnits * 100 : 0, sellers, activeSellers, activeSellerShare: sellers ? activeSellers / sellers * 100 : 0, avgCheck: marketUnits ? marketAmount / marketUnits : weightedValue('avgCheck'), productCards, activeCards, activeCardShare: productCards ? activeCards / productCards * 100 : 0, monopolization: weightedValue('monopolization'), turnover: weightedValue('turnover'), availability: points.at(-1)?.availability || '—', avgStock: weightedValue('avgStock'), buyoutRate: weightedValue('buyoutRate'), avgRating: weightedValue('avgRating'), matchedSubjects: points.reduce((sum, point) => sum + point.matchedSubjects, 0), totalSubjects: points.reduce((sum, point) => sum + point.totalSubjects, 0) };
}

function Sparkline({ values, tone = 'blue' }: { values: number[]; tone?: 'blue' | 'green' | 'amber' }) {
  const width = 68;
  const height = 22;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const points = values.length > 1
    ? values.map((value, index) => `${(index / (values.length - 1)) * width},${height - 2 - ((value - min) / range) * (height - 4)}`).join(' ')
    : `0,${height / 2} ${width},${height / 2}`;
  return <svg className={`niche-sparkline niche-sparkline-${tone}`} viewBox={`0 0 ${width} ${height}`} aria-hidden="true"><polyline points={points} /></svg>;
}

function deltaLabel(row: MatrixRow) {
  const first = row.values.at(0) || 0;
  const last = row.values.at(-1) || 0;
  const difference = last - first;
  if (percentMetrics.has(row.key as MetricKey) || row.key === 'activeSellerShare') return `${difference >= 0 ? '+' : ''}${fmt(difference, 2)} п.п.`;
  if (!first) return last ? 'новые данные' : '—';
  return `${difference >= 0 ? '+' : ''}${fmt(difference / Math.abs(first) * 100, 1)}%`;
}

function heatColor(values: number[], value: number, inverse = false) {
  const min = Math.min(...values);
  const max = Math.max(...values);
  if (max === min) return '#FFFFFF';
  let score = (value - min) / (max - min);
  if (inverse) score = 1 - score;
  const distance = Math.abs(score - 0.5) * 2;
  if (distance < 0.12) return '#FFFFFF';
  const alpha = 0.08 + distance * 0.2;
  return score >= 0.5 ? `rgba(77, 177, 108, ${alpha})` : `rgba(225, 101, 124, ${alpha})`;
}

export default function NicheDynamicsPage() {
  useSyncExternalStore(subscribe, getVersion);
  const records = getNicheDynamics();
  const products = getProducts();
  const metrics = getMetrics();
  const dates = useMemo(() => [...new Set(records.map(row => row.date))].sort(), [records]);
  const [start, setStart] = useState(() => dates.at(0) || '2026-07-01');
  const [end, setEnd] = useState(() => dates.at(-1) || '2026-07-31');
  const [category, setCategory] = useState('');
  const [subject, setSubject] = useState('');
  const [metric, setMetric] = useState<MetricKey>('marketAmount');
  const [granularity, setGranularity] = useState<Granularity>('day');

  const categories = useMemo(() => [...new Set(records.map(row => row.category))].sort((a, b) => a.localeCompare(b, 'ru')), [records]);
  const subjects = useMemo(() => [...new Set(records.filter(row => !category || row.category === category).map(row => row.subject))].sort((a, b) => a.localeCompare(b, 'ru')), [records, category]);
  const filtered = useMemo(() => records.filter(row => row.date >= start && row.date <= end && (!category || row.category === category) && (!subject || row.subject === subject)), [records, start, end, category, subject]);
  const productCategoryById = useMemo(() => new Map(products.map(product => [product.id, normalize(product.category || '')])), [products]);
  const metricsByDate = useMemo(() => [...metrics].sort((a, b) => a.date.localeCompare(b.date)), [metrics]);

  const dailyPoints = useMemo(() => {
    const result: MarketPoint[] = [];
    for (const date of [...new Set(filtered.map(row => row.date))].sort()) {
      const dayRows = filtered.filter(row => row.date === date);
      const marketAmount = dayRows.reduce((sum, row) => sum + row.revenue, 0);
      const avgCheck = weighted(dayRows, 'avg_check');
      const marketUnits = avgCheck ? marketAmount / avgCheck : 0;
      const subjectNames = new Set(dayRows.map(row => normalize(row.subject)));
      const matchedProductIds = new Set(products.filter(product => subjectNames.has(normalize(product.category || ''))).map(product => product.id));
      const ownStart = addDays(date, -29);
      const ownRows = metricsByDate.filter(row => row.date >= ownStart && row.date <= date && matchedProductIds.has(row.product_id));
      const ownAmount = ownRows.reduce((sum, row) => sum + row.ordered_amount, 0);
      const ownUnits = ownRows.reduce((sum, row) => sum + row.orders, 0);
      const sellers = dayRows.reduce((sum, row) => sum + row.sellers, 0);
      const activeSellers = dayRows.reduce((sum, row) => sum + row.active_sellers, 0);
      const productCards = dayRows.reduce((sum, row) => sum + row.product_cards, 0);
      const activeCards = dayRows.reduce((sum, row) => sum + row.active_product_cards, 0);
      const matchedSubjects = new Set([...matchedProductIds].map(id => productCategoryById.get(id)).filter(Boolean)).size;
      result.push({ period: date, date, marketAmount, marketUnits, ownAmount, ownUnits, marketShareAmount: marketAmount ? ownAmount / marketAmount * 100 : 0, marketShareUnits: marketUnits ? ownUnits / marketUnits * 100 : 0, sellers, activeSellers, activeSellerShare: sellers ? activeSellers / sellers * 100 : 0, avgCheck, productCards, activeCards, activeCardShare: productCards ? activeCards / productCards * 100 : 0, monopolization: weighted(dayRows, 'monopolization'), turnover: weighted(dayRows, 'weekly_turnover_days'), availability: dayRows.map(row => row.availability).filter(Boolean)[0] || '—', avgStock: weighted(dayRows, 'avg_stock'), buyoutRate: weighted(dayRows, 'buyout_rate'), avgRating: weighted(dayRows, 'avg_rating'), matchedSubjects, totalSubjects: subjectNames.size });
    }
    return result;
  }, [filtered, metricsByDate, products, productCategoryById]);

  const points = useMemo(() => {
    if (granularity === 'day') return dailyPoints;
    const monthlyLatest = new Map<string, MarketPoint>();
    for (const point of dailyPoints) monthlyLatest.set(point.date.slice(0, 7), point);
    if (granularity === 'month') return [...monthlyLatest.entries()].map(([period, point]) => ({ ...point, period }));
    const byQuarter = new Map<string, MarketPoint[]>();
    for (const point of monthlyLatest.values()) {
      const key = quarterKey(point.date);
      const list = byQuarter.get(key) || [];
      list.push(point);
      byQuarter.set(key, list);
    }
    return [...byQuarter.entries()].map(([period, quarterPoints]) => combinePoints(period, quarterPoints.sort((a, b) => a.date.localeCompare(b.date))));
  }, [dailyPoints, granularity]);

  const latest = dailyPoints.at(-1);
  const first = dailyPoints.at(0);
  const periodChange = (current: number, base: number) => base ? (current - base) / Math.abs(base) * 100 : current ? 100 : 0;
  const topSubjects = useMemo(() => {
    const latestDate = dailyPoints.at(-1)?.date;
    return filtered.filter(row => row.date === latestDate).sort((a, b) => b.revenue - a.revenue).slice(0, 8).map(row => {
      const productIds = new Set(products.filter(product => normalize(product.category || '') === normalize(row.subject)).map(product => product.id));
      const ownStart = latestDate ? addDays(latestDate, -29) : '';
      const ownAmount = metricsByDate.filter(item => item.date >= ownStart && item.date <= (latestDate || '') && productIds.has(item.product_id)).reduce((sum, item) => sum + item.ordered_amount, 0);
      return { name: row.subject, amount: row.revenue, ownAmount, share: row.revenue ? ownAmount / row.revenue * 100 : 0 };
    });
  }, [filtered, dailyPoints, products, metricsByDate]);

  const indexData = useMemo(() => {
    const marketBase = points[0]?.marketAmount || 1;
    const ownBase = points[0]?.ownAmount || 1;
    const selectedBase = Number(points[0]?.[metric] || 1);
    return points.map(point => ({ ...point, marketIndex: point.marketAmount / marketBase * 100, ownIndex: point.ownAmount / ownBase * 100, selectedIndex: Number(point[metric] || 0) / selectedBase * 100 }));
  }, [points, metric]);

  const radarData = useMemo(() => {
    if (!latest) return [];
    const cap = (value: number) => Math.max(0, Math.min(100, value));
    return [
      { metric: 'Доля рынка', market: 70, own: cap(latest.marketShareAmount * 12) },
      { metric: 'Конкуренция', market: cap(100 - latest.monopolization * 5), own: cap(55 + latest.marketShareAmount * 4) },
      { metric: 'Оборачиваемость', market: cap(100 - latest.turnover), own: cap(100 - latest.turnover * .8) },
      { metric: 'Средний чек', market: 75, own: cap(latest.avgCheck ? latest.ownAmount / Math.max(latest.ownUnits, 1) / latest.avgCheck * 75 : 0) },
      { metric: 'Выкуп', market: cap(latest.buyoutRate), own: cap(latest.buyoutRate + 4) },
    ];
  }, [latest]);

  const matrixRows = useMemo<MatrixRow[]>(() => {
    const values = (key: keyof MarketPoint) => points.map(point => Number(point[key]) || 0);
    const money = (value: number) => `${fmt(value)} ₽`;
    const count = (value: number) => fmt(value);
    const percent = (value: number) => `${fmt(value, 2)}%`;
    return [
      { key: 'marketAmount', label: 'Сумма заказов', group: 'Рынок', values: values('marketAmount'), format: money },
      { key: 'marketUnits', label: 'Заказы, шт.', group: 'Рынок', values: values('marketUnits'), format: count },
      { key: 'avgCheck', label: 'Средний чек', group: 'Рынок', values: values('avgCheck'), format: money },
      { key: 'ownAmount', label: 'Наша сумма заказов', group: 'Наши показатели', values: values('ownAmount'), format: money },
      { key: 'ownUnits', label: 'Наши заказы, шт.', group: 'Наши показатели', values: values('ownUnits'), format: count },
      { key: 'marketShareAmount', label: 'Доля рынка, сум', group: 'Наши показатели', values: values('marketShareAmount'), format: percent },
      { key: 'marketShareUnits', label: 'Доля рынка, шт', group: 'Наши показатели', values: values('marketShareUnits'), format: percent },
      { key: 'activeSellers', label: 'Продавцы с заказами', group: 'Структура рынка', values: values('activeSellers'), format: count },
      { key: 'activeSellerShare', label: 'Доля активных продавцов', group: 'Структура рынка', values: values('activeSellerShare'), format: percent },
      { key: 'activeCards', label: 'Карточки с заказами', group: 'Структура рынка', values: values('activeCards'), format: count },
      { key: 'activeCardShare', label: 'Доля активных карточек', group: 'Структура рынка', values: values('activeCardShare'), format: percent },
      { key: 'monopolization', label: 'Монополизация', group: 'Структура рынка', values: values('monopolization'), format: percent, inverse: true },
      { key: 'turnover', label: 'Оборачиваемость', group: 'Структура рынка', values: values('turnover'), format: value => `${fmt(value, 1)} дн.`, inverse: true },
      { key: 'avgStock', label: 'Средние остатки', group: 'Структура рынка', values: values('avgStock'), format: count },
      { key: 'buyoutRate', label: 'Процент выкупа', group: 'Структура рынка', values: values('buyoutRate'), format: percent },
      { key: 'avgRating', label: 'Средний рейтинг', group: 'Структура рынка', values: values('avgRating'), format: value => fmt(value, 1) },
    ];
  }, [points]);

  return <section className="niche-page niche-page-v2">
    <header className="niche-page-header">
      <div><span>АНАЛИТИКА · РЫНОК</span><h1>Динамика ниши</h1><p>Сравнение рынка и наших результатов на одной временной оси.</p></div>
      {latest && <div className="niche-freshness"><i /><span>Снимок рынка</span><strong>{latest.date.split('-').reverse().join('.')}</strong></div>}
    </header>

    <div className="niche-toolbar page-card">
      <DateRangeFilter label="Период" value={{ start, end }} onChange={period => { setStart(period.start); setEnd(period.end); }} maxDate={dates.at(-1) || end} />
      <label className="niche-control"><span>Категория</span><select value={category} onChange={event => { setCategory(event.target.value); setSubject(''); }}><option value="">Все категории</option>{categories.map(item => <option key={item}>{item}</option>)}</select></label>
      <label className="niche-control"><span>Предмет</span><select value={subject} onChange={event => setSubject(event.target.value)}><option value="">Все предметы</option>{subjects.map(item => <option key={item}>{item}</option>)}</select></label>
      <div className="niche-control niche-aggregation-control"><span>Агрегация</span><div className="niche-segment" aria-label="Шаг агрегации">{(['day', 'month', 'quarter'] as Granularity[]).map(item => <button key={item} type="button" className={granularity === item ? 'active' : ''} onClick={() => setGranularity(item)}>{item === 'day' ? 'День' : item === 'month' ? 'Месяц' : 'Квартал'}</button>)}</div></div>
      <label className="niche-control niche-metric-control"><span>Основная метрика</span><select value={metric} onChange={event => setMetric(event.target.value as MetricKey)}>{Object.entries(metricLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
    </div>

    {!records.length ? <div className="search-empty page-card"><strong>Нет данных динамики ниши</strong><span>Добавьте в отчёт колонку «Дата» и загрузите файл через источник «Динамика ниши».</span></div> : !latest ? <div className="search-empty page-card"><strong>В выбранном периоде нет снимков</strong><span>Измените период или фильтры категории и предмета.</span></div> : <>
      <div className="niche-context-line">
        <span>Наши данные: <strong>{addDays(latest.date, -29).split('-').reverse().join('.')} — {latest.date.split('-').reverse().join('.')}</strong></span>
        <span>Сопоставлено предметов: <strong className={latest.matchedSubjects === latest.totalSubjects ? 'positive' : 'negative'}>{latest.matchedSubjects}/{latest.totalSubjects}</strong></span>
      </div>

      <section className="niche-kpi-sheet">
        <article><div><span>Рынок</span><small>Сумма заказов</small><strong>{fmt(latest.marketAmount)} ₽</strong><em className={periodChange(latest.marketAmount, first?.marketAmount || 0) >= 0 ? 'positive' : 'negative'}>{periodChange(latest.marketAmount, first?.marketAmount || 0) >= 0 ? '↑' : '↓'} {fmt(Math.abs(periodChange(latest.marketAmount, first?.marketAmount || 0)), 1)}% к началу периода</em></div><Sparkline values={dailyPoints.map(point => point.marketAmount)} /></article>
        <article><div><span>Мы</span><small>Сумма заказов</small><strong>{fmt(latest.ownAmount)} ₽</strong><em className={periodChange(latest.ownAmount, first?.ownAmount || 0) >= 0 ? 'positive' : 'negative'}>{periodChange(latest.ownAmount, first?.ownAmount || 0) >= 0 ? '↑' : '↓'} {fmt(Math.abs(periodChange(latest.ownAmount, first?.ownAmount || 0)), 1)}% к началу периода</em></div><Sparkline values={dailyPoints.map(point => point.ownAmount)} tone="green" /></article>
        <article><div><span>Доля рынка</span><strong>{fmt(latest.marketShareAmount, 2)}%</strong><em className={(latest.marketShareAmount - (first?.marketShareAmount || 0)) >= 0 ? 'positive' : 'negative'}>{latest.marketShareAmount >= (first?.marketShareAmount || 0) ? '↑' : '↓'} {fmt(Math.abs(latest.marketShareAmount - (first?.marketShareAmount || 0)), 2)} п.п.</em><small>к началу периода</small></div><Sparkline values={dailyPoints.map(point => point.marketShareAmount)} tone="green" /></article>
        <article><div><span>Средний чек</span><strong>{fmt(latest.avgCheck)} ₽</strong><em className={periodChange(latest.avgCheck, first?.avgCheck || 0) >= 0 ? 'positive' : 'negative'}>{periodChange(latest.avgCheck, first?.avgCheck || 0) >= 0 ? '↑' : '↓'} {fmt(Math.abs(periodChange(latest.avgCheck, first?.avgCheck || 0)), 1)}%</em><small>к началу периода</small></div><Sparkline values={dailyPoints.map(point => point.avgCheck)} tone="amber" /></article>
        <article><div><span>Активные карточки</span><strong>{fmt(latest.activeCards)}</strong><em className={periodChange(latest.activeCards, first?.activeCards || 0) >= 0 ? 'positive' : 'negative'}>{periodChange(latest.activeCards, first?.activeCards || 0) >= 0 ? '↑' : '↓'} {fmt(Math.abs(periodChange(latest.activeCards, first?.activeCards || 0)), 1)}%</em><small>к началу периода</small></div><Sparkline values={dailyPoints.map(point => point.activeCards)} tone="amber" /></article>
      </section>

      <section className="niche-market-strip">
        <article><span>Продавцы с заказами</span><strong>{fmt(latest.activeSellers)}</strong><small>{fmt(latest.activeSellerShare, 1)}% от всех</small></article>
        <article><span>Монополизация</span><strong>{fmt(latest.monopolization, 1)}%</strong><small>Чем ниже, тем устойчивее рынок</small></article>
        <article><span>Оборачиваемость</span><strong>{fmt(latest.turnover, 1)} дн.</strong><small>{latest.availability}</small></article>
        <article><span>Средний рейтинг</span><strong>{fmt(latest.avgRating, 1)}</strong><small>Рыночный ориентир</small></article>
        <article><span>Средний остаток</span><strong>{fmt(latest.avgStock)} шт.</strong><small>На одну карточку</small></article>
      </section>

      <section className="niche-chart-grid">
        <article className="niche-card niche-main-chart"><div className="niche-card-head"><div><span>ДИНАМИКА · ПЕРВЫЙ ПЕРИОД = 100%</span><h2>{metricLabels[metric]}</h2></div><div className="niche-chart-legend"><i className="market" />Рынок · индекс<i className="own" />Мы · индекс</div></div><ResponsiveContainer width="100%" height={300}><ComposedChart data={indexData} margin={{ top: 10, right: 14, left: 0, bottom: 0 }}><CartesianGrid stroke="#E7ECF2" strokeDasharray="3 3" vertical={false} /><XAxis dataKey="period" tickFormatter={shortDate} tick={{ fontSize: 9, fill: '#7B8798' }} axisLine={{ stroke: '#DCE3EB' }} tickLine={false} /><YAxis yAxisId="index" domain={['auto', 'auto']} tickFormatter={value => `${fmt(Number(value), 0)}%`} tick={{ fontSize: 9, fill: '#7B8798' }} width={42} axisLine={false} tickLine={false} /><YAxis yAxisId="amount" orientation="right" tickFormatter={value => `${fmt(Number(value) / 1_000_000_000, 1)} млрд ₽`} tick={{ fontSize: 8, fill: '#7B8798' }} width={66} axisLine={false} tickLine={false} /><Tooltip formatter={(value, name) => [name === 'Объём рынка' ? `${fmt(Number(value))} ₽` : `${fmt(Number(value), 1)}%`, String(name)]} labelFormatter={value => shortDate(String(value))} /><Area yAxisId="amount" type="monotone" dataKey="marketAmount" name="Объём рынка" fill="#E8EEF8" stroke="none" fillOpacity={.75} />{(['marketAmount', 'ownAmount', 'marketUnits', 'ownUnits'] as MetricKey[]).includes(metric) ? <><Line yAxisId="index" type="monotone" dataKey="marketIndex" name="Рынок" stroke="#2563EB" strokeWidth={2.1} dot={indexData.length <= 10 ? { r: 2 } : false} /><Line yAxisId="index" type="monotone" dataKey="ownIndex" name="Мы" stroke="#10A778" strokeWidth={2.1} dot={indexData.length <= 10 ? { r: 2 } : false} /></> : <Line yAxisId="index" type="monotone" dataKey="selectedIndex" name={metricLabels[metric]} stroke="#2563EB" strokeWidth={2.2} dot={indexData.length <= 10 ? { r: 2 } : false} />}</ComposedChart></ResponsiveContainer></article>
        <article className="niche-card niche-ranking-card"><div className="niche-card-head"><div><span>СТРУКТУРА РЫНКА</span><h2>Предметы по сумме заказов</h2><p>Рынок и наша доля за период</p></div></div><ResponsiveContainer width="100%" height={300}><BarChart data={topSubjects} layout="vertical" margin={{ left: 18, right: 18, top: 8 }}><CartesianGrid stroke="#E7ECF2" strokeDasharray="3 3" horizontal={false} /><XAxis type="number" tickFormatter={value => `${fmt(Number(value) / 1_000_000, 0)}M`} tick={{ fontSize: 9, fill: '#7B8798' }} axisLine={false} tickLine={false} /><YAxis type="category" dataKey="name" width={130} tick={{ fontSize: 9, fill: '#43536A' }} axisLine={false} tickLine={false} /><Tooltip formatter={(value, name) => [`${fmt(Number(value))} ₽`, name]} /><Bar dataKey="amount" name="Рынок" fill="#75A7F8" radius={[0, 3, 3, 0]} barSize={14} /><Bar dataKey="ownAmount" name="Наша доля" fill="#12A579" radius={[0, 3, 3, 0]} barSize={8} /></BarChart></ResponsiveContainer><div className="niche-structure-legend"><span><i />Рынок</span><span><i />Наша доля</span></div></article>
      </section>

      <section className="niche-diagnostics-grid">
        <article className="niche-card niche-relative-card"><div className="niche-card-head"><div><span>СРАВНЕНИЕ</span><h2>Как мы выглядим относительно рынка</h2></div></div><div className="niche-relative-metrics"><div><span>Рост рынка</span><strong className="blue">{periodChange(latest.marketAmount, first?.marketAmount || 0) >= 0 ? '+' : ''}{fmt(periodChange(latest.marketAmount, first?.marketAmount || 0), 1)}%</strong><Sparkline values={dailyPoints.map(point => point.marketAmount)} /></div><div><span>Наш рост</span><strong className="green">{periodChange(latest.ownAmount, first?.ownAmount || 0) >= 0 ? '+' : ''}{fmt(periodChange(latest.ownAmount, first?.ownAmount || 0), 1)}%</strong><Sparkline values={dailyPoints.map(point => point.ownAmount)} tone="green" /></div><div><span>Разница</span><strong className={(periodChange(latest.ownAmount, first?.ownAmount || 0) - periodChange(latest.marketAmount, first?.marketAmount || 0)) >= 0 ? 'positive' : 'negative'}>{fmt(periodChange(latest.ownAmount, first?.ownAmount || 0) - periodChange(latest.marketAmount, first?.marketAmount || 0), 1)} п.п.</strong><Sparkline values={dailyPoints.map(point => point.marketShareAmount)} tone="amber" /></div></div></article>
        <article className="niche-card niche-waterfall-card"><div className="niche-card-head"><div><span>WATERFALL</span><h2>Что изменилось в доле рынка</h2><p>Изменение доли рынка в п.п.</p></div></div><div className="niche-waterfall"><div className="total" style={{ '--bar': `${Math.max(18, (first?.marketShareAmount || 0) / Math.max(latest.marketShareAmount, first?.marketShareAmount || 1) * 100)}%` } as React.CSSProperties}><b>{fmt(first?.marketShareAmount || 0, 2)}%</b><i /><span>Начало</span></div><div className="negative"><b>{fmt(periodChange(latest.marketAmount, first?.marketAmount || 0) / -20, 2)} п.п.</b><i /><span>Рост рынка</span></div><div className="positive"><b>+{fmt(periodChange(latest.ownAmount, first?.ownAmount || 0) / 20, 2)} п.п.</b><i /><span>Рост нас</span></div><div className="negative"><b>{fmt((latest.marketShareUnits - (first?.marketShareUnits || 0)), 2)} п.п.</b><i /><span>Структура</span></div><div className="total" style={{ '--bar': '100%' } as React.CSSProperties}><b>{fmt(latest.marketShareAmount, 2)}%</b><i /><span>Финал</span></div></div></article>
        <article className="niche-card niche-health-card"><div className="niche-card-head"><div><span>РЫНОЧНОЕ ЗДОРОВЬЕ</span><h2>Ключевые индикаторы</h2></div></div><dl><div><dt>Состояние рынка</dt><dd className="positive">{periodChange(latest.marketAmount, first?.marketAmount || 0) >= 0 ? 'Растущий' : 'Снижается'}</dd></div><div><dt>Темп роста рынка</dt><dd>{fmt(periodChange(latest.marketAmount, first?.marketAmount || 0), 1)}%</dd></div><div><dt>Конкуренция</dt><dd className={latest.monopolization < 10 ? 'positive' : 'negative'}>{latest.monopolization < 10 ? 'Низкая' : 'Высокая'}</dd></div><div><dt>Монополизация</dt><dd>{fmt(latest.monopolization, 1)}%</dd></div><div><dt>Оборачиваемость</dt><dd>{fmt(latest.turnover, 1)} дн.</dd></div><div><dt>Выкуп</dt><dd>{fmt(latest.buyoutRate, 1)}%</dd></div></dl></article>
        <article className="niche-card niche-radar-card"><div className="niche-card-head"><div><span>РАДАР</span><h2>Профиль рынка и наш профиль</h2></div></div><ResponsiveContainer width="100%" height={220}><RadarChart data={radarData}><PolarGrid stroke="#DCE4ED" /><PolarAngleAxis dataKey="metric" tick={{ fontSize: 8, fill: '#52647C' }} /><PolarRadiusAxis domain={[0, 100]} tick={false} axisLine={false} /><Radar name="Рынок" dataKey="market" stroke="#2563EB" fill="#2563EB" fillOpacity={.12} /><Radar name="Мы" dataKey="own" stroke="#10A778" fill="#10A778" fillOpacity={.16} /><Tooltip formatter={value => `${fmt(Number(value), 0)} баллов`} /></RadarChart></ResponsiveContainer><div className="niche-radar-legend"><span><i />Рынок</span><span><i />Мы</span></div></article>
      </section>

      <section className="niche-card niche-change-card"><div className="niche-card-head"><div><span>КЛЮЧЕВЫЕ ИЗМЕНЕНИЯ ЗА ПЕРИОД</span></div></div><div className="niche-change-grid">{[
        ['Объём рынка', periodChange(latest.marketAmount, first?.marketAmount || 0), `${fmt(latest.marketAmount - (first?.marketAmount || 0))} ₽`],
        ['Наши продажи', periodChange(latest.ownAmount, first?.ownAmount || 0), `${fmt(latest.ownAmount - (first?.ownAmount || 0))} ₽`],
        ['Доля рынка', latest.marketShareAmount - (first?.marketShareAmount || 0), `${fmt(latest.marketShareAmount, 2)}%`],
        ['Средний чек', periodChange(latest.avgCheck, first?.avgCheck || 0), `${fmt(latest.avgCheck)} ₽`],
        ['Активные карточки', periodChange(latest.activeCards, first?.activeCards || 0), `${fmt(latest.activeCards - (first?.activeCards || 0))} шт.`],
        ['Оборачиваемость', latest.turnover - (first?.turnover || 0), `${fmt(latest.turnover, 1)} дн.`],
      ].map(([label, value, detail]) => <article key={String(label)}><i /><span>{label}</span><strong className={Number(value) >= 0 ? 'positive' : 'negative'}>{Number(value) >= 0 ? '+' : ''}{fmt(Number(value), 1)}{label === 'Доля рынка' ? ' п.п.' : '%'}</strong><small>{detail}</small></article>)}</div></section>

      <section className="niche-card niche-matrix-card">
        <div className="niche-card-head"><div><span>АНАЛИТИЧЕСКИЙ ЛИСТ</span><h2>Матрица показателей</h2><p>Цвет сравнивает значения только внутри одной строки: красный — ниже, зелёный — выше.</p></div><div className="niche-matrix-period">{points.length} периодов</div></div>
        <div className="niche-matrix-wrap"><table><thead><tr><th>Метрика</th><th>Тренд</th><th>Изменение</th>{points.map((point, index) => <th key={point.period} className={index === points.length - 1 ? 'is-latest' : ''}>{shortDate(point.period)}</th>)}<th>Среднее</th><th>Изменение</th></tr></thead><tbody>{matrixGroups.map(group => <Fragment key={group}><tr className="niche-matrix-group"><td colSpan={points.length + 5}>{group}</td></tr>{matrixRows.filter(row => row.group === group).map(row => <tr key={row.key}><td><strong>{row.label}</strong></td><td><Sparkline values={row.values} tone={group === 'Наши показатели' ? 'green' : 'blue'} /></td><td><span className={(row.values.at(-1) || 0) >= (row.values.at(0) || 0) ? 'positive' : 'negative'}>{deltaLabel(row)}</span></td>{row.values.map((value, index) => <td key={`${row.key}-${points[index]?.period}`} className={index === row.values.length - 1 ? 'is-latest' : ''} style={{ background: heatColor(row.values, value, row.inverse) }} title={`${row.label} · ${points[index]?.period}: ${row.format(value)}`}>{row.format(value)}</td>)}<td className="niche-matrix-summary">{row.format(row.values.reduce((sum, value) => sum + value, 0) / Math.max(row.values.length, 1))}</td><td className={(row.values.at(-1) || 0) >= (row.values.at(0) || 0) ? 'positive' : 'negative'}>{row.format((row.values.at(-1) || 0) - (row.values.at(0) || 0))}</td></tr>)}</Fragment>)}</tbody></table></div>
      </section>

      <section className="niche-card niche-actions-card"><div className="niche-card-head"><div><span>ЧТО ДЕЛАТЬ ДАЛЬШЕ</span></div></div><div className="niche-actions-grid"><article className="green"><i /><strong>Усилить позиции</strong><p>{topSubjects.slice(0, 2).map(item => item.name).join(' · ') || 'Лидирующие предметы'}</p><button>Смотреть возможности →</button></article><article className="orange"><i /><strong>Оптимизировать</strong><p>{topSubjects.slice(-2).map(item => item.name).join(' · ') || 'Предметы с низкой долей'}</p><button>Анализ категорий →</button></article><article className="violet"><i /><strong>Потенциал роста</strong><p>Предметы с растущим спросом и долей ниже средней</p><button>Подбор запросов →</button></article><article className="blue"><i /><strong>Следить за метриками</strong><p>Средний чек, конкуренция и оборачиваемость</p><button>Мониторинг →</button></article></div></section>
    </>}
  </section>;
}
