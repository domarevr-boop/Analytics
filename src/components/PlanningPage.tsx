import { useMemo, useState, useSyncExternalStore } from 'react';
import {
  clearAggregatePlanKind, getAggregatePlans, getBrands, getCabinets, getPreferAggregatePlan,
  getProducts, getVersion, replaceAggregatePlanKind, setPreferAggregatePlan, subscribe, upsertAggregatePlan,
} from '../data/store';
import { makeAggregatePlanId, type AggregatePlanMetrics, type EditableAggregatePlanField } from '../data/planningCalculations';
import { selectAggregatePlanMetrics } from '../data/planningSelectors';
import type { AggregateMonthlyPlanRecord, AggregatePlanKind } from '../types';

type MetricKey = keyof Pick<AggregatePlanMetrics, 'avgQtyPerDay' | 'ordersSum' | 'ordersQty' | 'avgCheck' | 'buyoutAmount' | 'buyoutRate' | 'payoutAmount' | 'payoutRate' | 'profitability' | 'netProfit' | 'ordersPerDay' | 'netProfitPerDay' | 'daysInMonth'>;
type Format = 'money' | 'number' | 'percent' | 'days';
interface MetricDefinition { key: MetricKey; label: string; input?: EditableAggregatePlanField; format: Format }
interface PlanEntity { id: string; name: string; type: 'total' | 'cabinet' | 'category' | 'brand'; cabinetId: string; depth: number }

const METRICS: MetricDefinition[] = [
  { key: 'avgQtyPerDay', label: 'Среднее заказов, шт/день', input: 'avg_qty_per_day', format: 'number' },
  { key: 'ordersSum', label: 'Сумма заказов', format: 'money' },
  { key: 'ordersQty', label: 'Количество заказов', format: 'number' },
  { key: 'avgCheck', label: 'Средний чек', input: 'avg_check', format: 'money' },
  { key: 'buyoutAmount', label: 'Сумма выкупов', format: 'money' },
  { key: 'buyoutRate', label: 'Процент выкупов', input: 'buyout_rate', format: 'percent' },
  { key: 'payoutAmount', label: 'К перечислению', format: 'money' },
  { key: 'payoutRate', label: '% к перечислению', input: 'payout_rate', format: 'percent' },
  { key: 'profitability', label: 'Рентабельность', input: 'profitability', format: 'percent' },
  { key: 'netProfit', label: 'Чистая прибыль', format: 'money' },
  { key: 'ordersPerDay', label: 'Сумма заказов в день', format: 'money' },
  { key: 'netProfitPerDay', label: 'Чистая прибыль в день', format: 'money' },
  { key: 'daysInMonth', label: 'Дней в месяце', format: 'days' },
];
const MONTH_NAMES = ['Янв', 'Фев', 'Мар', 'Апр', 'Май', 'Июн', 'Июл', 'Авг', 'Сен', 'Окт', 'Ноя', 'Дек'];

function formatValue(value: number | null, format: Format): string {
  if (value === null || !Number.isFinite(value)) return '—';
  if (format === 'percent') return `${value.toLocaleString('ru-RU', { maximumFractionDigits: 1 })}%`;
  if (format === 'days') return value.toLocaleString('ru-RU', { maximumFractionDigits: 0 });
  if (format === 'money') return `${value.toLocaleString('ru-RU', { maximumFractionDigits: 0 })} ₽`;
  return value.toLocaleString('ru-RU', { maximumFractionDigits: 1 });
}
function parseInput(value: string): number | null {
  const normalized = value.trim().replace(/\s/g, '').replace(',', '.');
  if (!normalized) return null;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}
function monthList(year: number) { return MONTH_NAMES.map((_, index) => `${year}-${String(index + 1).padStart(2, '0')}`); }
function deltaPercent(current: number | null, baseline: number | null) {
  return current === null || baseline === null || baseline === 0 ? null : (current / baseline - 1) * 100;
}

export default function PlanningPage() {
  const version = useSyncExternalStore(subscribe, getVersion);
  const [year, setYear] = useState(() => new Date().getFullYear());
  const [focusMonth, setFocusMonth] = useState(() => new Date().getMonth());
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(['total']));
  const records = useMemo(() => getAggregatePlans(), [version]);
  const cabinets = useMemo(() => getCabinets(), [version]);
  const products = useMemo(() => getProducts().filter(product => product.status !== 'archived'), [version]);
  const brands = useMemo(() => getBrands(), [version]);
  const preferAggregate = useMemo(() => getPreferAggregatePlan(), [version]);
  const months = useMemo(() => monthList(year), [year]);
  const recordMap = useMemo(() => new Map(records.map(record => [record.id, record])), [records]);

  const categoriesByCabinet = useMemo(() => {
    const result = new Map<string, string[]>();
    cabinets.forEach(cabinet => result.set(cabinet.id, [...new Set(products.filter(product => product.cabinet_id === cabinet.id).map(product => product.category || 'Без категории'))].sort((a, b) => a.localeCompare(b, 'ru'))));
    return result;
  }, [cabinets, products]);
  const hierarchy = useMemo<PlanEntity[]>(() => {
    const result: PlanEntity[] = [{ id: 'total', name: 'Совокупный план ВБ', type: 'total', cabinetId: '', depth: 0 }];
    if (!expanded.has('total')) return result;
    cabinets.forEach(cabinet => {
      result.push({ id: cabinet.id, name: cabinet.name, type: 'cabinet', cabinetId: cabinet.id, depth: 1 });
      if (expanded.has(cabinet.id)) (categoriesByCabinet.get(cabinet.id) || []).forEach(category => result.push({ id: category, name: category, type: 'category', cabinetId: cabinet.id, depth: 2 }));
    });
    return result;
  }, [cabinets, categoriesByCabinet, expanded]);
  const usedBrandIds = useMemo(() => new Set(products.map(product => product.brand_id).filter(Boolean)), [products]);
  const brandEntities = useMemo<PlanEntity[]>(() => brands.filter(brand => usedBrandIds.has(brand.id)).sort((a, b) => a.name.localeCompare(b.name, 'ru')).map(brand => ({ id: brand.id, name: brand.name, type: 'brand', cabinetId: '', depth: 0 })), [brands, usedBrandIds]);

  const getMetrics = (kind: AggregatePlanKind, entity: PlanEntity, month: string) => {
    if (entity.type === 'brand') return selectAggregatePlanMetrics(records, month, { brandId: entity.id }, kind);
    if (entity.type === 'category') return selectAggregatePlanMetrics(records, month, { cabinetId: entity.cabinetId, category: entity.name }, kind);
    if (entity.type === 'cabinet') return selectAggregatePlanMetrics(records, month, { cabinetId: entity.id }, kind);
    return selectAggregatePlanMetrics(records, month, {}, kind);
  };
  const getLeafRecord = (kind: AggregatePlanKind, entity: PlanEntity, month: string) => recordMap.get(makeAggregatePlanId(kind, month, entity.type === 'brand' ? 'brand' : 'category', entity.cabinetId, entity.id));
  const saveLeaf = (kind: AggregatePlanKind, entity: PlanEntity, month: string, field: EditableAggregatePlanField, value: number | null) => {
    const scope = entity.type === 'brand' ? 'brand' : 'category';
    const id = makeAggregatePlanId(kind, month, scope, entity.cabinetId, entity.id);
    upsertAggregatePlan({ id, kind, month, scope, cabinet_id: entity.cabinetId, entity_id: entity.id, entity_name: entity.name, avg_qty_per_day: null, avg_check: null, buyout_rate: null, payout_rate: null, profitability: null, ...recordMap.get(id), [field]: value, updated_at: new Date().toISOString() });
  };
  const toggle = (id: string) => setExpanded(current => { const next = new Set(current); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  const copyFixedToScenario = async () => {
    const prefix = `${year}-`;
    const retained = records.filter(record => record.kind === 'scenario' && !record.month.startsWith(prefix));
    const copied = records.filter(record => record.kind === 'fixed' && record.month.startsWith(prefix)).map(record => ({ ...record, id: makeAggregatePlanId('scenario', record.month, record.scope, record.cabinet_id, record.entity_id), kind: 'scenario' as const, updated_at: new Date().toISOString() }));
    await replaceAggregatePlanKind('scenario', [...retained, ...copied]);
  };
  const resetScenario = async () => {
    const retained = records.filter(record => record.kind === 'scenario' && !record.month.startsWith(`${year}-`));
    if (retained.length === 0) clearAggregatePlanKind('scenario'); else await replaceAggregatePlanKind('scenario', retained);
  };
  const fixedTotal = getMetrics('fixed', hierarchy[0], months[focusMonth]);

  return <div className="planning-page analytics-page-shell aggregate-plan-page">
    <header className="analytics-page-header aggregate-plan-header">
      <div><span>БИЗНЕС-МЕТРИКИ</span><h1>Планирование</h1><p>Совокупный план по кабинетам и категориям. Бренды показаны отдельно и не входят повторно в итог.</p></div>
      <div className="aggregate-plan-controls">
        <label>Год<input type="number" value={year} min="2020" max="2100" onChange={event => setYear(Number(event.target.value) || year)} /></label>
        <label>Месяц итогов<select value={focusMonth} onChange={event => setFocusMonth(Number(event.target.value))}>{MONTH_NAMES.map((name, index) => <option value={index} key={name}>{name}</option>)}</select></label>
        <label className="aggregate-plan-priority"><input type="checkbox" checked={preferAggregate} onChange={event => setPreferAggregatePlan(event.target.checked)} /><span><strong>Совокупный план — источник истины</strong><small>Действует сразу для всех месяцев и главной страницы.</small></span></label>
      </div>
    </header>
    <div className="aggregate-plan-kpis">
      <Summary label="Сумма заказов" value={formatValue(fixedTotal.ordersSum, 'money')} /><Summary label="Сумма выкупов" value={formatValue(fixedTotal.buyoutAmount, 'money')} /><Summary label="К перечислению" value={formatValue(fixedTotal.payoutAmount, 'money')} /><Summary label="Чистая прибыль" value={formatValue(fixedTotal.netProfit, 'money')} /><Summary label="Рентабельность" value={formatValue(fixedTotal.profitability, 'percent')} />
    </div>
    <PlanSection title="1. Утверждённый совокупный план" description="Ввод выполняется на уровне категории. Кабинеты и общий итог рассчитываются автоматически." kind="fixed" months={months} hierarchy={hierarchy} brands={brandEntities} expanded={expanded} onToggle={toggle} getMetrics={getMetrics} getLeafRecord={getLeafRecord} onSave={saveLeaf} />
    <PlanSection title="2. Сценарная модель" description="Независимый расчёт для моделирования. Он сравнивается с утверждённым планом и не влияет на главную страницу." kind="scenario" months={months} hierarchy={hierarchy} brands={brandEntities} expanded={expanded} onToggle={toggle} getMetrics={getMetrics} getLeafRecord={getLeafRecord} onSave={saveLeaf} compare={(entity, month, metric) => getMetrics('fixed', entity, month)[metric] as number | null} actions={<><button type="button" onClick={() => void copyFixedToScenario()}>Скопировать из плана</button><button type="button" className="secondary" onClick={() => void resetScenario()}>Сбросить сценарий за {year}</button></>} />
  </div>;
}

function Summary({ label, value }: { label: string; value: string }) { return <div className="aggregate-plan-kpi"><span>{label}</span><strong>{value}</strong></div>; }

interface PlanSectionProps {
  title: string; description: string; kind: AggregatePlanKind; months: string[]; hierarchy: PlanEntity[]; brands: PlanEntity[]; expanded: Set<string>;
  onToggle: (id: string) => void;
  getMetrics: (kind: AggregatePlanKind, entity: PlanEntity, month: string) => AggregatePlanMetrics;
  getLeafRecord: (kind: AggregatePlanKind, entity: PlanEntity, month: string) => AggregateMonthlyPlanRecord | undefined;
  onSave: (kind: AggregatePlanKind, entity: PlanEntity, month: string, field: EditableAggregatePlanField, value: number | null) => void;
  compare?: (entity: PlanEntity, month: string, metric: MetricKey) => number | null; actions?: React.ReactNode;
}
function PlanSection({ title, description, hierarchy, brands, actions, ...matrixProps }: PlanSectionProps) {
  return <section className="aggregate-plan-section analytics-sheet">
    <div className="aggregate-plan-section-head"><div><h2>{title}</h2><p>{description}</p></div>{actions && <div className="aggregate-plan-actions">{actions}</div>}</div>
    <PlanMatrix entities={hierarchy} label="План ВБ → кабинеты → категории" {...matrixProps} />
    <PlanMatrix entities={brands} label="Бренды — отдельное наблюдение" brandsOnly {...matrixProps} />
  </section>;
}

type MatrixProps = Omit<PlanSectionProps, 'title' | 'description' | 'hierarchy' | 'brands' | 'actions'> & { entities: PlanEntity[]; label: string; brandsOnly?: boolean };
function PlanMatrix({ entities, label, brandsOnly = false, ...rowProps }: MatrixProps) {
  return <div className="aggregate-plan-matrix-block"><h3>{label}</h3><div className="aggregate-plan-matrix-scroll"><table className="aggregate-plan-matrix">
    <thead><tr><th className="entity">Уровень / показатель</th>{rowProps.months.map((month, index) => <th key={month}>{MONTH_NAMES[index]}</th>)}</tr></thead>
    <tbody>{entities.map(entity => <EntityRows key={`${entity.type}|${entity.cabinetId}|${entity.id}`} entity={entity} brandsOnly={brandsOnly} {...rowProps} />)}{entities.length === 0 && <tr><td className="aggregate-plan-empty" colSpan={13}>Нет сущностей для планирования.</td></tr>}</tbody>
  </table></div></div>;
}

function EntityRows({ entity, brandsOnly, kind, months, expanded, onToggle, getMetrics, getLeafRecord, onSave, compare }: Omit<MatrixProps, 'entities' | 'label'> & { entity: PlanEntity }) {
  const expandable = !brandsOnly && (entity.type === 'total' || entity.type === 'cabinet');
  const editable = entity.type === 'category' || entity.type === 'brand';
  const open = expanded.has(entity.id);
  return <>
    <tr className={`aggregate-plan-entity aggregate-plan-${entity.type}`}><th style={{ paddingLeft: 12 + entity.depth * 18 }}>{expandable && <button type="button" onClick={() => onToggle(entity.id)}>{open ? '−' : '+'}</button>}<span>{entity.name}</span>{editable && <small>ввод</small>}</th>{months.map(month => <td key={month}><strong>{formatValue(getMetrics(kind, entity, month).ordersSum, 'money')}</strong></td>)}</tr>
    {METRICS.map(metric => <tr className="aggregate-plan-metric" key={`${entity.type}|${entity.cabinetId}|${entity.id}|${metric.key}`}><th style={{ paddingLeft: 34 + entity.depth * 18 }}>{metric.label}{editable && metric.input && <small>редактируется</small>}</th>{months.map(month => {
      const value = getMetrics(kind, entity, month)[metric.key] as number | null;
      const isInput = editable && metric.input;
      const record = isInput ? getLeafRecord(kind, entity, month) : undefined;
      const raw = isInput && record ? record[metric.input!] : null;
      const delta = compare ? deltaPercent(value, compare(entity, month, metric.key)) : null;
      return <td key={month} className={isInput ? 'editable' : ''}>{isInput ? <input key={`${record?.updated_at || 'empty'}|${metric.input}`} defaultValue={raw === null ? '' : String(raw).replace('.', ',')} inputMode="decimal" aria-label={`${entity.name}, ${metric.label}, ${month}`} onBlur={event => onSave(kind, entity, month, metric.input!, parseInput(event.target.value))} /> : <span>{formatValue(value, metric.format)}</span>}{delta !== null && <small className={delta >= 0 ? 'positive' : 'negative'}>{delta >= 0 ? '+' : ''}{delta.toLocaleString('ru-RU', { maximumFractionDigits: 1 })}% к плану</small>}</td>;
    })}</tr>)}
  </>;
}
