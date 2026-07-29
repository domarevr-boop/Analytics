import { Fragment, useMemo, useState, useSyncExternalStore } from 'react';
import { Bar, BarChart, CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
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
const moneyMetrics = new Set<MetricKey>(['marketAmount', 'ownAmount', 'avgCheck']);
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

function formatMetric(metric: MetricKey, value: number) {
  if (moneyMetrics.has(metric)) return `${fmt(value)} ₽`;
  if (percentMetrics.has(metric)) return `${fmt(value, 2)}%`;
  if (metric === 'turnover') return `${fmt(value, 1)} дн.`;
  return fmt(value, metric === 'avgRating' ? 1 : 0);
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
  const graphMode = metric === 'marketAmount' || metric === 'ownAmount' ? 'amount' : metric === 'marketUnits' || metric === 'ownUnits' ? 'units' : 'single';
  const topSubjects = useMemo(() => {
    const latestDate = dailyPoints.at(-1)?.date;
    return filtered.filter(row => row.date === latestDate).sort((a, b) => b.revenue - a.revenue).slice(0, 8).map(row => ({ name: row.subject, amount: row.revenue }));
  }, [filtered, dailyPoints]);

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

  return <section className="niche-page">
    <header className="niche-page-header">
      <div><span>АНАЛИТИКА · РЫНОК</span><h1>Динамика ниши</h1><p>Сравнение рынка и наших результатов на одной временной оси.</p></div>
      {latest && <div className="niche-freshness"><i /><span>Снимок рынка</span><strong>{latest.date.split('-').reverse().join('.')}</strong></div>}
    </header>

    <div className="niche-toolbar page-card">
      <DateRangeFilter label="Период" value={{ start, end }} onChange={period => { setStart(period.start); setEnd(period.end); }} maxDate={dates.at(-1) || end} />
      <label className="niche-control"><span>Категория</span><select value={category} onChange={event => { setCategory(event.target.value); setSubject(''); }}><option value="">Все категории</option>{categories.map(item => <option key={item}>{item}</option>)}</select></label>
      <label className="niche-control"><span>Предмет</span><select value={subject} onChange={event => setSubject(event.target.value)}><option value="">Все предметы</option>{subjects.map(item => <option key={item}>{item}</option>)}</select></label>
      <div className="niche-segment" aria-label="Шаг агрегации">{(['day', 'month', 'quarter'] as Granularity[]).map(item => <button key={item} type="button" className={granularity === item ? 'active' : ''} onClick={() => setGranularity(item)}>{item === 'day' ? 'День' : item === 'month' ? 'Месяц' : 'Квартал'}</button>)}</div>
      <label className="niche-control niche-metric-control"><span>Основная метрика</span><select value={metric} onChange={event => setMetric(event.target.value as MetricKey)}>{Object.entries(metricLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
    </div>

    {!records.length ? <div className="search-empty page-card"><strong>Нет данных динамики ниши</strong><span>Добавьте в отчёт колонку «Дата» и загрузите файл через источник «Динамика ниши».</span></div> : !latest ? <div className="search-empty page-card"><strong>В выбранном периоде нет снимков</strong><span>Измените период или фильтры категории и предмета.</span></div> : <>
      <div className="niche-context-line">
        <span>Наши данные: <strong>{addDays(latest.date, -29).split('-').reverse().join('.')} — {latest.date.split('-').reverse().join('.')}</strong></span>
        <span>Сопоставлено предметов: <strong className={latest.matchedSubjects === latest.totalSubjects ? 'positive' : 'negative'}>{latest.matchedSubjects}/{latest.totalSubjects}</strong></span>
      </div>

      <section className="niche-kpi-sheet">
        <article className="niche-kpi-primary"><div><span>Рынок · сумма заказов</span><strong>{fmt(latest.marketAmount)} ₽</strong><small>{fmt(latest.marketUnits)} заказов</small></div><Sparkline values={dailyPoints.map(point => point.marketAmount)} /></article>
        <article className="niche-kpi-primary"><div><span>Наши · сумма заказов</span><strong>{fmt(latest.ownAmount)} ₽</strong><small>Скользящие 30 дней</small></div><Sparkline values={dailyPoints.map(point => point.ownAmount)} tone="green" /></article>
        <article className="niche-kpi-primary"><div><span>Доля рынка · сумма</span><strong>{fmt(latest.marketShareAmount, 2)}%</strong><small>Наши заказы / рынок</small></div><Sparkline values={dailyPoints.map(point => point.marketShareAmount)} tone="green" /></article>
        <article className="niche-kpi-primary"><div><span>Доля рынка · штуки</span><strong>{fmt(latest.marketShareUnits, 2)}%</strong><small>{fmt(latest.ownUnits)} из {fmt(latest.marketUnits)} шт.</small></div><Sparkline values={dailyPoints.map(point => point.marketShareUnits)} tone="green" /></article>
        <article className="niche-kpi-support"><div><span>Средний чек рынка</span><strong>{fmt(latest.avgCheck)} ₽</strong><small>Выкуп {fmt(latest.buyoutRate, 1)}%</small></div><Sparkline values={dailyPoints.map(point => point.avgCheck)} tone="amber" /></article>
        <article className="niche-kpi-support"><div><span>Активные карточки</span><strong>{fmt(latest.activeCards)}</strong><small>{fmt(latest.activeCardShare, 1)}% от всех</small></div><Sparkline values={dailyPoints.map(point => point.activeCards)} tone="amber" /></article>
      </section>

      <section className="niche-market-strip">
        <article><span>Продавцы с заказами</span><strong>{fmt(latest.activeSellers)}</strong><small>{fmt(latest.activeSellerShare, 1)}% от всех</small></article>
        <article><span>Монополизация</span><strong>{fmt(latest.monopolization, 1)}%</strong><small>Чем ниже, тем устойчивее рынок</small></article>
        <article><span>Оборачиваемость</span><strong>{fmt(latest.turnover, 1)} дн.</strong><small>{latest.availability}</small></article>
        <article><span>Средний рейтинг</span><strong>{fmt(latest.avgRating, 1)}</strong><small>Рыночный ориентир</small></article>
        <article><span>Средний остаток</span><strong>{fmt(latest.avgStock)} шт.</strong><small>На одну карточку</small></article>
      </section>

      <section className="niche-chart-grid">
        <article className="niche-card niche-main-chart"><div className="niche-card-head"><div><span>ДИНАМИКА</span><h2>{metricLabels[metric]}</h2><p>{granularity === 'day' ? 'По ежедневным снимкам' : granularity === 'month' ? 'Последний снимок каждого месяца' : 'Последние месячные снимки квартала'}</p></div><div className="niche-chart-legend"><i className="market" />Рынок<i className="own" />Мы · 30 дней</div></div><ResponsiveContainer width="100%" height={300}><LineChart data={points} margin={{ top: 10, right: 14, left: 0, bottom: 0 }}><CartesianGrid stroke="#E7ECF2" strokeDasharray="3 3" vertical={false} /><XAxis dataKey="period" tickFormatter={shortDate} tick={{ fontSize: 9, fill: '#7B8798' }} axisLine={{ stroke: '#DCE3EB' }} tickLine={false} /><YAxis tickFormatter={value => formatMetric(metric, Number(value))} tick={{ fontSize: 9, fill: '#7B8798' }} width={70} axisLine={false} tickLine={false} /><Tooltip formatter={(value, name) => [formatMetric(metric, Number(value)), String(name)]} labelFormatter={value => shortDate(String(value))} /><Legend content={() => null} />{graphMode === 'amount' ? <><Line type="monotone" dataKey="marketAmount" name="Рынок" stroke="#4F8EF7" strokeWidth={2} dot={points.length <= 10 ? { r: 2 } : false} activeDot={{ r: 4 }} /><Line type="monotone" dataKey="ownAmount" name="Мы · 30 дней" stroke="#12A579" strokeWidth={2} dot={points.length <= 10 ? { r: 2 } : false} activeDot={{ r: 4 }} /></> : graphMode === 'units' ? <><Line type="monotone" dataKey="marketUnits" name="Рынок" stroke="#4F8EF7" strokeWidth={2} dot={points.length <= 10 ? { r: 2 } : false} activeDot={{ r: 4 }} /><Line type="monotone" dataKey="ownUnits" name="Мы · 30 дней" stroke="#12A579" strokeWidth={2} dot={points.length <= 10 ? { r: 2 } : false} activeDot={{ r: 4 }} /></> : <Line type="monotone" dataKey={metric} name={metricLabels[metric]} stroke="#4F8EF7" strokeWidth={2} dot={points.length <= 10 ? { r: 2 } : false} activeDot={{ r: 4 }} />}</LineChart></ResponsiveContainer></article>
        <article className="niche-card niche-ranking-card"><div className="niche-card-head"><div><span>СТРУКТУРА</span><h2>Предметы по сумме заказов</h2><p>Топ-8 последнего снимка</p></div></div><ResponsiveContainer width="100%" height={300}><BarChart data={topSubjects} layout="vertical" margin={{ left: 18, right: 18, top: 8 }}><CartesianGrid stroke="#E7ECF2" strokeDasharray="3 3" horizontal={false} /><XAxis type="number" tickFormatter={value => `${fmt(Number(value) / 1_000_000, 1)}M`} tick={{ fontSize: 9, fill: '#7B8798' }} axisLine={false} tickLine={false} /><YAxis type="category" dataKey="name" width={130} tick={{ fontSize: 9, fill: '#43536A' }} axisLine={false} tickLine={false} /><Tooltip formatter={value => `${fmt(Number(value))} ₽`} /><Bar dataKey="amount" name="Сумма заказов" fill="#75A7F8" radius={[0, 3, 3, 0]} barSize={14} /></BarChart></ResponsiveContainer></article>
      </section>

      <section className="niche-card niche-matrix-card">
        <div className="niche-card-head"><div><span>АНАЛИТИЧЕСКИЙ ЛИСТ</span><h2>Матрица показателей</h2><p>Цвет сравнивает значения только внутри одной строки: красный — ниже, зелёный — выше.</p></div><div className="niche-matrix-period">{points.length} периодов</div></div>
        <div className="niche-matrix-wrap"><table><thead><tr><th>Метрика</th><th>Тренд</th><th>Изменение</th>{points.map((point, index) => <th key={point.period} className={index === points.length - 1 ? 'is-latest' : ''}>{shortDate(point.period)}</th>)}</tr></thead><tbody>{matrixGroups.map(group => <Fragment key={group}><tr className="niche-matrix-group"><td colSpan={points.length + 3}>{group}</td></tr>{matrixRows.filter(row => row.group === group).map(row => <tr key={row.key}><td><strong>{row.label}</strong></td><td><Sparkline values={row.values} tone={group === 'Наши показатели' ? 'green' : 'blue'} /></td><td><span className={(row.values.at(-1) || 0) >= (row.values.at(0) || 0) ? 'positive' : 'negative'}>{deltaLabel(row)}</span></td>{row.values.map((value, index) => <td key={`${row.key}-${points[index]?.period}`} className={index === row.values.length - 1 ? 'is-latest' : ''} style={{ background: heatColor(row.values, value, row.inverse) }} title={`${row.label} · ${points[index]?.period}: ${row.format(value)}`}>{row.format(value)}</td>)}</tr>)}</Fragment>)}</tbody></table></div>
      </section>
    </>}
  </section>;
}
