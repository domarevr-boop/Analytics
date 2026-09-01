import { useMemo, useState, useSyncExternalStore, type ReactNode } from 'react';
import {
  clearAggregatePlanKind, getAggregatePlans, getCabinets, getPreferAggregatePlan, getProducts,
  getVersion, replaceAggregatePlanKind, setPreferAggregatePlan, subscribe, upsertAggregatePlan,
} from '../data/store';
import { makeAggregatePlanId, type AggregatePlanMetrics, type EditableAggregatePlanField } from '../data/planningCalculations';
import { selectAggregatePlanMetrics } from '../data/planningSelectors';
import type { AggregateMonthlyPlanRecord, AggregatePlanKind, Cabinet } from '../types';

interface CategoryEntity { id: string; name: string; cabinetId: string }
interface PeriodMetrics { ordersSum: number | null; ordersQty: number | null; avgCheck: number | null; buyoutRate: number | null; buyoutAmount: number | null; payoutRate: number | null; payoutAmount: number | null; profitability: number | null; netProfit: number | null; ordersPerDay: number | null; netProfitPerDay: number | null; days: number }

const MONTH_NAMES = ['Янв', 'Фев', 'Мар', 'Апр', 'Май', 'Июн', 'Июл', 'Авг', 'Сен', 'Окт', 'Ноя', 'Дек'];
const money = (value: number | null) => value === null ? '—' : `${value.toLocaleString('ru-RU', { maximumFractionDigits: 0 })} ₽`;
const number = (value: number | null) => value === null ? '—' : value.toLocaleString('ru-RU', { maximumFractionDigits: 1 });
const percent = (value: number | null) => value === null ? '—' : `${value.toLocaleString('ru-RU', { maximumFractionDigits: 1 })}%`;
const monthList = (year: number) => MONTH_NAMES.map((_, index) => `${year}-${String(index + 1).padStart(2, '0')}`);

function parseInput(value: string): number | null {
  const normalized = value.trim().replace(/[\s₽%]/g, '').replace(',', '.');
  if (!normalized) return null;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function sumKnown(values: Array<number | null>): number | null {
  const known = values.filter((value): value is number => value !== null);
  return known.length ? known.reduce((sum, value) => sum + value, 0) : null;
}

function ratio(amount: number | null, base: number | null): number | null {
  if (amount === null || base === null || base === 0) return null;
  return amount / base * 100;
}

function periodMetrics(metrics: AggregatePlanMetrics[]): PeriodMetrics {
  const ordersSum = sumKnown(metrics.map(item => item.ordersSum));
  const ordersQty = sumKnown(metrics.map(item => item.ordersQty));
  const buyoutAmount = sumKnown(metrics.map(item => item.buyoutAmount));
  const payoutAmount = sumKnown(metrics.map(item => item.payoutAmount));
  const netProfit = sumKnown(metrics.map(item => item.netProfit));
  const days = metrics.reduce((sum, item) => sum + item.daysInMonth, 0);
  return {
    ordersSum, ordersQty,
    avgCheck: ordersSum !== null && ordersQty ? ordersSum / ordersQty : null,
    buyoutRate: ratio(buyoutAmount, ordersSum), buyoutAmount,
    payoutRate: ratio(payoutAmount, ordersSum), payoutAmount,
    profitability: ratio(netProfit, buyoutAmount), netProfit,
    ordersPerDay: ordersSum !== null && days ? ordersSum / days : null,
    netProfitPerDay: netProfit !== null && days ? netProfit / days : null,
    days,
  };
}

function delta(current: number | null, baseline: number | null): number | null {
  return current === null || baseline === null || baseline === 0 ? null : (current / baseline - 1) * 100;
}

export default function PlanningPage() {
  const version = useSyncExternalStore(subscribe, getVersion);
  const currentDate = useMemo(() => { const date = new Date(); return { year: date.getFullYear(), month: date.getMonth() }; }, []);
  const [year, setYear] = useState(currentDate.year);
  const [showPast, setShowPast] = useState(false);
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set());
  const records = useMemo(() => { void version; return getAggregatePlans(); }, [version]);
  const cabinets = useMemo(() => { void version; return getCabinets(); }, [version]);
  const products = useMemo(() => { void version; return getProducts().filter(product => product.status !== 'archived'); }, [version]);
  const preferAggregate = useMemo(() => { void version; return getPreferAggregatePlan(); }, [version]);
  const allMonths = useMemo(() => monthList(year), [year]);
  const visibleMonths = useMemo(() => year === currentDate.year && !showPast ? allMonths.slice(currentDate.month) : allMonths, [allMonths, currentDate, showPast, year]);
  const recordMap = useMemo(() => new Map(records.map(record => [record.id, record])), [records]);

  const categoriesByCabinet = useMemo(() => {
    const map = new Map<string, CategoryEntity[]>();
    cabinets.forEach(cabinet => {
      const names = [...new Set(products.filter(product => product.cabinet_id === cabinet.id).map(product => product.category?.trim()).filter((name): name is string => Boolean(name) && name!.toLocaleLowerCase('ru') !== 'без категории'))].sort((a, b) => a.localeCompare(b, 'ru'));
      map.set(cabinet.id, names.map(name => ({ id: name, name, cabinetId: cabinet.id })));
    });
    return map;
  }, [cabinets, products]);

  const getMetrics = (kind: AggregatePlanKind, cabinetId: string, category: string | null, month: string) => selectAggregatePlanMetrics(records, month, category ? { cabinetId, category } : cabinetId ? { cabinetId } : {}, kind);
  const getRecord = (kind: AggregatePlanKind, category: CategoryEntity, month: string) => recordMap.get(makeAggregatePlanId(kind, month, 'category', category.cabinetId, category.id));
  const save = (kind: AggregatePlanKind, category: CategoryEntity, month: string, field: EditableAggregatePlanField, value: number | null) => {
    const id = makeAggregatePlanId(kind, month, 'category', category.cabinetId, category.id);
    upsertAggregatePlan({
      id, kind, month, scope: 'category', cabinet_id: category.cabinetId, entity_id: category.id, entity_name: category.name,
      orders_sum: null, avg_qty_per_day: null, avg_check: null, buyout_rate: null, payout_rate: null, profitability: null,
      ...recordMap.get(id), [field]: value, updated_at: new Date().toISOString(),
    });
  };
  const toggleCategory = (key: string) => setExpandedCategories(current => { const next = new Set(current); if (next.has(key)) next.delete(key); else next.add(key); return next; });
  const copyFixedToScenario = async () => {
    const prefix = `${year}-`;
    const retained = records.filter(record => record.kind === 'scenario' && !record.month.startsWith(prefix));
    const copied = records.filter(record => record.kind === 'fixed' && record.scope === 'category' && record.month.startsWith(prefix)).map(record => ({ ...record, id: makeAggregatePlanId('scenario', record.month, 'category', record.cabinet_id, record.entity_id), kind: 'scenario' as const, updated_at: new Date().toISOString() }));
    await replaceAggregatePlanKind('scenario', [...retained, ...copied]);
  };
  const resetScenario = async () => {
    const retained = records.filter(record => record.kind === 'scenario' && !record.month.startsWith(`${year}-`));
    if (retained.length) await replaceAggregatePlanKind('scenario', retained); else clearAggregatePlanKind('scenario');
  };

  const total = periodMetrics(visibleMonths.map(month => getMetrics('fixed', '', null, month)));

  const tableProps = { visibleMonths, categoriesByCabinet, expandedCategories, onToggleCategory: toggleCategory, getMetrics, getRecord, onSave: save };
  return <div className="planning-page analytics-page-shell aggregate-plan-page compact-plan-page">
    <header className="analytics-page-header aggregate-plan-header">
      <div><span>БИЗНЕС-МЕТРИКИ</span><h1>Планирование</h1><p>Совокупный план по кабинетам и категориям. Базовые значения вводятся в таблице, расчёты обновляются автоматически.</p></div>
      <div className="aggregate-plan-controls">
        <label>Год<input type="number" value={year} min="2020" max="2100" onChange={event => setYear(Number(event.target.value) || year)} /></label>
        <label className="aggregate-plan-priority"><input type="checkbox" checked={preferAggregate} onChange={event => setPreferAggregatePlan(event.target.checked)} /><span><strong>Совокупный план — источник истины</strong><small>Действует для всех месяцев и главной страницы.</small></span></label>
      </div>
    </header>

    <div className="aggregate-plan-kpis">
      <Summary label="Сумма заказов" value={money(total.ordersSum)} /><Summary label="Чистая прибыль" value={money(total.netProfit)} /><Summary label="К перечислению" value={money(total.payoutAmount)} /><Summary label="Рентабельность" value={percent(total.profitability)} />
    </div>

    <div className="compact-plan-toolbar">
      <div><h2>Совокупный план ВБ</h2><span>{year === currentDate.year && !showPast ? `Текущий и будущие месяцы ${year}` : `Все месяцы ${year}`}</span></div>
      {year === currentDate.year && <button type="button" onClick={() => setShowPast(value => !value)}>{showPast ? 'Скрыть прошедшие месяцы' : 'Показать прошедшие месяцы'}</button>}
    </div>

    <PlanSection title="Утверждённый план" description="Сумма заказов вводится по месяцам. Рентабельность задаётся для всех видимых месяцев категории." kind="fixed" cabinets={cabinets} {...tableProps} />
    <PlanSection title="Сценарная модель" description="Черновой сценарий сравнивается с утверждённым планом и не влияет на главную." kind="scenario" cabinets={cabinets} {...tableProps} compare actions={<><button type="button" onClick={() => void copyFixedToScenario()}>Скопировать из плана</button><button type="button" className="secondary" onClick={() => void resetScenario()}>Сбросить сценарий</button></>} />
    <p className="compact-plan-footnote">Все суммы в рублях. Пустое значение означает, что план или исходный параметр не задан.</p>
  </div>;
}

function Summary({ label, value }: { label: string; value: string }) { return <div className="aggregate-plan-kpi"><span>{label}</span><strong>{value}</strong></div>; }

interface PlanSectionProps {
  title: string; description: string; kind: AggregatePlanKind; cabinets: Cabinet[]; visibleMonths: string[]; categoriesByCabinet: Map<string, CategoryEntity[]>; expandedCategories: Set<string>;
  onToggleCategory: (key: string) => void;
  getMetrics: (kind: AggregatePlanKind, cabinetId: string, category: string | null, month: string) => AggregatePlanMetrics;
  getRecord: (kind: AggregatePlanKind, category: CategoryEntity, month: string) => AggregateMonthlyPlanRecord | undefined;
  onSave: (kind: AggregatePlanKind, category: CategoryEntity, month: string, field: EditableAggregatePlanField, value: number | null) => void;
  compare?: boolean; actions?: ReactNode;
}

function PlanSection({ title, description, cabinets, categoriesByCabinet, actions, ...props }: PlanSectionProps) {
  const visibleCabinets = cabinets.filter(cabinet => (categoriesByCabinet.get(cabinet.id) || []).length > 0);
  return <section className="aggregate-plan-section analytics-sheet compact-plan-section">
    <div className="aggregate-plan-section-head"><div><h2>{title}</h2><p>{description}</p></div>{actions && <div className="aggregate-plan-actions">{actions}</div>}</div>
    <div className="cabinet-plan-list">{visibleCabinets.map(cabinet => <CabinetPlanTable key={cabinet.id} cabinet={cabinet} categories={categoriesByCabinet.get(cabinet.id) || []} {...props} />)}{visibleCabinets.length === 0 && <div className="aggregate-plan-empty">Нет кабинетов с назначенными категориями.</div>}</div>
  </section>;
}

function CabinetPlanTable({ cabinet, categories, kind, visibleMonths, expandedCategories, onToggleCategory, getMetrics, getRecord, onSave, compare }: Omit<PlanSectionProps, 'title' | 'description' | 'cabinets' | 'categoriesByCabinet' | 'actions'> & { cabinet: Cabinet; categories: CategoryEntity[] }) {
  const cabinetPeriod = periodMetrics(visibleMonths.map(month => getMetrics(kind, cabinet.id, null, month)));
  return <div className="cabinet-plan-card">
    <div className="cabinet-plan-title"><strong>Кабинет: {cabinet.name}</strong><span>{categories.length} {categories.length === 1 ? 'категория' : 'категории'}</span></div>
    <div className="cabinet-plan-scroll"><table className="cabinet-plan-table">
      <thead><tr><th className="category-col">Категория</th><th>Заказы, шт</th><th>Ср. чек</th><th>% выкупа</th><th>Сумма выкупов</th><th>% к перечислению</th><th>К перечислению</th><th>Рентабельность</th><th>ЧП</th>{visibleMonths.map(month => <th className="month-col" key={month}>{MONTH_NAMES[Number(month.slice(5, 7)) - 1]}</th>)}<th className="total-col">Итого</th></tr></thead>
      <tbody>
        <tr className="cabinet-total-row"><th>Итого по кабинету</th><MetricCells metrics={cabinetPeriod} />{visibleMonths.map(month => <td key={month}>{money(getMetrics(kind, cabinet.id, null, month).ordersSum)}</td>)}<td>{money(cabinetPeriod.ordersSum)}</td></tr>
        {categories.map(category => <CategoryRows key={category.id} category={category} cabinet={cabinet} {...{ kind, visibleMonths, expandedCategories, onToggleCategory, getMetrics, getRecord, onSave, compare }} />)}
      </tbody>
    </table></div>
  </div>;
}

function MetricCells({ metrics }: { metrics: PeriodMetrics }) {
  return <><td>{number(metrics.ordersQty)}</td><td>{money(metrics.avgCheck)}</td><td>{percent(metrics.buyoutRate)}</td><td>{money(metrics.buyoutAmount)}</td><td>{percent(metrics.payoutRate)}</td><td>{money(metrics.payoutAmount)}</td><td>{percent(metrics.profitability)}</td><td>{money(metrics.netProfit)}</td></>;
}

function CategoryRows({ category, kind, visibleMonths, expandedCategories, onToggleCategory, getMetrics, getRecord, onSave, compare }: Omit<PlanSectionProps, 'title' | 'description' | 'cabinets' | 'categoriesByCabinet' | 'actions'> & { category: CategoryEntity; cabinet: Cabinet }) {
  const key = `${kind}|${category.cabinetId}|${category.id}`;
  const open = expandedCategories.has(key);
  const monthly = visibleMonths.map(month => getMetrics(kind, category.cabinetId, category.name, month));
  const totals = periodMetrics(monthly);
  const profitabilityValues = monthly.map(item => item.profitability).filter((value): value is number => value !== null);
  const profitabilityValue = profitabilityValues.length && profitabilityValues.every(value => Math.abs(value - profitabilityValues[0]) < 0.001) ? profitabilityValues[0] : totals.profitability;
  const saveProfitability = (value: number | null) => visibleMonths.forEach(month => onSave(kind, category, month, 'profitability', value));
  return <>
    <tr className="category-plan-row">
      <th><button type="button" onClick={() => onToggleCategory(key)} aria-expanded={open}>{open ? '⌄' : '›'}</button><span>{category.name}</span></th>
      <td>{number(totals.ordersQty)}</td><td>{money(totals.avgCheck)}</td><td>{percent(totals.buyoutRate)}</td><td>{money(totals.buyoutAmount)}</td><td>{percent(totals.payoutRate)}</td><td>{money(totals.payoutAmount)}</td>
      <td className="plan-input-cell"><input key={`${kind}|${key}|profitability|${profitabilityValue ?? 'empty'}`} defaultValue={profitabilityValue === null ? '' : String(profitabilityValue).replace('.', ',')} placeholder="—" inputMode="decimal" aria-label={`${category.name}, рентабельность`} onBlur={event => saveProfitability(parseInput(event.target.value))} /><span>%</span></td>
      <td>{money(totals.netProfit)}</td>
      {visibleMonths.map((month, index) => {
        const record = getRecord(kind, category, month);
        const value = record?.orders_sum ?? monthly[index].ordersSum;
        const plan = compare ? getMetrics('fixed', category.cabinetId, category.name, month).ordersSum : null;
        const difference = compare ? delta(value, plan) : null;
        return <td className="plan-input-cell month-input" key={month}><input key={`${record?.updated_at || 'empty'}|orders`} defaultValue={value === null ? '' : String(Math.round(value))} placeholder="—" inputMode="decimal" aria-label={`${category.name}, сумма заказов, ${month}`} onBlur={event => onSave(kind, category, month, 'orders_sum', parseInput(event.target.value))} />{difference !== null && <small className={difference >= 0 ? 'positive' : 'negative'}>{difference >= 0 ? '+' : ''}{difference.toLocaleString('ru-RU', { maximumFractionDigits: 1 })}%</small>}</td>;
      })}
      <td className="total-col">{money(totals.ordersSum)}</td>
    </tr>
    {open && <>
      <DetailRow label="Сумма заказов в день" values={monthly.map(item => money(item.ordersPerDay))} total={money(totals.ordersPerDay)} visibleMonths={visibleMonths} />
      <DetailRow label="Чистая прибыль в день" values={monthly.map(item => money(item.netProfitPerDay))} total={money(totals.netProfitPerDay)} visibleMonths={visibleMonths} />
      <DetailRow label="Дней в месяце" values={monthly.map(item => String(item.daysInMonth))} total={String(totals.days)} visibleMonths={visibleMonths} />
    </>}
  </>;
}

function DetailRow({ label, values, total, visibleMonths }: { label: string; values: string[]; total: string; visibleMonths: string[] }) {
  return <tr className="category-detail-row"><th>{label}</th><td colSpan={8}></td>{visibleMonths.map((month, index) => <td key={month}>{values[index]}</td>)}<td className="total-col">{total}</td></tr>;
}
