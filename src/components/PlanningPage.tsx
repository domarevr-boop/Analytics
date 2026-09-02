import { useMemo, useState, useSyncExternalStore, type ReactNode } from 'react';
import {
  clearAggregatePlanKind, getAggregatePlans, getCabinets, getPreferAggregatePlan, getProducts,
  getVersion, replaceAggregatePlanKind, setPreferAggregatePlan, subscribe, upsertAggregatePlan,
} from '../data/store';
import { makeAggregatePlanId, type AggregatePlanMetrics, type EditableAggregatePlanField } from '../data/planningCalculations';
import { selectAggregatePlanMetrics } from '../data/planningSelectors';
import { buildBackupRecords, buildPromotedFixedRecords, buildRestoredFixedRecords, removeBackupForYear } from '../data/planningPlanActions';
import type { AggregateMonthlyPlanRecord, AggregatePlanKind, Cabinet } from '../types';

type MetricKey = keyof Pick<AggregatePlanMetrics, 'ordersSum' | 'ordersQty' | 'avgCheck' | 'buyoutRate' | 'buyoutAmount' | 'payoutRate' | 'payoutAmount' | 'profitability' | 'netProfit' | 'ordersPerDay' | 'netProfitPerDay' | 'daysInMonth'>;
type ColumnKey = 'ordersSum' | 'ordersQty' | 'avgCheck' | 'buyoutRate' | 'buyoutAmount' | 'payoutRate' | 'payoutAmount' | 'profitability' | 'netProfit';
type ValueFormat = 'money' | 'number' | 'percent' | 'days';
interface CategoryEntity { id: string; name: string; cabinetId: string }
interface ColumnDefinition { key: ColumnKey; label: string; format: ValueFormat; required?: boolean }
interface PeriodMetrics { ordersSum: number | null; ordersQty: number | null; avgCheck: number | null; buyoutRate: number | null; buyoutAmount: number | null; payoutRate: number | null; payoutAmount: number | null; profitability: number | null; netProfit: number | null; ordersPerDay: number | null; netProfitPerDay: number | null; daysInMonth: number }

const MONTH_NAMES = ['Янв', 'Фев', 'Мар', 'Апр', 'Май', 'Июн', 'Июл', 'Авг', 'Сен', 'Окт', 'Ноя', 'Дек'];
const COLUMN_STORAGE_KEY = 'analytics:planning-columns:v2';
const emptyBackupKey = (year: number) => `analytics:planning-empty-backup:${year}`;
const DEFAULT_COLUMN_KEYS: ColumnKey[] = ['ordersSum', 'buyoutAmount', 'profitability', 'netProfit'];
const COLUMNS: ColumnDefinition[] = [
  { key: 'ordersSum', label: 'Сумма заказов', format: 'money', required: true },
  { key: 'ordersQty', label: 'Заказы, шт', format: 'number' },
  { key: 'avgCheck', label: 'Средний чек', format: 'money' },
  { key: 'buyoutRate', label: '% выкупа', format: 'percent' },
  { key: 'buyoutAmount', label: 'Сумма выкупов', format: 'money' },
  { key: 'payoutRate', label: '% к перечислению', format: 'percent' },
  { key: 'payoutAmount', label: 'К перечислению', format: 'money' },
  { key: 'profitability', label: 'Рентабельность', format: 'percent', required: true },
  { key: 'netProfit', label: 'Чистая прибыль', format: 'money' },
];
const SCENARIO_DRIVERS: Array<{ key: EditableAggregatePlanField; metric: MetricKey; label: string; format: ValueFormat }> = [
  { key: 'avg_check', metric: 'avgCheck', label: 'Средний чек', format: 'money' },
  { key: 'buyout_rate', metric: 'buyoutRate', label: '% выкупа', format: 'percent' },
  { key: 'payout_rate', metric: 'payoutRate', label: '% к перечислению', format: 'percent' },
  { key: 'profitability', metric: 'profitability', label: 'Рентабельность', format: 'percent' },
];
const SCENARIO_RESULTS: Array<{ metric: MetricKey; label: string; format: ValueFormat }> = [
  { metric: 'ordersQty', label: 'Заказы, шт', format: 'number' },
  { metric: 'buyoutAmount', label: 'Сумма выкупов', format: 'money' },
  { metric: 'payoutAmount', label: 'К перечислению', format: 'money' },
  { metric: 'netProfit', label: 'Чистая прибыль', format: 'money' },
];

function formatValue(value: number | null, format: ValueFormat): string {
  if (value === null || !Number.isFinite(value)) return '—';
  if (format === 'money') return `${value.toLocaleString('ru-RU', { maximumFractionDigits: 0 })} ₽`;
  if (format === 'percent') return `${value.toLocaleString('ru-RU', { maximumFractionDigits: 1 })}%`;
  if (format === 'days') return value.toLocaleString('ru-RU', { maximumFractionDigits: 0 });
  return value.toLocaleString('ru-RU', { maximumFractionDigits: 1 });
}
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
  return amount === null || base === null || base === 0 ? null : amount / base * 100;
}
function weightedKnown(metrics: AggregatePlanMetrics[], value: (metric: AggregatePlanMetrics) => number | null, weight: (metric: AggregatePlanMetrics) => number | null): number | null {
  const known = metrics.filter(metric => value(metric) !== null);
  if (!known.length) return null;
  const weighted = known.filter(metric => (weight(metric) ?? 0) > 0);
  if (!weighted.length) return known.reduce((sum, metric) => sum + (value(metric) ?? 0), 0) / known.length;
  const totalWeight = weighted.reduce((sum, metric) => sum + (weight(metric) ?? 0), 0);
  return weighted.reduce((sum, metric) => sum + (value(metric) ?? 0) * (weight(metric) ?? 0), 0) / totalWeight;
}
function periodMetrics(metrics: AggregatePlanMetrics[]): PeriodMetrics {
  const ordersSum = sumKnown(metrics.map(item => item.ordersSum));
  const ordersQty = sumKnown(metrics.map(item => item.ordersQty));
  const buyoutAmount = sumKnown(metrics.map(item => item.buyoutAmount));
  const payoutAmount = sumKnown(metrics.map(item => item.payoutAmount));
  const netProfit = sumKnown(metrics.map(item => item.netProfit));
  const daysInMonth = metrics.reduce((sum, item) => sum + item.daysInMonth, 0);
  return {
    ordersSum, ordersQty, avgCheck: ordersSum !== null && ordersQty ? ordersSum / ordersQty : null,
    buyoutRate: ratio(buyoutAmount, ordersSum) ?? weightedKnown(metrics, item => item.buyoutRate, item => item.ordersSum), buyoutAmount,
    payoutRate: ratio(payoutAmount, ordersSum) ?? weightedKnown(metrics, item => item.payoutRate, item => item.ordersSum), payoutAmount,
    profitability: ratio(netProfit, buyoutAmount) ?? weightedKnown(metrics, item => item.profitability, item => item.buyoutAmount ?? item.ordersSum), netProfit,
    ordersPerDay: ordersSum !== null && daysInMonth ? ordersSum / daysInMonth : null,
    netProfitPerDay: netProfit !== null && daysInMonth ? netProfit / daysInMonth : null,
    daysInMonth,
  };
}
function delta(current: number | null, baseline: number | null): number | null {
  return current === null || baseline === null || baseline === 0 ? null : (current / baseline - 1) * 100;
}
function inputText(value: number | null): string { return value === null ? '' : String(Math.round(value * 100) / 100).replace('.', ','); }
function monthList(year: number) { return MONTH_NAMES.map((_, index) => `${year}-${String(index + 1).padStart(2, '0')}`); }

export default function PlanningPage() {
  const version = useSyncExternalStore(subscribe, getVersion);
  const currentDate = useMemo(() => { const date = new Date(); return { year: date.getFullYear(), month: date.getMonth() }; }, []);
  const [year, setYear] = useState(currentDate.year);
  const [showPast, setShowPast] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [collapsedCabinets, setCollapsedCabinets] = useState<Set<string>>(new Set());
  const [status, setStatus] = useState('');
  const [visibleColumnKeys, setVisibleColumnKeys] = useState<Set<ColumnKey>>(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(COLUMN_STORAGE_KEY) || '[]') as ColumnKey[];
      return new Set(saved.length ? saved : DEFAULT_COLUMN_KEYS);
    } catch { return new Set(DEFAULT_COLUMN_KEYS); }
  });
  const records = useMemo(() => { void version; return getAggregatePlans(); }, [version]);
  const cabinets = useMemo(() => { void version; return getCabinets(); }, [version]);
  const products = useMemo(() => { void version; return getProducts().filter(product => product.status !== 'archived'); }, [version]);
  const preferAggregate = useMemo(() => { void version; return getPreferAggregatePlan(); }, [version]);
  const allMonths = useMemo(() => monthList(year), [year]);
  const months = useMemo(() => year === currentDate.year && !showPast ? allMonths.slice(currentDate.month) : allMonths, [allMonths, currentDate, showPast, year]);
  const columns = COLUMNS.filter(column => column.required || visibleColumnKeys.has(column.key));
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
  const toggleExpanded = (key: string) => setExpanded(current => { const next = new Set(current); if (next.has(key)) next.delete(key); else next.add(key); return next; });
  const toggleCabinet = (key: string) => setCollapsedCabinets(current => { const next = new Set(current); if (next.has(key)) next.delete(key); else next.add(key); return next; });
  const toggleColumn = (key: ColumnKey) => {
    const next = new Set(visibleColumnKeys);
    if (next.has(key)) next.delete(key); else next.add(key);
    setVisibleColumnKeys(next);
    localStorage.setItem(COLUMN_STORAGE_KEY, JSON.stringify([...next]));
  };

  const copyFixedToScenario = async () => {
    const prefix = `${year}-`;
    const retained = records.filter(record => record.kind === 'scenario' && !record.month.startsWith(prefix));
    const copied = records.filter(record => record.kind === 'fixed' && record.scope === 'category' && record.month.startsWith(prefix)).map(record => ({ ...record, id: makeAggregatePlanId('scenario', record.month, record.scope, record.cabinet_id, record.entity_id), kind: 'scenario' as const, updated_at: new Date().toISOString() }));
    await replaceAggregatePlanKind('scenario', [...retained, ...copied]);
    setStatus(`Сценарий ${year} скопирован из плана`);
  };
  const resetScenario = async () => {
    const retained = records.filter(record => record.kind === 'scenario' && !record.month.startsWith(`${year}-`));
    if (retained.length) await replaceAggregatePlanKind('scenario', retained); else clearAggregatePlanKind('scenario');
    setStatus(`Сценарий ${year} сброшен`);
  };
  const scenarioYearRecords = records.filter(record => record.kind === 'scenario' && record.month.startsWith(`${year}-`) && record.scope === 'category');
  const hasBackup = records.some(record => record.kind === 'backup' && record.month.startsWith(`${year}-`)) || localStorage.getItem(emptyBackupKey(year)) === '1';
  const applyScenario = async () => {
    if (!scenarioYearRecords.length || !window.confirm(`Заменить утверждённый план ${year} значениями сценария? Текущий план будет сохранён для отмены.`)) return;
    const backup = buildBackupRecords(records, year);
    localStorage.setItem(emptyBackupKey(year), backup.some(record => record.month.startsWith(`${year}-`)) ? '0' : '1');
    await replaceAggregatePlanKind('backup', backup);
    await replaceAggregatePlanKind('fixed', buildPromotedFixedRecords(records, year));
    setStatus(`Сценарий применён к плану ${year}`);
  };
  const undoApply = async () => {
    const backupYear = records.filter(record => record.kind === 'backup' && record.month.startsWith(`${year}-`));
    const backedUpEmptyPlan = localStorage.getItem(emptyBackupKey(year)) === '1';
    if ((!backupYear.length && !backedUpEmptyPlan) || !window.confirm(`Восстановить предыдущий утверждённый план ${year}?`)) return;
    await replaceAggregatePlanKind('fixed', buildRestoredFixedRecords(records, year));
    const backupOutsideYear = removeBackupForYear(records, year);
    if (backupOutsideYear.length) await replaceAggregatePlanKind('backup', backupOutsideYear); else clearAggregatePlanKind('backup');
    localStorage.removeItem(emptyBackupKey(year));
    setStatus(`Предыдущий план ${year} восстановлен`);
  };

  const total = periodMetrics(months.map(month => getMetrics('fixed', '', null, month)));
  const common = { cabinets, categoriesByCabinet, months, columns, expanded, collapsedCabinets, onToggle: toggleExpanded, onToggleCabinet: toggleCabinet, getMetrics, getRecord, onSave: save };

  return <div className="planning-page analytics-page-shell aggregate-plan-page planning-mock-page">
    <header className="analytics-page-header aggregate-plan-header">
      <div><span>БИЗНЕС-МЕТРИКИ</span><h1>Планирование</h1><p>Совокупный план по кабинетам и категориям. Редактируйте базовые параметры — расчёты обновятся автоматически.</p></div>
      <div className="aggregate-plan-controls">
        <label>Год<input type="number" value={year} min="2020" max="2100" onChange={event => setYear(Number(event.target.value) || year)} /></label>
        <label className="aggregate-plan-priority"><input type="checkbox" checked={preferAggregate} onChange={event => setPreferAggregatePlan(event.target.checked)} /><span><strong>Совокупный план — источник истины</strong><small>Действует для всех месяцев и главной страницы.</small></span></label>
      </div>
    </header>

    <div className="aggregate-plan-kpis planning-kpis">
      <Summary label="Сумма заказов (всего)" value={formatValue(total.ordersSum, 'money')} /><Summary label="Чистая прибыль (всего)" value={formatValue(total.netProfit, 'money')} /><Summary label="К перечислению (всего)" value={formatValue(total.payoutAmount, 'money')} /><Summary label="Рентабельность (ср. взвеш.)" value={formatValue(total.profitability, 'percent')} />
    </div>

    <div className="compact-plan-toolbar planning-table-toolbar">
      <div><h2>Совокупный план ВБ</h2><span>{year === currentDate.year && !showPast ? `Оставшийся период ${year}` : `Полный год ${year}`}</span></div>
      <div className="planning-toolbar-actions">
        {year === currentDate.year && <button type="button" onClick={() => setShowPast(value => !value)}>{showPast ? 'Скрыть прошедшие месяцы' : 'Показать прошедшие месяцы'}</button>}
        <details className="planning-column-settings"><summary>Настройки столбцов</summary><div>{COLUMNS.filter(column => !column.required).map(column => <label key={column.key}><input type="checkbox" checked={visibleColumnKeys.has(column.key)} onChange={() => toggleColumn(column.key)} />{column.label}</label>)}</div></details>
      </div>
    </div>

    <FixedPlanSection {...common} />
    <ScenarioSection {...common} actions={<><button type="button" onClick={() => void copyFixedToScenario()}>Скопировать из плана</button><button type="button" className="secondary" onClick={() => void resetScenario()}>Сбросить сценарий</button>{hasBackup && <button type="button" className="secondary" onClick={() => void undoApply()}>Отменить применение</button>}<button type="button" className="apply" disabled={!scenarioYearRecords.length} onClick={() => void applyScenario()}>Применить сценарий</button></>} />
    {status && <div className="planning-status" role="status">{status}</div>}
    <p className="compact-plan-footnote">Все суммы в рублях. Раскройте категорию, чтобы задать помесячные % выкупа, % к перечислению и рентабельность. Пустое значение означает, что исходный параметр не задан.</p>
  </div>;
}

function Summary({ label, value }: { label: string; value: string }) { return <div className="aggregate-plan-kpi"><span>{label}</span><strong>{value}</strong><small>за видимый период</small></div>; }

interface CommonTableProps {
  cabinets: Cabinet[]; categoriesByCabinet: Map<string, CategoryEntity[]>; months: string[]; columns: ColumnDefinition[]; expanded: Set<string>; collapsedCabinets: Set<string>;
  onToggle: (key: string) => void;
  onToggleCabinet: (key: string) => void;
  getMetrics: (kind: AggregatePlanKind, cabinetId: string, category: string | null, month: string) => AggregatePlanMetrics;
  getRecord: (kind: AggregatePlanKind, category: CategoryEntity, month: string) => AggregateMonthlyPlanRecord | undefined;
  onSave: (kind: AggregatePlanKind, category: CategoryEntity, month: string, field: EditableAggregatePlanField, value: number | null) => void;
}

function FixedPlanSection(props: CommonTableProps) {
  return <section className="aggregate-plan-section analytics-sheet planning-main-section"><CabinetList kind="fixed" mode="fixed" {...props} /></section>;
}
function ScenarioSection({ actions, ...props }: CommonTableProps & { actions: ReactNode }) {
  return <section className="aggregate-plan-section analytics-sheet planning-scenario-section"><div className="aggregate-plan-section-head"><div><h2>Сценарная модель <small>Черновик</small></h2><p>Изменяйте драйверы по месяцам и сравнивайте результат с утверждённым планом.</p></div><div className="aggregate-plan-actions">{actions}</div></div><CabinetList kind="scenario" mode="scenario" {...props} /></section>;
}

function CabinetList({ kind, mode, cabinets, categoriesByCabinet, ...props }: CommonTableProps & { kind: AggregatePlanKind; mode: 'fixed' | 'scenario' }) {
  const visible = cabinets.filter(cabinet => (categoriesByCabinet.get(cabinet.id) || []).length > 0);
  return <div className="cabinet-plan-list">{visible.map(cabinet => mode === 'fixed'
    ? <FixedCabinetTable key={cabinet.id} cabinet={cabinet} categories={categoriesByCabinet.get(cabinet.id) || []} kind={kind} {...props} />
    : <ScenarioCabinetTable key={cabinet.id} cabinet={cabinet} categories={categoriesByCabinet.get(cabinet.id) || []} kind={kind} {...props} />)}{visible.length === 0 && <div className="aggregate-plan-empty">Нет кабинетов с назначенными категориями.</div>}</div>;
}

type CabinetProps = Omit<CommonTableProps, 'cabinets' | 'categoriesByCabinet'> & { kind: AggregatePlanKind; cabinet: Cabinet; categories: CategoryEntity[] };
function CabinetHeader({ cabinet, categories, collapsed, onToggle }: { cabinet: Cabinet; categories: CategoryEntity[]; collapsed: boolean; onToggle: () => void }) { return <div className="cabinet-plan-title"><button type="button" className="cabinet-plan-toggle" onClick={onToggle} aria-expanded={!collapsed} aria-label={`${collapsed ? 'Развернуть' : 'Свернуть'} кабинет ${cabinet.name}`}>{collapsed ? '›' : '⌄'}</button><strong>Кабинет: {cabinet.name}</strong><span>{categories.length} катег.</span></div>; }

function FixedCabinetTable({ cabinet, categories, kind, months, columns, collapsedCabinets, onToggleCabinet, ...props }: CabinetProps) {
  const total = periodMetrics(months.map(month => props.getMetrics(kind, cabinet.id, null, month)));
  const collapseKey = `${kind}|${cabinet.id}`;
  const collapsed = collapsedCabinets.has(collapseKey);
  return <div className={`cabinet-plan-card${collapsed ? ' is-collapsed' : ''}`}><CabinetHeader {...{ cabinet, categories, collapsed }} onToggle={() => onToggleCabinet(collapseKey)} />{!collapsed && <div className="cabinet-plan-scroll"><table className="cabinet-plan-table fixed-plan-table">
    <thead><tr><th rowSpan={2} className="category-col">Категория</th>{columns.map(column => <th rowSpan={2} key={column.key}>{column.label}</th>)}<th colSpan={months.length + 1} className="period-group">Оставшийся период</th></tr><tr>{months.map((month, index) => <th className={`month-col${index === 0 ? ' period-start' : ''}`} key={month}>{MONTH_NAMES[Number(month.slice(5, 7)) - 1]}</th>)}<th className="total-col">Итого</th></tr></thead>
    <tbody><tr className="cabinet-total-row"><th>Итого по кабинету</th><SummaryCells metrics={total} columns={columns} />{months.map((month, index) => <td className={index === 0 ? 'period-start' : ''} key={month}>{formatValue(props.getMetrics(kind, cabinet.id, null, month).ordersSum, 'money')}</td>)}<td className="total-col">{formatValue(total.ordersSum, 'money')}</td></tr>{categories.map(category => <FixedCategoryRows key={category.id} category={category} cabinet={cabinet} kind={kind} months={months} columns={columns} collapsedCabinets={collapsedCabinets} onToggleCabinet={onToggleCabinet} {...props} />)}</tbody>
  </table></div>}</div>;
}

function FixedCategoryRows({ category, cabinet, kind, months, columns, expanded, onToggle, getMetrics, getRecord, onSave }: Omit<CabinetProps, 'categories'> & { category: CategoryEntity }) {
  const key = `fixed|${cabinet.id}|${category.id}`;
  const open = expanded.has(key);
  const monthly = months.map(month => getMetrics(kind, cabinet.id, category.name, month));
  const total = periodMetrics(monthly);
  return <><tr className="category-plan-row"><th><button type="button" onClick={() => onToggle(key)} aria-expanded={open}>{open ? '⌄' : '›'}</button>{category.name}</th><SummaryCells metrics={total} columns={columns} />{months.map((month, index) => <DriverInput key={month} cellClassName={index === 0 ? 'period-start' : ''} record={getRecord(kind, category, month)} value={getRecord(kind, category, month)?.orders_sum ?? monthly[index].ordersSum} label={`${category.name}, сумма заказов, ${month}`} onSave={value => onSave(kind, category, month, 'orders_sum', value)} />)}<td className="total-col">{formatValue(total.ordersSum, 'money')}</td></tr>{open && <>
    <FixedDetailRow label="% выкупа" metric="buyoutRate" format="percent" inputField="buyout_rate" {...{ category, kind, months, columns, monthly, getRecord, onSave }} />
    <FixedDetailRow label="% к перечислению" metric="payoutRate" format="percent" inputField="payout_rate" {...{ category, kind, months, columns, monthly, getRecord, onSave }} />
    <FixedDetailRow label="Рентабельность" metric="profitability" format="percent" inputField="profitability" {...{ category, kind, months, columns, monthly, getRecord, onSave }} />
    <FixedDetailRow label="Сумма заказов в день" metric="ordersPerDay" format="money" {...{ category, kind, months, columns, monthly, getRecord, onSave }} />
    <FixedDetailRow label="Чистая прибыль в день" metric="netProfitPerDay" format="money" {...{ category, kind, months, columns, monthly, getRecord, onSave }} />
    <FixedDetailRow label="Дней в месяце" metric="daysInMonth" format="days" {...{ category, kind, months, columns, monthly, getRecord, onSave }} />
  </>}</>;
}

function FixedDetailRow({ label, metric, format, inputField, category, kind, months, columns, monthly, getRecord, onSave }: { label: string; metric?: MetricKey; format: ValueFormat; inputField?: EditableAggregatePlanField; category: CategoryEntity; kind: AggregatePlanKind; months: string[]; columns: ColumnDefinition[]; monthly: AggregatePlanMetrics[]; getRecord: CommonTableProps['getRecord']; onSave: CommonTableProps['onSave'] }) {
  const values = metric ? monthly.map(item => item[metric] as number | null) : monthly.map(item => item.profitability);
  const total = inputField && metric ? periodMetrics(monthly)[metric] : metric === 'daysInMonth' ? sumKnown(values) : null;
  return <tr className={`category-detail-row${inputField ? ' driver-row' : ''}`}><th>{label}</th><td colSpan={columns.length}></td>{months.map((month, index) => inputField
    ? <DriverInput key={month} cellClassName={index === 0 ? 'period-start' : ''} record={getRecord(kind, category, month)} value={values[index]} label={`${category.name}, ${label}, ${month}`} suffix="%" onSave={value => onSave(kind, category, month, inputField, value)} />
    : <td className={index === 0 ? 'period-start' : ''} key={month}>{formatValue(values[index], format)}</td>)}<td className="total-col">{inputField ? formatValue(total, 'percent') : metric === 'daysInMonth' ? formatValue(total, 'days') : '—'}</td></tr>;
}

function ScenarioCabinetTable({ cabinet, categories, kind, months, columns, collapsedCabinets, onToggleCabinet, ...props }: CabinetProps) {
  const scenarioTotal = periodMetrics(months.map(month => props.getMetrics(kind, cabinet.id, null, month)));
  const collapseKey = `${kind}|${cabinet.id}`;
  const collapsed = collapsedCabinets.has(collapseKey);
  return <div className={`cabinet-plan-card scenario-card${collapsed ? ' is-collapsed' : ''}`}><CabinetHeader {...{ cabinet, categories, collapsed }} onToggle={() => onToggleCabinet(collapseKey)} />{!collapsed && <div className="cabinet-plan-scroll"><table className="cabinet-plan-table scenario-plan-table">
    <thead><tr><th rowSpan={2}>Категория</th>{columns.map(column => <th rowSpan={2} key={column.key}>{column.label}</th>)}{months.map(month => <th colSpan={3} className="period-group" key={month}>{MONTH_NAMES[Number(month.slice(5, 7)) - 1]}</th>)}<th colSpan={3} className="total-col">Итого</th></tr><tr>{[...months, 'total'].flatMap(month => [<th key={`${month}-plan`}>План</th>, <th key={`${month}-scenario`}>Сценарий</th>, <th key={`${month}-delta`}>Δ, %</th>])}</tr></thead>
    <tbody><ScenarioTotalRow cabinet={cabinet} kind={kind} months={months} columns={columns} scenarioTotal={scenarioTotal} getMetrics={props.getMetrics} />{categories.map(category => <ScenarioCategoryRows key={category.id} category={category} cabinet={cabinet} kind={kind} months={months} columns={columns} collapsedCabinets={collapsedCabinets} onToggleCabinet={onToggleCabinet} {...props} />)}</tbody>
  </table></div>}</div>;
}

function ScenarioTotalRow({ cabinet, kind, months, columns, scenarioTotal, getMetrics }: { cabinet: Cabinet; kind: AggregatePlanKind; months: string[]; columns: ColumnDefinition[]; scenarioTotal: PeriodMetrics; getMetrics: CommonTableProps['getMetrics'] }) {
  const fixedTotal = periodMetrics(months.map(month => getMetrics('fixed', cabinet.id, null, month)));
  return <tr className="cabinet-total-row"><th>Итого по кабинету</th><SummaryCells metrics={scenarioTotal} columns={columns} />{months.flatMap(month => {
    const plan = getMetrics('fixed', cabinet.id, null, month).ordersSum;
    const scenario = getMetrics(kind, cabinet.id, null, month).ordersSum;
    return [<td key={`${month}-p`}>{formatValue(plan, 'money')}</td>, <td key={`${month}-s`}>{formatValue(scenario, 'money')}</td>, <DeltaCell key={`${month}-d`} value={delta(scenario, plan)} />];
  })}<td>{formatValue(fixedTotal.ordersSum, 'money')}</td><td>{formatValue(scenarioTotal.ordersSum, 'money')}</td><DeltaCell value={delta(scenarioTotal.ordersSum, fixedTotal.ordersSum)} /></tr>;
}

function ScenarioCategoryRows({ category, cabinet, kind, months, columns, expanded, onToggle, getMetrics, getRecord, onSave }: Omit<CabinetProps, 'categories'> & { category: CategoryEntity }) {
  const key = `scenario|${cabinet.id}|${category.id}`;
  const open = expanded.has(key);
  const scenarioMonthly = months.map(month => getMetrics(kind, cabinet.id, category.name, month));
  const fixedMonthly = months.map(month => getMetrics('fixed', cabinet.id, category.name, month));
  const scenarioTotal = periodMetrics(scenarioMonthly);
  const fixedTotal = periodMetrics(fixedMonthly);
  return <><tr className="category-plan-row"><th><button type="button" onClick={() => onToggle(key)} aria-expanded={open}>{open ? '⌄' : '›'}</button>{category.name}</th><SummaryCells metrics={scenarioTotal} columns={columns} />{months.flatMap((month, index) => {
    const record = getRecord(kind, category, month);
    const scenario = record?.orders_sum ?? scenarioMonthly[index].ordersSum;
    const plan = fixedMonthly[index].ordersSum;
    return [<td key={`${month}-p`}>{formatValue(plan, 'money')}</td>, <DriverInput key={`${month}-s`} record={record} value={scenario} label={`${category.name}, сценарий заказов, ${month}`} onSave={value => onSave(kind, category, month, 'orders_sum', value)} />, <DeltaCell key={`${month}-d`} value={delta(scenario, plan)} />];
  })}<td>{formatValue(fixedTotal.ordersSum, 'money')}</td><td>{formatValue(scenarioTotal.ordersSum, 'money')}</td><DeltaCell value={delta(scenarioTotal.ordersSum, fixedTotal.ordersSum)} /></tr>{open && <>
    {SCENARIO_DRIVERS.map(driver => <ScenarioMetricRow key={driver.key} label={driver.label} metric={driver.metric} inputField={driver.key} format={driver.format} {...{ category, kind, months, columns, fixedMonthly, scenarioMonthly, getRecord, onSave }} />)}
    {SCENARIO_RESULTS.map(result => <ScenarioMetricRow key={result.metric} label={result.label} metric={result.metric} format={result.format} {...{ category, kind, months, columns, fixedMonthly, scenarioMonthly, getRecord, onSave }} />)}
  </>}</>;
}

function ScenarioMetricRow({ label, metric, format, inputField, category, kind, months, columns, fixedMonthly, scenarioMonthly, getRecord, onSave }: { label: string; metric: MetricKey; format: ValueFormat; inputField?: EditableAggregatePlanField; category: CategoryEntity; kind: AggregatePlanKind; months: string[]; columns: ColumnDefinition[]; fixedMonthly: AggregatePlanMetrics[]; scenarioMonthly: AggregatePlanMetrics[]; getRecord: CommonTableProps['getRecord']; onSave: CommonTableProps['onSave'] }) {
  const fixedTotal = periodMetrics(fixedMonthly)[metric as keyof PeriodMetrics] as number | null;
  const scenarioTotal = periodMetrics(scenarioMonthly)[metric as keyof PeriodMetrics] as number | null;
  return <tr className="category-detail-row scenario-detail-row"><th>{label}</th><td colSpan={columns.length}></td>{months.flatMap((month, index) => {
    const plan = fixedMonthly[index][metric] as number | null;
    const scenario = scenarioMonthly[index][metric] as number | null;
    return [<td key={`${month}-p`}>{formatValue(plan, format)}</td>, inputField ? <DriverInput key={`${month}-s`} record={getRecord(kind, category, month)} value={scenario} label={`${category.name}, ${label}, ${month}`} suffix={format === 'percent' ? '%' : ''} onSave={value => onSave(kind, category, month, inputField, value)} /> : <td key={`${month}-s`}>{formatValue(scenario, format)}</td>, <DeltaCell key={`${month}-d`} value={delta(scenario, plan)} />];
  })}<td>{formatValue(fixedTotal, format)}</td><td>{formatValue(scenarioTotal, format)}</td><DeltaCell value={delta(scenarioTotal, fixedTotal)} /></tr>;
}

function SummaryCells({ metrics, columns }: { metrics: PeriodMetrics; columns: ColumnDefinition[] }) { return <>{columns.map(column => <td key={column.key}>{formatValue(metrics[column.key], column.format)}</td>)}</>; }
function DriverInput({ record, value, label, suffix, cellClassName = '', onSave }: { record?: AggregateMonthlyPlanRecord; value: number | null; label: string; suffix?: string; cellClassName?: string; onSave: (value: number | null) => void }) {
  const canonical = inputText(value);
  return <DriverInputControl key={`${record?.updated_at || 'empty'}|${canonical}|${label}`} initialValue={canonical} value={value} label={label} suffix={suffix} cellClassName={cellClassName} onSave={onSave} />;
}
function DriverInputControl({ initialValue, value, label, suffix, cellClassName, onSave }: { initialValue: string; value: number | null; label: string; suffix?: string; cellClassName: string; onSave: (value: number | null) => void }) {
  const [draft, setDraft] = useState(initialValue);
  const commit = () => {
    const parsed = parseInput(draft);
    if (parsed === value) return;
    onSave(parsed);
  };
  return <td className={`plan-input-cell${draft.trim() ? ' is-filled' : ''}${cellClassName ? ` ${cellClassName}` : ''}`}><input value={draft} placeholder="—" inputMode="decimal" aria-label={label} onChange={event => setDraft(event.target.value)} onBlur={commit} onKeyDown={event => { if (event.key === 'Enter') event.currentTarget.blur(); }} />{suffix && <span>{suffix}</span>}</td>;
}
function DeltaCell({ value }: { value: number | null }) { return <td className={`scenario-delta ${value === null ? '' : value >= 0 ? 'positive' : 'negative'}`}>{value === null ? '—' : `${value >= 0 ? '+' : ''}${value.toLocaleString('ru-RU', { maximumFractionDigits: 1 })}%`}</td>; }
