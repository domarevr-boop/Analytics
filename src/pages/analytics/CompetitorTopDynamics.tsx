import { useMemo, useState } from 'react';
import { Bar, CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { calculateCompetitorTopDynamics } from '../../data/competitorCalculations';
import type { TopMovementStatus } from '../../data/competitorCalculations';
import type { CompetitorPositionRecord } from '../../types';

const number = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 1 });
const shortDate = (value: string) => value.slice(5).split('-').reverse().join('.');
const statusLabels: Record<TopMovementStatus, string> = {
  retained: 'Остался в TOP',
  new: 'Вошёл в TOP',
  exited: 'Вышел из TOP',
  intermittent: 'Был внутри периода',
};

interface CompetitorTopDynamicsProps {
  positions: CompetitorPositionRecord[];
}

export default function CompetitorTopDynamics({ positions }: CompetitorTopDynamicsProps) {
  const availableDates = useMemo(() => [...new Set(positions.map(row => row.date).filter(Boolean))].sort(), [positions]);
  const [baselineDate, setBaselineDate] = useState(availableDates[0] || '');
  const [comparisonDate, setComparisonDate] = useState(availableDates.at(-1) || '');
  const [topDepth, setTopDepth] = useState(50);
  const [movementFilter, setMovementFilter] = useState<TopMovementStatus | 'all'>('all');
  const [movementPage, setMovementPage] = useState(0);
  const activeBaseline = availableDates.includes(baselineDate) ? baselineDate : availableDates[0] || '';
  const activeComparison = availableDates.includes(comparisonDate) ? comparisonDate : availableDates.at(-1) || '';
  const rangeStart = activeBaseline <= activeComparison ? activeBaseline : activeComparison;
  const rangeEnd = activeBaseline <= activeComparison ? activeComparison : activeBaseline;
  const rangeRows = useMemo(() => positions.filter(row => row.date >= rangeStart && row.date <= rangeEnd), [positions, rangeStart, rangeEnd]);
  const dynamics = useMemo(() => calculateCompetitorTopDynamics(rangeRows, topDepth), [rangeRows, topDepth]);
  const filteredMovements = dynamics.movements.filter(row => movementFilter === 'all' || row.status === movementFilter);
  const pageSize = 15;
  const pageCount = Math.max(1, Math.ceil(filteredMovements.length / pageSize));
  const activePage = Math.min(movementPage, pageCount - 1);
  const visibleMovements = filteredMovements.slice(activePage * pageSize, (activePage + 1) * pageSize);
  const maxBrandCount = Math.max(1, ...dynamics.brandStructure.flatMap(row => row.counts));

  if (!availableDates.length) return <article className="analytics-empty-card competitors-empty-card"><span>НЕТ ПОЗИЦИЙ</span><h2>Для динамики нужен лист ежедневного TOP‑50</h2><p>Повторите импорт файла конкурентов с листом дат, позиций, артикулов, продавцов и брендов.</p></article>;

  return <div className="competitor-top-dynamics">
    <section className="competitor-top-toolbar page-card">
      <label><span>Базовый день</span><select value={rangeStart} onChange={event => { setBaselineDate(event.target.value); if (event.target.value > rangeEnd) setComparisonDate(event.target.value); setMovementPage(0); }}>{availableDates.filter(date => date <= rangeEnd).map(date => <option key={date} value={date}>{shortDate(date)}</option>)}</select></label>
      <label><span>Сравнить с</span><select value={rangeEnd} onChange={event => { setComparisonDate(event.target.value); if (event.target.value < rangeStart) setBaselineDate(event.target.value); setMovementPage(0); }}>{availableDates.filter(date => date >= rangeStart).map(date => <option key={date} value={date}>{shortDate(date)}</option>)}</select></label>
      <label><span>Глубина</span><select value={topDepth} onChange={event => { setTopDepth(Number(event.target.value)); setMovementPage(0); }}><option value={10}>TOP‑10</option><option value={20}>TOP‑20</option><option value={50}>TOP‑50</option></select></label>
      <p>{dynamics.dates.length > 1 ? `${dynamics.dates.length} дней · сравнение ${shortDate(rangeStart)} → ${shortDate(rangeEnd)}` : 'Доступен только один день: изменения состава пока рассчитать нельзя.'}</p>
    </section>

    <section className="competitor-top-kpis">
      <article><span>СОХРАННОСТЬ СОСТАВА</span><strong>{dynamics.dates.length > 1 ? `${number.format(dynamics.stabilityRate)}%` : '—'}</strong><small>карточек базового дня осталось</small></article>
      <article><span>НОВЫЕ В TOP</span><strong>{dynamics.dates.length > 1 ? dynamics.entrants : '—'}</strong><small>есть в сравнении, не было в базе</small></article>
      <article><span>ВЫШЛИ ИЗ TOP</span><strong>{dynamics.dates.length > 1 ? dynamics.exits : '—'}</strong><small>были в базе, отсутствуют в сравнении</small></article>
      <article><span>СРЕДНЕЕ ДВИЖЕНИЕ</span><strong>{dynamics.dates.length > 1 ? number.format(dynamics.averageMovement) : '—'}</strong><small>мест по сохранившимся карточкам</small></article>
      <article><span>БРЕНДЫ В ПОСЛЕДНЕМ TOP</span><strong>{dynamics.brandsLatest}</strong><small>уникальных брендов на {shortDate(rangeEnd)}</small></article>
    </section>

    <section className="competitor-top-grid">
      <article className="competitors-section competitor-top-chart">
        <header><div><span>РОТАЦИЯ ПО ДНЯМ</span><h2>Стабильность и смена состава</h2><p>Столбцы показывают входы и выходы относительно предыдущего доступного дня; линия — сохранность предыдущего состава.</p></div></header>
        {dynamics.dates.length > 1 ? <ResponsiveContainer width="100%" height={290}><ComposedChart data={dynamics.timeline} margin={{ top: 8, right: 10, left: 0, bottom: 0 }}><CartesianGrid stroke="#E6ECF2" strokeDasharray="3 3" vertical={false} /><XAxis dataKey="date" tickFormatter={shortDate} minTickGap={22} tick={{ fontSize: 9 }} /><YAxis yAxisId="count" allowDecimals={false} width={32} tick={{ fontSize: 9 }} /><YAxis yAxisId="rate" orientation="right" domain={[0, 100]} tickFormatter={value => `${value}%`} width={42} tick={{ fontSize: 9 }} /><Tooltip labelFormatter={value => shortDate(String(value))} formatter={(value, name) => [name === 'Сохранность' ? `${number.format(Number(value))}%` : number.format(Number(value)), name]} /><Legend wrapperStyle={{ fontSize: 9 }} /><Bar yAxisId="count" dataKey="entrants" name="Вошли" fill="#42B58B" radius={[3, 3, 0, 0]} /><Bar yAxisId="count" dataKey="exits" name="Вышли" fill="#F08A96" radius={[3, 3, 0, 0]} /><Line yAxisId="rate" type="monotone" dataKey="retentionRate" name="Сохранность" stroke="#2563EB" strokeWidth={2.2} dot={dynamics.dates.length <= 12 ? { r: 2.5 } : false} connectNulls /></ComposedChart></ResponsiveContainer> : <div className="competitor-top-no-comparison">Добавьте второй день позиций, чтобы увидеть ротацию состава.</div>}
      </article>

      <aside className="competitors-section competitor-top-reading">
        <header><div><span>КАК ЧИТАТЬ</span><h2>Что считается изменением структуры</h2></div></header>
        <article><b>1</b><div><strong>Состав</strong><p>Какие карточки сохранились, вошли или вышли из выбранной глубины TOP.</p></div></article>
        <article><b>2</b><div><strong>Концентрация брендов</strong><p>Сколько мест каждый бренд занимает в TOP по каждому доступному дню.</p></div></article>
        <article><b>3</b><div><strong>Мобильность</strong><p>Как далеко переместились сохранившиеся карточки и кто появился только внутри периода.</p></div></article>
      </aside>
    </section>

    <section className="competitors-section competitor-top-matrix-section">
      <header><div><span>СТРУКТУРА БРЕНДОВ</span><h2>Присутствие брендов по дням</h2><p>Ячейка показывает число карточек бренда в выбранной глубине TOP; насыщенность помогает увидеть концентрацию.</p></div><small>{dynamics.brandStructure.length} брендов</small></header>
      <div className="competitor-top-matrix-wrap"><table><thead><tr><th>Бренд</th>{dynamics.dates.map(date => <th key={date} className={date === dynamics.dates.at(-1) ? 'is-latest' : ''}>{shortDate(date)}</th>)}<th>Сейчас</th><th>Δ</th></tr></thead><tbody>{dynamics.brandStructure.map(row => <tr key={row.key}><td><strong>{row.brand}</strong></td>{row.counts.map((count, index) => <td key={`${row.key}-${dynamics.dates[index]}`} className={index === row.counts.length - 1 ? 'is-latest' : ''} style={{ background: count ? `rgba(37, 99, 235, ${0.06 + count / maxBrandCount * 0.38})` : undefined }} title={`${row.brand} · ${shortDate(dynamics.dates[index])}: ${count} из TOP-${topDepth}`}>{count || '—'}</td>)}<td className="matrix-summary">{row.latest}</td><td className={row.delta > 0 ? 'positive' : row.delta < 0 ? 'negative' : ''}>{row.delta > 0 ? '+' : ''}{row.delta}</td></tr>)}</tbody></table></div>
    </section>

    <section className="competitors-section competitor-top-movements">
      <header><div><span>ДВИЖЕНИЕ КАРТОЧЕК</span><h2>Кто изменил структуру TOP</h2><p>Сравнение базового и последнего дня с лучшей и худшей позицией внутри периода.</p></div><div className="competitor-top-status-filter">{(['all', 'new', 'exited', 'retained', 'intermittent'] as const).map(status => <button type="button" key={status} className={movementFilter === status ? 'active' : ''} onClick={() => { setMovementFilter(status); setMovementPage(0); }}>{status === 'all' ? 'Все' : statusLabels[status]}</button>)}</div></header>
      <div className="competitor-top-movement-table"><table><thead><tr><th>Артикул</th><th>Бренд / продавец</th><th>{shortDate(rangeStart)}</th><th>{shortDate(rangeEnd)}</th><th>Изменение</th><th>Лучшая</th><th>Худшая</th><th>Дней в TOP</th><th>Статус</th></tr></thead><tbody>{visibleMovements.map(row => <tr key={row.article}><td><strong>{row.article}</strong></td><td><strong>{row.brand}</strong><small>{row.seller}</small></td><td>{row.baseline ?? '—'}</td><td>{row.comparison ?? '—'}</td><td className={row.delta && row.delta > 0 ? 'positive' : row.delta && row.delta < 0 ? 'negative' : ''}>{row.delta === null ? '—' : `${row.delta > 0 ? '↑ +' : row.delta < 0 ? '↓ ' : ''}${row.delta}`}</td><td>{row.best}</td><td>{row.worst}</td><td>{row.days} / {dynamics.dates.length}</td><td><span className={`top-status top-status--${row.status}`}>{statusLabels[row.status]}</span></td></tr>)}</tbody></table></div>
      {filteredMovements.length > pageSize && <footer className="competitor-table-pagination"><span>{activePage * pageSize + 1}–{Math.min((activePage + 1) * pageSize, filteredMovements.length)} из {filteredMovements.length}</span><div><button type="button" disabled={activePage === 0} onClick={() => setMovementPage(activePage - 1)}>← Назад</button><b>{activePage + 1} / {pageCount}</b><button type="button" disabled={activePage >= pageCount - 1} onClick={() => setMovementPage(activePage + 1)}>Далее →</button></div></footer>}
    </section>
  </div>;
}
