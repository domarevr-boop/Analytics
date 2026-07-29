import { useMemo, useState, useSyncExternalStore } from 'react';
import { Bar, BarChart, CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import DateRangeFilter from '../../components/DateRangeFilter';
import { getMetrics, getNicheDynamics, getProducts, getVersion, subscribe } from '../../data/store';
import type { NicheDynamicsRecord } from '../../types';

type Granularity = 'day' | 'month' | 'quarter';
type MetricKey = 'marketAmount' | 'marketUnits' | 'ownAmount' | 'ownUnits' | 'marketShareAmount' | 'marketShareUnits' | 'sellers' | 'activeSellers' | 'avgCheck' | 'productCards' | 'activeCards' | 'activeCardShare' | 'monopolization' | 'turnover' | 'avgStock' | 'buyoutRate' | 'avgRating';

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

const metricLabels: Record<MetricKey, string> = {
  marketAmount: 'Рынок — сумма заказов', marketUnits: 'Рынок — заказы, шт.', ownAmount: 'Наши — сумма заказов', ownUnits: 'Наши — заказы, шт.',
  marketShareAmount: 'Доля рынка, сум', marketShareUnits: 'Доля рынка, шт', sellers: 'Продавцы', activeSellers: 'Продавцы с заказами', avgCheck: 'Средний чек',
  productCards: 'Карточки товара', activeCards: 'Карточки с заказами', activeCardShare: 'Доля карточек с заказами', monopolization: 'Монополизация', turnover: 'Оборачиваемость',
  avgStock: 'Средние остатки', buyoutRate: 'Процент выкупа', avgRating: 'Средний рейтинг',
};
const moneyMetrics = new Set<MetricKey>(['marketAmount', 'ownAmount', 'avgCheck']);
const percentMetrics = new Set<MetricKey>(['marketShareAmount', 'marketShareUnits', 'activeCardShare', 'monopolization', 'buyoutRate']);
const fmt = (value: number, digits = 0) => new Intl.NumberFormat('ru-RU', { maximumFractionDigits: digits }).format(value || 0);
const normalize = (value: string) => value.trim().toLocaleLowerCase('ru-RU').replace(/ё/g, 'е').replace(/\s+/g, ' ');
const addDays = (date: string, amount: number) => { const value = new Date(`${date}T00:00:00`); value.setDate(value.getDate() + amount); return value.toISOString().slice(0, 10); };

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
    const points: MarketPoint[] = [];
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
      points.push({ period: date, date, marketAmount, marketUnits, ownAmount, ownUnits, marketShareAmount: marketAmount ? ownAmount / marketAmount * 100 : 0, marketShareUnits: marketUnits ? ownUnits / marketUnits * 100 : 0, sellers, activeSellers, activeSellerShare: sellers ? activeSellers / sellers * 100 : 0, avgCheck, productCards, activeCards, activeCardShare: productCards ? activeCards / productCards * 100 : 0, monopolization: weighted(dayRows, 'monopolization'), turnover: weighted(dayRows, 'weekly_turnover_days'), availability: dayRows.map(row => row.availability).filter(Boolean)[0] || '—', avgStock: weighted(dayRows, 'avg_stock'), buyoutRate: weighted(dayRows, 'buyout_rate'), avgRating: weighted(dayRows, 'avg_rating'), matchedSubjects, totalSubjects: subjectNames.size });
    }
    return points;
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
  const graphMode = metric === 'marketAmount' ? 'amount' : metric === 'marketUnits' ? 'units' : 'single';
  const topSubjects = useMemo(() => {
    const latestDate = dailyPoints.at(-1)?.date;
    return filtered.filter(row => row.date === latestDate).sort((a, b) => b.revenue - a.revenue).slice(0, 10).map(row => ({ name: row.subject, amount: row.revenue }));
  }, [filtered, dailyPoints]);

  return <section className="niche-page">
    <header className="analytics-page-title"><span>АНАЛИТИКА</span><h1>Динамика ниши</h1><p>Рынок, наши результаты за 30 дней и доля рынка в разрезе дней, месяцев и кварталов.</p></header>
    <div className="niche-toolbar page-card"><DateRangeFilter label="Период снимков" value={{ start, end }} onChange={period => { setStart(period.start); setEnd(period.end); }} maxDate={dates.at(-1) || end} /><select value={category} onChange={event => { setCategory(event.target.value); setSubject(''); }}><option value="">Все категории</option>{categories.map(item => <option key={item}>{item}</option>)}</select><select value={subject} onChange={event => setSubject(event.target.value)}><option value="">Все предметы</option>{subjects.map(item => <option key={item}>{item}</option>)}</select><label>Шаг<select value={granularity} onChange={event => setGranularity(event.target.value as Granularity)}><option value="day">День</option><option value="month">Месяц</option><option value="quarter">Квартал</option></select></label><label>Метрика<select value={metric} onChange={event => setMetric(event.target.value as MetricKey)}>{Object.entries(metricLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label></div>
    {!records.length ? <div className="search-empty page-card"><strong>Нет данных динамики ниши</strong><span>Добавьте в отчёт колонку «Дата» и загрузите файл через источник «Динамика ниши».</span></div> : !latest ? <div className="search-empty page-card"><strong>В выбранном периоде нет снимков</strong><span>Измените период или фильтры категории и предмета.</span></div> : <>
      <div className="niche-context"><span>Снимок рынка</span><strong>{latest.date.split('-').reverse().join('.')}</strong><em>наши данные: {addDays(latest.date, -29).split('-').reverse().join('.')} — {latest.date.split('-').reverse().join('.')}</em><b className={latest.matchedSubjects === latest.totalSubjects ? 'positive' : 'negative'}>сопоставлено предметов {latest.matchedSubjects}/{latest.totalSubjects}</b></div>
      <div className="niche-kpis niche-kpis-market">
        <article><span>Рынок — сумма заказов</span><strong>{fmt(latest.marketAmount)} ₽</strong><small>{fmt(latest.marketUnits)} заказов</small></article>
        <article><span>Наши — сумма заказов</span><strong>{fmt(latest.ownAmount)} ₽</strong><small>За последние 30 дней</small></article>
        <article><span>Доля рынка, сум</span><strong>{fmt(latest.marketShareAmount, 2)}%</strong><small>Наши заказы / рынок</small></article>
        <article><span>Наши — заказы, шт.</span><strong>{fmt(latest.ownUnits)}</strong><small>Рынок: {fmt(latest.marketUnits)} шт.</small></article>
        <article><span>Доля рынка, шт</span><strong>{fmt(latest.marketShareUnits, 2)}%</strong><small>Наши штуки / оценка рынка</small></article>
        <article><span>Средний чек рынка</span><strong>{fmt(latest.avgCheck)} ₽</strong><small>Выкуп {fmt(latest.buyoutRate, 1)}%</small></article>
      </div>
      <div className="niche-market-strip"><article><span>Продавцы с заказами</span><strong>{fmt(latest.activeSellers)}</strong><small>{fmt(latest.activeSellerShare, 1)}% от всех</small></article><article><span>Карточки с заказами</span><strong>{fmt(latest.activeCards)}</strong><small>{fmt(latest.activeCardShare, 1)}% от всех</small></article><article><span>Монополизация</span><strong>{fmt(latest.monopolization, 1)}%</strong><small>Структура рынка</small></article><article><span>Оборачиваемость</span><strong>{fmt(latest.turnover, 1)} дн.</strong><small>{latest.availability}</small></article><article><span>Средний рейтинг</span><strong>{fmt(latest.avgRating, 1)}</strong><small>Остаток {fmt(latest.avgStock)} шт.</small></article></div>

      <div className="niche-chart-grid"><article className="niche-card niche-main-chart"><div className="niche-card-head"><div><h2>{metricLabels[metric]}</h2><p>{granularity === 'day' ? 'По снимкам дня' : granularity === 'month' ? 'Последний снимок каждого месяца' : 'Сумма последних месячных снимков квартала'}</p></div></div><ResponsiveContainer width="100%" height={320}><LineChart data={points}><CartesianGrid stroke="#E7EDF5" strokeDasharray="3 3" /><XAxis dataKey="period" tick={{ fontSize: 10 }} /><YAxis tickFormatter={value => formatMetric(metric, Number(value))} tick={{ fontSize: 10 }} width={72} /><Tooltip formatter={(value, name) => [formatMetric(metric, Number(value)), String(name)]} /><Legend />{graphMode === 'amount' ? <><Line type="monotone" dataKey="marketAmount" name="Рынок" stroke="#2563EB" strokeWidth={2.5} dot={points.length <= 14 ? { r: 2 } : false} /><Line type="monotone" dataKey="ownAmount" name="Мы · 30 дней" stroke="#10A778" strokeWidth={2.5} dot={points.length <= 14 ? { r: 2 } : false} /></> : graphMode === 'units' ? <><Line type="monotone" dataKey="marketUnits" name="Рынок" stroke="#2563EB" strokeWidth={2.5} dot={points.length <= 14 ? { r: 2 } : false} /><Line type="monotone" dataKey="ownUnits" name="Мы · 30 дней" stroke="#10A778" strokeWidth={2.5} dot={points.length <= 14 ? { r: 2 } : false} /></> : <Line type="monotone" dataKey={metric} name={metricLabels[metric]} stroke="#2563EB" strokeWidth={2.5} dot={points.length <= 14 ? { r: 2 } : false} />}</LineChart></ResponsiveContainer></article>
      <article className="niche-card"><div className="niche-card-head"><div><h2>Предметы по сумме заказов</h2><p>Топ-10 последнего снимка</p></div></div><ResponsiveContainer width="100%" height={320}><BarChart data={topSubjects} layout="vertical" margin={{ left: 30, right: 18 }}><CartesianGrid stroke="#E7EDF5" strokeDasharray="3 3" horizontal={false} /><XAxis type="number" tickFormatter={value => `${fmt(Number(value) / 1_000_000, 1)}M`} /><YAxis type="category" dataKey="name" width={135} tick={{ fontSize: 9 }} /><Tooltip formatter={value => `${fmt(Number(value))} ₽`} /><Bar dataKey="amount" name="Сумма заказов" fill="#4F8EF7" radius={[0, 4, 4, 0]} /></BarChart></ResponsiveContainer></article></div>

      <article className="niche-card niche-table-card niche-history-table"><div className="niche-card-head"><div><h2>История показателей</h2><p>Все метрики отчёта без колонок предыдущего периода + наши показатели и доли рынка</p></div></div><div className="niche-table-wrap"><table><thead><tr><th>Период</th><th>Рынок, сум</th><th>Рынок, шт</th><th>Мы, сум</th><th>Мы, шт</th><th>Доля, сум</th><th>Доля, шт</th><th>Продавцы</th><th>С заказами</th><th>Монополизация</th><th>Средний чек</th><th>Карточки</th><th>С заказами</th><th>Доля активных</th><th>Оборачиваемость</th><th>Доступность</th><th>Средний остаток</th><th>Выкуп</th><th>Рейтинг</th></tr></thead><tbody>{points.map(point => <tr key={point.period}><td><strong>{point.period}</strong><small>{granularity === 'day' ? 'снимок' : `на ${point.date}`}</small></td><td>{fmt(point.marketAmount)} ₽</td><td>{fmt(point.marketUnits)}</td><td>{fmt(point.ownAmount)} ₽</td><td>{fmt(point.ownUnits)}</td><td className="niche-share-cell">{fmt(point.marketShareAmount, 2)}%</td><td className="niche-share-cell">{fmt(point.marketShareUnits, 2)}%</td><td>{fmt(point.sellers)}</td><td>{fmt(point.activeSellers)}</td><td>{fmt(point.monopolization, 1)}%</td><td>{fmt(point.avgCheck)} ₽</td><td>{fmt(point.productCards)}</td><td>{fmt(point.activeCards)}</td><td>{fmt(point.activeCardShare, 1)}%</td><td>{fmt(point.turnover, 1)} дн.</td><td>{point.availability}</td><td>{fmt(point.avgStock)}</td><td>{fmt(point.buyoutRate, 1)}%</td><td>{fmt(point.avgRating, 1)}</td></tr>)}</tbody></table></div></article>
    </>}
  </section>;
}
