import { useMemo, useState } from 'react';
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts';
import DateRangeFilter from '../../components/DateRangeFilter';
import { calculateCompetitorStockSlice } from '../../data/competitorCalculations';
import type { CompetitorStockRecord } from '../../types';
import CompetitorMultiChoice from './CompetitorMultiChoice';

const number = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 1 });
const colors = ['#2563EB', '#10A778', '#F59E0B', '#8B5CF6', '#EF5B70', '#0EA5E9', '#84CC16', '#64748B'];
const normalize = (value: string) => value.trim().toLocaleLowerCase('ru-RU').replace(/ё/g, 'е').replace(/\s+/g, ' ');
const shortDate = (value: string) => value ? value.slice(5).split('-').reverse().join('.') : '—';

export default function CompetitorStockDistribution({ rows }: { rows: CompetitorStockRecord[] }) {
  const dates = useMemo(() => [...new Set(rows.map(row => row.date).filter(Boolean))].sort(), [rows]);
  const brandOptions = useMemo(() => [...new Map(rows.map(row => [normalize(row.brand || 'Без бренда'), row.brand.trim() || 'Без бренда'])).entries()].map(([value, label]) => ({ value, label })).sort((left, right) => left.label.localeCompare(right.label, 'ru')), [rows]);
  const warehouseOptions = useMemo(() => [...new Map(rows.map(row => [normalize(row.warehouse || 'Без склада'), row.warehouse.trim() || 'Без склада'])).entries()].map(([value, label]) => ({ value, label })).sort((left, right) => left.label.localeCompare(right.label, 'ru')), [rows]);
  const [start, setStart] = useState(dates[0] || '');
  const [end, setEnd] = useState(dates.at(-1) || '');
  const [brands, setBrands] = useState<string[]>([]);
  const [warehouses, setWarehouses] = useState<string[]>([]);
  const activeStart = start || dates[0] || '';
  const activeEnd = end || dates.at(-1) || '';
  const slice = useMemo(() => calculateCompetitorStockSlice(rows, activeStart, activeEnd, new Set(brands), new Set(warehouses)), [rows, activeStart, activeEnd, brands, warehouses]);
  const hasComparison = !!slice.dateStart && slice.dateStart !== slice.dateEnd;
  const shownWarehouses = slice.warehouses.length <= 8 ? slice.warehouses : [
    ...slice.warehouses.slice(0, 7),
    { key: '__other__', warehouse: 'Другие склады', stock: slice.warehouses.slice(7).reduce((sum, row) => sum + row.stock, 0), share: slice.warehouses.slice(7).reduce((sum, row) => sum + row.share, 0) },
  ];
  const totalRate = hasComparison && slice.totalPrevious ? slice.totalDelta / slice.totalPrevious * 100 : null;

  if (!dates.length) return <section className="competitors-section competitor-stock-section"><header><div><span>ОСТАТКИ ПО СКЛАДАМ</span><h2>Распределение запасов</h2></div></header><div className="competitor-stock-empty">В импортированном файле нет доступных снимков складских остатков.</div></section>;

  return <section className="competitors-section competitor-stock-section">
    <header><div><span>ОСТАТКИ ПО СКЛАДАМ</span><h2>Распределение запасов и изменение по брендам</h2><p>Pie chart использует последний доступный снимок периода; сводка справа сравнивает первый и последний снимки.</p></div></header>
    <div className="competitor-stock-toolbar"><DateRangeFilter label="Период остатков" value={{ start: activeStart, end: activeEnd }} onChange={period => { setStart(period.start); setEnd(period.end); }} maxDate={dates.at(-1) || activeEnd} /><CompetitorMultiChoice label="Бренды" values={brands} options={brandOptions} max={6} onChange={setBrands} /><CompetitorMultiChoice label="Склады" values={warehouses} options={warehouseOptions} max={8} onChange={setWarehouses} /><button type="button" onClick={() => { setBrands([]); setWarehouses([]); setStart(dates[0]); setEnd(dates.at(-1)!); }}>Сбросить</button></div>
    <div className="competitor-stock-grid">
      <div className="competitor-stock-chart">
        {slice.totalCurrent > 0 ? <><ResponsiveContainer width="100%" height={300}><PieChart><Pie data={shownWarehouses} dataKey="stock" nameKey="warehouse" innerRadius={72} outerRadius={112} paddingAngle={1.5} stroke="#fff" strokeWidth={2}>{shownWarehouses.map((row, index) => <Cell key={row.key} fill={colors[index % colors.length]} />)}</Pie><Tooltip formatter={(value, _name, item) => [`${number.format(Number(value))} шт. · ${number.format(Number(item.payload?.share || 0))}%`, item.payload?.warehouse]} /></PieChart></ResponsiveContainer><div className="competitor-stock-center"><strong>{number.format(slice.totalCurrent)}</strong><span>шт. на {shortDate(slice.dateEnd)}</span></div></> : <div className="competitor-stock-empty">По выбранным фильтрам остатки отсутствуют.</div>}
        <div className="competitor-stock-legend">{shownWarehouses.map((row, index) => <div key={row.key}><i style={{ background: colors[index % colors.length] }} /><strong>{row.warehouse}</strong><span>{number.format(row.stock)} шт.</span><b>{number.format(row.share)}%</b></div>)}</div>
      </div>
      <aside className="competitor-stock-summary">
        <article className="competitor-stock-total"><span>ИЗМЕНЕНИЕ ОБЩЕГО ОСТАТКА</span><strong>{hasComparison ? `${slice.totalDelta > 0 ? '+' : ''}${number.format(slice.totalDelta)} шт.` : '—'}</strong><b className={slice.totalDelta > 0 ? 'positive' : slice.totalDelta < 0 ? 'negative' : ''}>{totalRate === null ? 'нужны две даты' : `${totalRate > 0 ? '+' : ''}${number.format(totalRate)}%`}</b><small>{shortDate(slice.dateStart)}: {number.format(slice.totalPrevious)} → {shortDate(slice.dateEnd)}: {number.format(slice.totalCurrent)}</small></article>
        <div className="competitor-stock-brand-list"><header><strong>Изменение по брендам</strong><span>{slice.brands.length} брендов</span></header>{slice.brands.map(row => <div key={row.key}><span><strong>{row.brand}</strong><small>{number.format(row.previous)} → {number.format(row.current)} шт.</small></span><b className={row.delta > 0 ? 'positive' : row.delta < 0 ? 'negative' : ''}>{hasComparison ? `${row.delta > 0 ? '+' : ''}${number.format(row.delta)}` : '—'}</b><em>{hasComparison ? row.deltaRate === null ? 'новый остаток' : `${row.deltaRate > 0 ? '+' : ''}${number.format(row.deltaRate)}%` : 'нет сравнения'}</em></div>)}</div>
      </aside>
    </div>
  </section>;
}
