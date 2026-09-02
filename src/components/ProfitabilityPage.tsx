import { useMemo, useState, useSyncExternalStore } from 'react';
import { Bar, BarChart, CartesianGrid, Cell, ComposedChart, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { subscribe, getVersion, getCabinets, getGroups, getProducts, getMemberships, getGroupMembershipHistory, getMetrics, getProfitabilityRecords } from '../data/store';
import { subscribeExtraExpenses, getExtraExpensesVersion, getExtraExpenses, getCabinetExtraExpense, setExtraExpense } from '../data/profitStore';
import FilterBar from './FilterBar';
import type { FilterBarProps } from './FilterBar';
import { getFilteredProductIds } from '../data/productFilters';
import { getReportGrossProfit } from '../data/profitabilityCalculations';
import DateRangeFilter from './DateRangeFilter';
import type { DatePeriod } from '../data/mock';
import { resolveGroupAtDate } from '../data/groupMembershipHistory';
import { classifyProfitabilityRows, flattenExpandedHierarchy } from '../data/profitabilityTableCalculations';
import type { BusinessRole } from '../data/profitabilityTableCalculations';

const pad = (value: number) => String(value).padStart(2, '0');
const monthOf = (date: string) => date.slice(0, 7);
const monthStart = (month: string) => `${month}-01`;
const monthEnd = (month: string) => { const [year, number] = month.split('-').map(Number); return `${year}-${pad(number)}-${pad(new Date(year, number, 0).getDate())}`; };
const fmt = (value: number) => Math.round(value).toLocaleString('ru-RU');
const fmt1 = (value: number) => value.toLocaleString('ru-RU', { maximumFractionDigits: 1 });
const monthLabel = (month: string) => new Intl.DateTimeFormat('ru-RU', { month: 'long' }).format(new Date(`${month}-01T00:00:00`));
const monthTitle = (month: string) => new Intl.DateTimeFormat('ru-RU', { month: 'long', year: 'numeric' }).format(new Date(`${month}-01T00:00:00`));

type Granularity = 'day' | 'week' | 'month';
type StatusFilter = 'all' | 'profitable' | 'loss' | 'no-sales';
type NodeType = 'cabinet' | 'category' | 'group' | 'product';
type SortKey = 'revenue' | 'costs' | 'grossProfit' | 'margin' | 'expensePct' | 'expenseAmount' | 'adSpend' | 'netProfit' | 'profitability';
type SortDirection = 'asc' | 'desc';
type FinanceValue = { revenue: number; grossProfit: number; expenseAmount: number; adSpend: number; netProfit: number };
type ProfitNode = FinanceValue & { id: string; type: NodeType; name: string; sku?: string; parent: string | null; depth: number; cabinetId: string };

const emptyFinance = (): FinanceValue => ({ revenue: 0, grossProfit: 0, expenseAmount: 0, adSpend: 0, netProfit: 0 });
const addFinance = (target: FinanceValue, source: FinanceValue) => { target.revenue += source.revenue; target.grossProfit += source.grossProfit; target.expenseAmount += source.expenseAmount; target.adSpend += source.adSpend; target.netProfit += source.netProfit; };
const profitabilityOf = (value: FinanceValue) => value.revenue ? value.netProfit / value.revenue * 100 : 0;
const marginOf = (value: FinanceValue) => value.revenue ? value.grossProfit / value.revenue * 100 : 0;
const previousPeriod = (period: DatePeriod): DatePeriod => {
  const start = new Date(`${period.start}T00:00:00`);
  const end = new Date(`${period.end}T00:00:00`);
  const days = Math.max(1, Math.round((end.getTime() - start.getTime()) / 86400000) + 1);
  const previousEnd = new Date(start); previousEnd.setDate(previousEnd.getDate() - 1);
  const previousStart = new Date(previousEnd); previousStart.setDate(previousStart.getDate() - days + 1);
  const iso = (date: Date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  return { start: iso(previousStart), end: iso(previousEnd) };
};
const deltaPct = (current: number, previous: number) => previous ? (current - previous) / Math.abs(previous) * 100 : current ? 100 : 0;
const bucketDate = (date: string, granularity: Granularity) => {
  if (granularity === 'day') return date;
  if (granularity === 'month') return date.slice(0, 7);
  const value = new Date(`${date}T00:00:00`); const day = value.getDay() || 7; value.setDate(value.getDate() - day + 1);
  return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`;
};
const roleLabel: Record<BusinessRole, string> = { tractor: 'Тягач', 'profit-generator': 'Генератор ЧП', 'non-liquid': 'Нелик' };

function SortHeader({ label, value, sortKey, direction, onSort }: { label: string; value: SortKey; sortKey: SortKey; direction: SortDirection; onSort: (key: SortKey) => void }) {
  const active = sortKey === value;
  return <th><button type="button" className={`profit-sort${active ? ' active' : ''}`} onClick={() => onSort(value)} aria-label={`${label}: сортировать ${active && direction === 'desc' ? 'по возрастанию' : 'по убыванию'}`}><span>{label}</span><b aria-hidden="true">{active ? (direction === 'desc' ? '↓' : '↑') : '↕'}</b></button></th>;
}

export default function ProfitabilityPage(filterProps: FilterBarProps) {
  const version = useSyncExternalStore(subscribe, getVersion);
  const expenseVersion = useSyncExternalStore(subscribeExtraExpenses, getExtraExpensesVersion);
  const products = getProducts();
  const memberships = getMemberships();
  const groupHistory = getGroupMembershipHistory();
  const groups = getGroups();
  const cabinets = getCabinets();
  const records = getProfitabilityRecords();
  const metrics = getMetrics();
  const availableMonths = useMemo(() => [...new Set(records.map(row => monthOf(row.period_start)))].sort(), [records]);
  const latestMonth = availableMonths.at(-1) || `${new Date().getFullYear()}-${pad(new Date().getMonth() + 1)}`;
  const [period, setPeriod] = useState<DatePeriod>(() => ({ start: monthStart(latestMonth), end: monthEnd(latestMonth) }));
  const [expenseMonth, setExpenseMonth] = useState(latestMonth);
  const activeMonth = period.start === monthStart(monthOf(period.start)) && period.end === monthEnd(monthOf(period.start))
    ? monthOf(period.start)
    : expenseMonth;
  const [granularity, setGranularity] = useState<Granularity>('day');
  const [status, setStatus] = useState<StatusFilter>('all');
  const [sortKey, setSortKey] = useState<SortKey>('revenue');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const comparison = useMemo(() => previousPeriod(period), [period]);
  const productMap = useMemo(() => new Map(products.map(product => [product.id, product])), [products]);
  const allowedIds = useMemo(() => getFilteredProductIds(products, memberships, filterProps, { groupHistory, period: { start: comparison.start, end: period.end } }), [products, memberships, groupHistory, filterProps, comparison, period]);
  const matchesSelectedGroup = (productId: string, date: string) => !filterProps.groupFilter || (() => { const resolution = resolveGroupAtDate(productId, date, groupHistory, memberships); return resolution.known && resolution.groupId === filterProps.groupFilter; })();
  const selectMonth = (month: string) => {
    setPeriod({ start: monthStart(month), end: monthEnd(month) });
    setExpenseMonth(month);
  };
  const activeMonthIndex = availableMonths.indexOf(activeMonth);

  const aggregateRange = (range: DatePeriod) => {
    const byProduct = new Map<string, FinanceValue>();
    const reportProductDates = new Set<string>();
    records.forEach(record => {
      if (!allowedIds.has(record.product_id) || record.period_end < range.start || record.period_start > range.end || !matchesSelectedGroup(record.product_id, record.period_start)) return;
      const product = productMap.get(record.product_id); if (!product) return;
      const revenue = record.profit_revenue;
      const grossProfit = getReportGrossProfit(record);
      const expenseAmount = revenue * getCabinetExtraExpense(monthOf(record.period_start), product.cabinet_id) / 100;
      const current = byProduct.get(record.product_id) || emptyFinance();
      addFinance(current, { revenue, grossProfit, expenseAmount, adSpend: 0, netProfit: grossProfit - expenseAmount });
      byProduct.set(record.product_id, current);
      reportProductDates.add(`${record.product_id}|${record.period_start}`);
    });
    metrics.forEach(row => {
      if (!allowedIds.has(row.product_id) || row.date < range.start || row.date > range.end || !matchesSelectedGroup(row.product_id, row.date)) return;
      const product = productMap.get(row.product_id); if (!product) return;
      const current = byProduct.get(row.product_id) || emptyFinance();
      current.adSpend += row.marketing_cost || row.ad_spend || 0;
      if (!reportProductDates.has(`${row.product_id}|${row.date}`) && row.profit_revenue) {
        const revenue = row.profit_revenue;
        const grossProfit = revenue - row.cost - row.agent_fee - row.logistics_cost - row.marketing_cost - row.storage_cost;
        const expenseAmount = revenue * getCabinetExtraExpense(monthOf(row.date), product.cabinet_id) / 100;
        addFinance(current, { revenue, grossProfit, expenseAmount, adSpend: 0, netProfit: grossProfit - expenseAmount });
      }
      byProduct.set(row.product_id, current);
    });
    return byProduct;
  };

  const currentByProduct = useMemo(() => aggregateRange(period), [version, expenseVersion, period, allowedIds]);
  const previousByProduct = useMemo(() => aggregateRange(comparison), [version, expenseVersion, comparison, allowedIds]);
  const total = useMemo(() => { const value = emptyFinance(); currentByProduct.forEach(row => addFinance(value, row)); return value; }, [currentByProduct]);
  const previousTotal = useMemo(() => { const value = emptyFinance(); previousByProduct.forEach(row => addFinance(value, row)); return value; }, [previousByProduct]);

  const dailyData = useMemo(() => {
    const byDate = new Map<string, FinanceValue>();
    records.forEach(record => {
      if (!allowedIds.has(record.product_id) || record.period_start < period.start || record.period_start > period.end || !matchesSelectedGroup(record.product_id, record.period_start)) return;
      const product = productMap.get(record.product_id); if (!product) return;
      const key = bucketDate(record.period_start, granularity);
      const revenue = record.profit_revenue; const grossProfit = getReportGrossProfit(record);
      const expenseAmount = revenue * getCabinetExtraExpense(monthOf(record.period_start), product.cabinet_id) / 100;
      const current = byDate.get(key) || emptyFinance(); addFinance(current, { revenue, grossProfit, expenseAmount, adSpend: 0, netProfit: grossProfit - expenseAmount }); byDate.set(key, current);
    });
    return [...byDate.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([date, value]) => ({ date, ...value, margin: marginOf(value), profitability: profitabilityOf(value) }));
  }, [records, allowedIds, productMap, period, granularity, expenseVersion]);

  const tree = useMemo(() => {
    const nodes: ProfitNode[] = [];
    const groupByProduct = new Map<string, string>();
    products.forEach(product => {
      if (filterProps.groupFilter) groupByProduct.set(product.id, filterProps.groupFilter);
      else {
        const resolution = resolveGroupAtDate(product.id, period.end, groupHistory, memberships);
        groupByProduct.set(product.id, resolution.known && resolution.groupId ? resolution.groupId : 'ungrouped');
      }
    });
    const addNode = (id: string, type: NodeType, name: string, parent: string | null, depth: number, cabinetId: string, productIds: string[], sku?: string) => {
      const value = emptyFinance(); productIds.forEach(productId => addFinance(value, currentByProduct.get(productId) || emptyFinance()));
      nodes.push({ id, type, name, parent, depth, cabinetId, sku, ...value });
    };
    cabinets.forEach(cabinet => {
      const cabinetProducts = products.filter(product => product.cabinet_id === cabinet.id && allowedIds.has(product.id));
      const cabinetNodeId = `cabinet:${cabinet.id}`; addNode(cabinetNodeId, 'cabinet', cabinet.name, null, 0, cabinet.id, cabinetProducts.map(item => item.id));
      [...new Set(cabinetProducts.map(product => product.category || 'Без категории'))].sort().forEach(category => {
        const categoryProducts = cabinetProducts.filter(product => (product.category || 'Без категории') === category);
        const categoryId = `${cabinetNodeId}|category:${category}`; addNode(categoryId, 'category', category, cabinetNodeId, 1, cabinet.id, categoryProducts.map(item => item.id));
        const groupKeys = [...new Set(categoryProducts.map(product => groupByProduct.get(product.id) || 'ungrouped'))];
        groupKeys.forEach(groupId => {
          const groupProducts = categoryProducts.filter(product => (groupByProduct.get(product.id) || 'ungrouped') === groupId);
          const groupName = groups.find(group => group.id === groupId)?.name || 'Без склейки';
          const nodeId = `${categoryId}|group:${groupId}`; addNode(nodeId, 'group', groupName, categoryId, 2, cabinet.id, groupProducts.map(item => item.id));
          groupProducts.sort((left, right) => (currentByProduct.get(right.id)?.revenue || 0) - (currentByProduct.get(left.id)?.revenue || 0)).forEach(product => addNode(`product:${product.id}`, 'product', product.name, nodeId, 3, cabinet.id, [product.id], product.sku));
        });
      });
    });
    return nodes;
  }, [products, cabinets, groups, memberships, groupHistory, filterProps.groupFilter, period.end, allowedIds, currentByProduct]);

  const classifications = useMemo(() => classifyProfitabilityRows(tree.filter(node => node.type === 'product').map(node => ({ id: node.id, groupId: node.parent || 'ungrouped', revenue: node.revenue, netProfit: node.netProfit, adSpend: node.adSpend }))), [tree]);
  const statusMatches = (node: ProfitNode) => status === 'all' || (status === 'profitable' && node.netProfit > 0) || (status === 'loss' && node.netProfit < 0) || (status === 'no-sales' && node.revenue === 0);
  const statusCounts = useMemo(() => { const productNodes = tree.filter(node => node.type === 'product'); return { all: productNodes.length, profitable: productNodes.filter(node => node.netProfit > 0).length, loss: productNodes.filter(node => node.netProfit < 0).length, noSales: productNodes.filter(node => node.revenue === 0).length }; }, [tree]);
  const sortValue = (node: ProfitNode) => {
    if (sortKey === 'costs') return Math.max(0, node.revenue - node.grossProfit);
    if (sortKey === 'margin') return marginOf(node);
    if (sortKey === 'expensePct') return node.revenue ? node.expenseAmount / node.revenue * 100 : 0;
    if (sortKey === 'profitability') return profitabilityOf(node);
    return node[sortKey];
  };
  const compareNodes = (left: ProfitNode, right: ProfitNode) => (sortValue(left) - sortValue(right)) * (sortDirection === 'asc' ? 1 : -1) || left.name.localeCompare(right.name, 'ru');
  const visible = status !== 'all'
    ? tree.filter(node => node.type === 'product' && statusMatches(node)).sort(compareNodes)
    : flattenExpandedHierarchy(tree, expanded, compareNodes);
  const toggle = (id: string) => setExpanded(current => { const next = new Set(current); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  const changeSort = (key: SortKey) => { if (key === sortKey) setSortDirection(current => current === 'desc' ? 'asc' : 'desc'); else { setSortKey(key); setSortDirection('desc'); } };

  const kpis = [
    { label: 'Выручка', value: `${fmt(total.revenue)} ₽`, delta: deltaPct(total.revenue, previousTotal.revenue) },
    { label: 'Себестоимость и расходы', value: `${fmt(total.revenue - total.grossProfit)} ₽`, delta: deltaPct(total.revenue - total.grossProfit, previousTotal.revenue - previousTotal.grossProfit) },
    { label: 'Валовая прибыль', value: `${fmt(total.grossProfit)} ₽`, delta: deltaPct(total.grossProfit, previousTotal.grossProfit) },
    { label: 'Маржинальность', value: `${fmt1(marginOf(total))}%`, delta: marginOf(total) - marginOf(previousTotal), points: true },
    { label: 'Постоянные расходы', value: `${fmt(total.expenseAmount)} ₽`, sub: `${fmt1(total.revenue ? total.expenseAmount / total.revenue * 100 : 0)}% от выручки`, delta: deltaPct(total.expenseAmount, previousTotal.expenseAmount), inverse: true },
    { label: 'Чистая прибыль', value: `${fmt(total.netProfit)} ₽`, delta: deltaPct(total.netProfit, previousTotal.netProfit) },
    { label: 'Рентабельность', value: `${fmt1(profitabilityOf(total))}%`, delta: profitabilityOf(total) - profitabilityOf(previousTotal), points: true },
  ];
  const waterfall = [
    { name: 'Выручка', base: 0, value: total.revenue, label: total.revenue, color: '#4F8EF7' },
    { name: 'Расходы', base: total.grossProfit, value: Math.max(0, total.revenue - total.grossProfit), label: -(total.revenue - total.grossProfit), color: '#AAB4C2' },
    { name: 'Валовая прибыль', base: 0, value: Math.max(0, total.grossProfit), label: total.grossProfit, color: '#25A86B' },
    { name: 'Пост. расходы', base: total.netProfit, value: Math.max(0, total.expenseAmount), label: -total.expenseAmount, color: '#F08A36' },
    { name: 'Чистая прибыль', base: Math.min(0, total.netProfit), value: Math.abs(total.netProfit), label: total.netProfit, color: total.netProfit >= 0 ? '#54B983' : '#E45B65' },
  ];

  return <div className="profit-page profit-page-v2 analytics-page-shell">
    <header className="analytics-page-header profit-header"><div><span>БИЗНЕС-МЕТРИКИ</span><h1>Рентабельность</h1><p>Финансовый результат по периодам, кабинетам, категориям, склейкам и товарам.</p></div><aside className="profit-settings"><div><strong>Параметры расчёта</strong><small>{monthLabel(expenseMonth)} {expenseMonth.slice(0, 4)}</small></div><div className="profit-setting-values">{cabinets.map(cabinet => <label key={cabinet.id}><span>{cabinet.name}</span><b><input type="number" min="0" max="100" step="0.1" value={getExtraExpenses(expenseMonth)[cabinet.id] || 0} onChange={event => setExtraExpense(expenseMonth, cabinet.id, Number(event.target.value) || 0)} />%</b></label>)}</div></aside></header>

    <div className="profit-month-navigation" aria-label="Выбор месяца">
      <button type="button" className="profit-month-arrow" aria-label="Предыдущий месяц" disabled={activeMonthIndex <= 0} onClick={() => selectMonth(availableMonths[activeMonthIndex - 1])}>‹</button>
      <div className="profit-month-strip">{availableMonths.map(month => <button type="button" key={month} className={activeMonth === month ? 'active' : ''} aria-pressed={activeMonth === month} onClick={() => selectMonth(month)}>{monthLabel(month)}</button>)}</div>
      <button type="button" className="profit-month-arrow" aria-label="Следующий месяц" disabled={activeMonthIndex < 0 || activeMonthIndex >= availableMonths.length - 1} onClick={() => selectMonth(availableMonths[activeMonthIndex + 1])}>›</button>
      <strong className="profit-active-month">{monthTitle(activeMonth)}</strong>
    </div>
    <div className="table-toolbar workspace-toolbar profit-toolbar analytics-toolbar"><div className="date-filters"><DateRangeFilter label="Период" value={period} onChange={next => { setPeriod(next); setExpenseMonth(monthOf(next.end)); }} maxDate={records.map(row => row.period_end).sort().at(-1) || period.end} /></div><FilterBar {...filterProps} period={period} variant="dashboard" /></div>

    <section className="profit-kpis">{kpis.map(kpi => <article key={kpi.label}><span>{kpi.label}</span><strong>{kpi.value}</strong><small className={(kpi.inverse ? kpi.delta <= 0 : kpi.delta >= 0) ? 'positive' : 'negative'}>{kpi.delta >= 0 ? '▲' : '▼'} {fmt1(Math.abs(kpi.delta))}{kpi.points ? ' п.п.' : '%'} к прошлому периоду</small>{kpi.sub && <em>{kpi.sub}</em>}</article>)}</section>

    <section className="profit-chart-grid"><article className="profit-panel"><header><div><span>ДИНАМИКА</span><h2>Рентабельность и чистая прибыль</h2></div><div className="entry-segmented"><button className={granularity === 'day' ? 'active' : ''} onClick={() => setGranularity('day')}>День</button><button className={granularity === 'week' ? 'active' : ''} onClick={() => setGranularity('week')}>Неделя</button><button className={granularity === 'month' ? 'active' : ''} onClick={() => setGranularity('month')}>Месяц</button></div></header><ResponsiveContainer width="100%" height={270}><ComposedChart data={dailyData} margin={{ top: 14, right: 22, left: 4, bottom: 4 }}><CartesianGrid stroke="#E8EDF3" strokeDasharray="3 3" /><XAxis dataKey="date" tick={{ fontSize: 9 }} /><YAxis yAxisId="money" tickFormatter={value => `${Math.round(Number(value) / 1000)}к`} tick={{ fontSize: 9 }} /><YAxis yAxisId="rate" orientation="right" tickFormatter={value => `${fmt1(Number(value))}%`} tick={{ fontSize: 9 }} /><Tooltip formatter={(value, name) => [name === 'Чистая прибыль' ? `${fmt(Number(value || 0))} ₽` : `${fmt1(Number(value || 0))}%`, name]} /><Bar yAxisId="money" dataKey="netProfit" name="Чистая прибыль" fill="#78A9F7" radius={[3, 3, 0, 0]} maxBarSize={22} /><Line yAxisId="rate" dataKey="profitability" name="Рентабельность" stroke="#10A778" strokeWidth={2.2} dot={false} /><Line yAxisId="rate" dataKey="margin" name="Маржинальность" stroke="#8B5CF6" strokeWidth={1.8} dot={false} /></ComposedChart></ResponsiveContainer></article>
      <article className="profit-panel"><header><div><span>СТРУКТУРА</span><h2>Формирование чистой прибыли</h2></div><small>{monthLabel(monthOf(period.end))}</small></header><ResponsiveContainer width="100%" height={270}><BarChart data={waterfall} margin={{ top: 22, right: 12, left: 8, bottom: 4 }}><CartesianGrid stroke="#E8EDF3" strokeDasharray="3 3" vertical={false} /><XAxis dataKey="name" tick={{ fontSize: 9 }} /><YAxis tickFormatter={value => `${Math.round(Number(value) / 1_000_000)}м`} tick={{ fontSize: 9 }} /><Tooltip formatter={(value, name, item) => name === 'Значение' ? [`${fmt(Number(item.payload.label))} ₽`, 'Изменение'] : [value, name]} /><ReferenceLine y={0} stroke="#8391A3" /><Bar dataKey="base" stackId="waterfall" fill="transparent" /><Bar dataKey="value" name="Значение" stackId="waterfall" radius={[3, 3, 0, 0]}>{waterfall.map(item => <Cell key={item.name} fill={item.color} />)}</Bar></BarChart></ResponsiveContainer></article></section>

    <div className="profit-status-tabs"><button className={status === 'all' ? 'active' : ''} onClick={() => setStatus('all')}>Все <b>{statusCounts.all}</b></button><button className={status === 'profitable' ? 'active' : ''} onClick={() => setStatus('profitable')}>Прибыльные <b>{statusCounts.profitable}</b></button><button className={status === 'loss' ? 'active' : ''} onClick={() => setStatus('loss')}>Убыточные <b>{statusCounts.loss}</b></button><button className={status === 'no-sales' ? 'active' : ''} onClick={() => setStatus('no-sales')}>Без продаж <b>{statusCounts.noSales}</b></button></div>

    <div className="profit-table-wrap"><table className="profit-table profit-table-v2"><thead><tr><th className="pt-toggle-col"></th><th className="pt-name-col">Артикул / Название</th><SortHeader label="Выручка" value="revenue" {...{ sortKey, direction: sortDirection, onSort: changeSort }} /><SortHeader label="Себестоимость и расходы" value="costs" {...{ sortKey, direction: sortDirection, onSort: changeSort }} /><SortHeader label="Валовая прибыль" value="grossProfit" {...{ sortKey, direction: sortDirection, onSort: changeSort }} /><SortHeader label="Маржа" value="margin" {...{ sortKey, direction: sortDirection, onSort: changeSort }} /><SortHeader label="Пост. расходы, %" value="expensePct" {...{ sortKey, direction: sortDirection, onSort: changeSort }} /><SortHeader label="Пост. расходы, ₽" value="expenseAmount" {...{ sortKey, direction: sortDirection, onSort: changeSort }} /><SortHeader label="Рекламные расходы" value="adSpend" {...{ sortKey, direction: sortDirection, onSort: changeSort }} /><SortHeader label="Чистая прибыль" value="netProfit" {...{ sortKey, direction: sortDirection, onSort: changeSort }} /><SortHeader label="Рентабельность" value="profitability" {...{ sortKey, direction: sortDirection, onSort: changeSort }} /><th>ABC (В/ЧП)</th><th>Бизнес-роль</th></tr></thead><tbody>{visible.map(node => { const hasChildren = tree.some(child => child.parent === node.id); const margin = marginOf(node); const profitability = profitabilityOf(node); const expensePct = node.revenue ? node.expenseAmount / node.revenue * 100 : 0; const classification = classifications.get(node.id); return <tr key={node.id} className={`profit-row profit-${node.type}`}><td className="pt-td pt-toggle">{hasChildren && status === 'all' && <button className="profit-expand" onClick={() => toggle(node.id)}>{expanded.has(node.id) ? '−' : '+'}</button>}</td><td className="pt-td pt-name" style={{ paddingLeft: 12 + node.depth * 18 }}>{node.type === 'product' ? <><span className="profit-sku">{node.sku}</span><small>{node.name}</small></> : <strong>{node.name}</strong>}</td><td className="pt-td pt-num">{fmt(node.revenue)} ₽</td><td className="pt-td pt-num pt-dim">{fmt(Math.max(0, node.revenue - node.grossProfit))} ₽</td><td className={`pt-td pt-num ${node.grossProfit >= 0 ? 'up' : 'down'}`}>{fmt(node.grossProfit)} ₽</td><td className="pt-td pt-num">{fmt1(margin)}%</td><td className="pt-td pt-num">{fmt1(expensePct)}%</td><td className="pt-td pt-num">{fmt(node.expenseAmount)} ₽</td><td className="pt-td pt-num">{fmt(node.adSpend)} ₽</td><td className={`pt-td pt-num ${node.netProfit >= 0 ? 'up' : 'down'}`}><span className="profit-value-bar"><i style={{ width: `${Math.min(100, Math.abs(node.netProfit) / Math.max(Math.abs(total.netProfit), 1) * 100)}%` }} />{fmt(node.netProfit)} ₽</span></td><td className={`pt-td pt-num ${profitability >= 0 ? 'up' : 'down'}`}>{fmt1(profitability)}%</td><td className="pt-td pt-classification">{classification ? <span className={`profit-abc profit-abc-${classification.abc.toLowerCase()}`} title="Первая буква — ABC выручки, вторая — ABC чистой прибыли">{classification.abc}</span> : '—'}</td><td className="pt-td pt-role">{classification ? <span className={`profit-role profit-role-${classification.role}`} title="Роль рассчитана внутри склейки за выбранный период">{roleLabel[classification.role]}</span> : '—'}</td></tr>; })}{!visible.length && <tr><td colSpan={13} className="pt-empty">Нет данных в выбранном срезе</td></tr>}</tbody></table></div>
  </div>;
}
