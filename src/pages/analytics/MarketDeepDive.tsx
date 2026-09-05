import { Fragment } from 'react';
import type { CSSProperties } from 'react';
import { PolarAngleAxis, PolarGrid, PolarRadiusAxis, Radar, RadarChart, ResponsiveContainer, Tooltip } from 'recharts';
import { AnalyticsPanel, PanelHeader } from '../../components/AnalyticsPrimitives';
import { decomposeAmountShare } from '../../data/marketCalculations';

export interface MarketDeepDivePoint {
  date: string;
  marketAmount: number;
  ownAmount: number;
  amountShare: number;
  marketOrders: number;
  ownOrders: number;
  ordersShare: number;
  marketCheck: number;
  ownCheck: number;
}

export interface MarketDeepDiveTotals {
  marketAmount: number;
  ownAmount: number;
  marketOrders: number;
  ownOrders: number;
}

type MatrixGroup = 'Рынок' | 'Наши показатели' | 'Наша позиция';
type MetricKey = Exclude<keyof MarketDeepDivePoint, 'date'>;

interface MatrixRow {
  key: MetricKey;
  label: string;
  group: MatrixGroup;
  values: number[];
  format: (value: number) => string;
  points?: boolean;
}

const groups: MatrixGroup[] = ['Рынок', 'Наши показатели', 'Наша позиция'];
const fmt = (value: number, digits = 0) => new Intl.NumberFormat('ru-RU', { maximumFractionDigits: digits }).format(value || 0);
const shortDate = (value: string) => value.length === 10 ? `${value.slice(8, 10)}.${value.slice(5, 7)}` : value;
const delta = (current: number, previous: number) => previous ? (current - previous) / Math.abs(previous) * 100 : current ? 100 : 0;

function Sparkline({ values, tone = 'market' }: { values: number[]; tone?: 'market' | 'own' | 'accent' }) {
  const width = 68;
  const height = 24;
  const min = Math.min(...values, 0);
  const max = Math.max(...values, 1);
  const range = max - min || 1;
  const points = values.length > 1
    ? values.map((value, index) => `${index / (values.length - 1) * width},${height - 2 - (value - min) / range * (height - 4)}`).join(' ')
    : `0,${height / 2} ${width},${height / 2}`;
  return <svg className={`market-deep-sparkline market-deep-sparkline-${tone}`} viewBox={`0 0 ${width} ${height}`} aria-hidden="true"><polyline points={points} /></svg>;
}

function heatColor(values: number[], value: number) {
  const min = Math.min(...values);
  const max = Math.max(...values);
  if (max === min) return '#FFFFFF';
  const score = (value - min) / (max - min);
  const distance = Math.abs(score - .5) * 2;
  if (distance < .12) return '#FFFFFF';
  const alpha = .08 + distance * .2;
  return score >= .5 ? `rgba(77, 177, 108, ${alpha})` : `rgba(225, 101, 124, ${alpha})`;
}

function rowDelta(row: MatrixRow) {
  const first = row.values.at(0) || 0;
  const last = row.values.at(-1) || 0;
  if (row.points) return `${last - first >= 0 ? '+' : ''}${fmt(last - first, 2)} п.п.`;
  if (!first) return last ? 'новые данные' : '—';
  return `${last - first >= 0 ? '+' : ''}${fmt((last - first) / Math.abs(first) * 100, 1)}%`;
}

function totalsWithDerived(totals: MarketDeepDiveTotals) {
  return {
    ...totals,
    amountShare: totals.marketAmount ? totals.ownAmount / totals.marketAmount * 100 : 0,
    ordersShare: totals.marketOrders ? totals.ownOrders / totals.marketOrders * 100 : 0,
    marketCheck: totals.marketOrders ? totals.marketAmount / totals.marketOrders : 0,
    ownCheck: totals.ownOrders ? totals.ownAmount / totals.ownOrders : 0,
  };
}

export default function MarketDeepDive({ points, currentTotals, previousTotals, comparisonLabel }: {
  points: MarketDeepDivePoint[];
  currentTotals: MarketDeepDiveTotals;
  previousTotals: MarketDeepDiveTotals;
  comparisonLabel: string;
}) {
  const current = totalsWithDerived(currentTotals);
  const previous = totalsWithDerived(previousTotals);
  const marketGrowth = delta(current.marketAmount, previous.marketAmount);
  const ownGrowth = delta(current.ownAmount, previous.ownAmount);
  const amountShareChange = current.amountShare - previous.amountShare;
  const { marketEffect, ownEffect } = decomposeAmountShare(current.marketAmount, current.ownAmount, previous.marketAmount, previous.ownAmount);
  const waterfallScale = Math.max(previous.amountShare, current.amountShare, Math.abs(marketEffect), Math.abs(ownEffect), 1);
  const waterfallHeight = (value: number) => `${Math.max(15, Math.abs(value) / waterfallScale * 100)}%`;

  const radarValues = [
    ['Рынок, ₽', current.marketAmount, previous.marketAmount],
    ['Наши заказы, ₽', current.ownAmount, previous.ownAmount],
    ['Доля, ₽', current.amountShare, previous.amountShare],
    ['Наши заказы, шт', current.ownOrders, previous.ownOrders],
    ['Индекс чека', current.marketCheck ? current.ownCheck / current.marketCheck * 100 : 0, previous.marketCheck ? previous.ownCheck / previous.marketCheck * 100 : 0],
  ] as const;
  const radarData = radarValues.map(([metric, currentValue, previousValue]) => {
    const base = Math.max(currentValue, previousValue, 1);
    return { metric, current: currentValue / base * 100, previous: previousValue / base * 100 };
  });

  const matrixRows: MatrixRow[] = (() => {
    const values = (key: MetricKey) => points.map(point => point[key]);
    const money = (value: number) => `${fmt(value)} ₽`;
    const count = (value: number) => fmt(value);
    const percent = (value: number) => `${fmt(value, 2)}%`;
    return [
      { key: 'marketAmount', label: 'Сумма заказов', group: 'Рынок', values: values('marketAmount'), format: money },
      { key: 'marketOrders', label: 'Заказы, шт.', group: 'Рынок', values: values('marketOrders'), format: count },
      { key: 'marketCheck', label: 'Средний чек', group: 'Рынок', values: values('marketCheck'), format: money },
      { key: 'ownAmount', label: 'Наша сумма заказов', group: 'Наши показатели', values: values('ownAmount'), format: money },
      { key: 'ownOrders', label: 'Наши заказы, шт.', group: 'Наши показатели', values: values('ownOrders'), format: count },
      { key: 'ownCheck', label: 'Наш средний чек', group: 'Наши показатели', values: values('ownCheck'), format: money },
      { key: 'amountShare', label: 'Доля рынка, сумма', group: 'Наша позиция', values: values('amountShare'), format: percent, points: true },
      { key: 'ordersShare', label: 'Доля рынка, штуки', group: 'Наша позиция', values: values('ordersShare'), format: percent, points: true },
    ];
  })();

  const changes = [
    ['Объём рынка', marketGrowth, `${fmt(current.marketAmount - previous.marketAmount)} ₽`, false],
    ['Наши заказы', ownGrowth, `${fmt(current.ownAmount - previous.ownAmount)} ₽`, false],
    ['Доля рынка', amountShareChange, `${fmt(current.amountShare, 2)}%`, true],
    ['Заказы рынка', delta(current.marketOrders, previous.marketOrders), `${fmt(current.marketOrders - previous.marketOrders)} шт.`, false],
    ['Наши заказы, шт.', delta(current.ownOrders, previous.ownOrders), `${fmt(current.ownOrders - previous.ownOrders)} шт.`, false],
    ['Средний чек', delta(current.marketCheck, previous.marketCheck), `${fmt(current.marketCheck)} ₽`, false],
  ] as const;

  return <section className="market-deep-dive" aria-label="Расширенный анализ рынка">
    <div className="market-deep-grid">
      <AnalyticsPanel className="market-deep-relative" density="data">
        <PanelHeader eyebrow="Сравнение" title="Как мы выглядим относительно рынка" />
        <div className="market-deep-relative-metrics">
          <div><span>Рост рынка</span><strong className="market">{marketGrowth >= 0 ? '+' : ''}{fmt(marketGrowth, 1)}%</strong><Sparkline values={points.map(point => point.marketAmount)} /></div>
          <div><span>Наш рост</span><strong className="own">{ownGrowth >= 0 ? '+' : ''}{fmt(ownGrowth, 1)}%</strong><Sparkline values={points.map(point => point.ownAmount)} tone="own" /></div>
          <div><span>Разница</span><strong className={ownGrowth - marketGrowth >= 0 ? 'positive' : 'negative'}>{ownGrowth - marketGrowth >= 0 ? '+' : ''}{fmt(ownGrowth - marketGrowth, 1)} п.п.</strong><Sparkline values={points.map(point => point.amountShare)} tone="accent" /></div>
        </div>
      </AnalyticsPanel>

      <AnalyticsPanel className="market-deep-waterfall-card" density="data">
        <PanelHeader eyebrow="Декомпозиция" title="Что изменилось в доле рынка" description="Вклад изменения рынка и наших заказов в денежную долю." />
        <div className="market-deep-waterfall">
          <div className="total" style={{ '--bar': waterfallHeight(previous.amountShare) } as CSSProperties}><b>{fmt(previous.amountShare, 2)}%</b><i /><span>Было</span></div>
          <div className={marketEffect >= 0 ? 'positive' : 'negative'} style={{ '--bar': waterfallHeight(marketEffect) } as CSSProperties}><b>{marketEffect >= 0 ? '+' : ''}{fmt(marketEffect, 2)} п.п.</b><i /><span>Рынок</span></div>
          <div className={ownEffect >= 0 ? 'positive' : 'negative'} style={{ '--bar': waterfallHeight(ownEffect) } as CSSProperties}><b>{ownEffect >= 0 ? '+' : ''}{fmt(ownEffect, 2)} п.п.</b><i /><span>Мы</span></div>
          <div className="total" style={{ '--bar': waterfallHeight(current.amountShare) } as CSSProperties}><b>{fmt(current.amountShare, 2)}%</b><i /><span>Стало</span></div>
        </div>
      </AnalyticsPanel>

      <AnalyticsPanel className="market-deep-health" density="data">
        <PanelHeader eyebrow="Рыночное здоровье" title="Ключевые индикаторы" />
        <dl>
          <div><dt>Состояние рынка</dt><dd className={marketGrowth >= 0 ? 'positive' : 'negative'}>{marketGrowth >= 0 ? 'Растущий' : 'Снижается'}</dd></div>
          <div><dt>Темп рынка</dt><dd>{marketGrowth >= 0 ? '+' : ''}{fmt(marketGrowth, 1)}%</dd></div>
          <div><dt>Доля по сумме</dt><dd>{fmt(current.amountShare, 2)}%</dd></div>
          <div><dt>Доля по штукам</dt><dd>{fmt(current.ordersShare, 2)}%</dd></div>
          <div><dt>Средний чек рынка</dt><dd>{fmt(current.marketCheck)} ₽</dd></div>
          <div><dt>Наш средний чек</dt><dd>{fmt(current.ownCheck)} ₽</dd></div>
        </dl>
      </AnalyticsPanel>

      <AnalyticsPanel className="market-deep-radar" density="data">
        <PanelHeader eyebrow="Радар" title="Профиль изменений" description="Максимум двух периодов по каждой оси = 100." />
        <ResponsiveContainer width="100%" height={210}><RadarChart data={radarData}><PolarGrid stroke="var(--ds-color-border)" /><PolarAngleAxis dataKey="metric" tick={{ fontSize: 8, fill: 'var(--ds-color-muted)' }} /><PolarRadiusAxis domain={[0, 100]} tick={false} axisLine={false} /><Radar name="Текущий период" dataKey="current" stroke="var(--ds-series-market)" fill="var(--ds-series-market)" fillOpacity={.12} /><Radar name="Предыдущий период" dataKey="previous" stroke="var(--ds-series-own)" fill="var(--ds-series-own)" fillOpacity={.12} /><Tooltip formatter={value => `${fmt(Number(value), 0)} баллов`} /></RadarChart></ResponsiveContainer>
        <div className="market-deep-legend"><span><i className="current" />Текущий</span><span><i />Предыдущий</span></div>
      </AnalyticsPanel>
    </div>

    <AnalyticsPanel className="market-deep-changes" density="data">
      <PanelHeader eyebrow="Ключевые изменения за период" title="Сравнение равных периодов" description={comparisonLabel} />
      <div className="market-deep-change-grid">{changes.map(([label, value, detail, pointsChange]) => <article key={label}><i /><span>{label}</span><strong className={value >= 0 ? 'positive' : 'negative'}>{value >= 0 ? '+' : ''}{fmt(value, pointsChange ? 2 : 1)}{pointsChange ? ' п.п.' : '%'}</strong><small>{detail}</small></article>)}</div>
    </AnalyticsPanel>

    <AnalyticsPanel className="market-deep-matrix" density="data">
      <PanelHeader eyebrow="Аналитический лист" title="Матрица показателей" description="Цвет сравнивает значения только внутри одной строки." controls={<span className="market-deep-period-count">{points.length} периодов</span>} />
      <div className="market-deep-matrix-wrap"><table><thead><tr><th>Метрика</th><th>Тренд</th><th>Изменение</th>{points.map((point, index) => <th key={point.date} className={index === points.length - 1 ? 'is-latest' : ''}>{shortDate(point.date)}</th>)}<th>Среднее</th><th>Абс. изменение</th></tr></thead><tbody>{groups.map(group => <Fragment key={group}><tr className="market-deep-matrix-group"><td colSpan={points.length + 5}>{group}</td></tr>{matrixRows.filter(row => row.group === group).map(row => { const first = row.values.at(0) || 0; const last = row.values.at(-1) || 0; const difference = last - first; return <tr key={row.key}><td><strong>{row.label}</strong></td><td><Sparkline values={row.values} tone={row.group === 'Наши показатели' ? 'own' : row.group === 'Наша позиция' ? 'accent' : 'market'} /></td><td><span className={difference >= 0 ? 'positive' : 'negative'}>{rowDelta(row)}</span></td>{row.values.map((value, index) => <td key={`${row.key}-${points[index]?.date}`} className={index === row.values.length - 1 ? 'is-latest' : ''} style={{ background: heatColor(row.values, value) }} title={`${row.label} · ${shortDate(points[index]?.date || '')}: ${row.format(value)}`}>{row.format(value)}</td>)}<td className="market-deep-summary">{row.format(row.values.reduce((sum, value) => sum + value, 0) / Math.max(row.values.length, 1))}</td><td className={difference >= 0 ? 'positive' : 'negative'}>{row.points ? `${difference >= 0 ? '+' : ''}${fmt(difference, 2)} п.п.` : row.format(difference)}</td></tr>; })}</Fragment>)}</tbody></table></div>
    </AnalyticsPanel>
  </section>;
}
