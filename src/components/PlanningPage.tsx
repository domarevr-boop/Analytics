import { useState, useMemo, useCallback, useSyncExternalStore } from 'react';
import { subscribe, getVersion, getCabinets, getGroups, getProducts, getMemberships, getGroupMembershipHistory, getMonthlyPlans, upsertMonthlyPlan, upsertMonthlyPlans, findOrCreateProduct, UNGROUPED_GROUP_ID } from '../data/store';
import type { MonthlyPlanRecord } from '../types';
import * as XLSX from 'xlsx';
import FilterBar from './FilterBar';
import type { FilterBarProps } from './FilterBar';
import { getFilteredProductIds, hasProductFilters, isUngroupedFilter } from '../data/productFilters';
import { resolveGroupAtDate } from '../data/groupMembershipHistory';

const PLAN_FIELDS: { key: string; label: string; suffix: string; decimals: number }[] = [
  { key: 'avgQtyPerDay', label: 'Ср шт/день', suffix: '', decimals: 1 },
  { key: 'checkAmount', label: 'Чек', suffix: ' ₽', decimals: 2 },
  { key: 'totalQty', label: 'Заказы, шт', suffix: '', decimals: 0 },
  { key: 'totalRubles', label: 'Заказы, руб', suffix: ' ₽', decimals: 0 },
  { key: 'revenue', label: 'Выручка', suffix: ' ₽', decimals: 0 },
  { key: 'profitability', label: 'Рентабельность', suffix: '%', decimals: 1 },
  { key: 'totalNetProfit', label: 'Чистая прибыль', suffix: ' ₽', decimals: 0 },
];



function f(v: number, d: number = 0): string {
  return v.toLocaleString('ru-RU', { minimumFractionDigits: d, maximumFractionDigits: d });
}

interface CellEdit {
  sku: string;
  field: string;
}

export default function PlanningPage(filterProps: FilterBarProps) {
  const version = useSyncExternalStore(subscribe, getVersion);
  const cabinets = useMemo(() => getCabinets(), [version]);
  const groups = useMemo(() => getGroups(), [version]);
  const products = useMemo(() => getProducts(), [version]);
  const memberships = useMemo(() => getMemberships(), [version]);
  const groupHistory = useMemo(() => getGroupMembershipHistory(), [version]);
  const [selectedMonth, setSelectedMonth] = useState(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  });
  const selectedMonthEnd = `${selectedMonth}-${new Date(Number(selectedMonth.slice(0, 4)), Number(selectedMonth.slice(5, 7)), 0).getDate().toString().padStart(2, '0')}`;
  const monthlyPlans = useMemo(() => getMonthlyPlans(), [version]);
  const filteredProductIds = useMemo(
    () => getFilteredProductIds(products, memberships, filterProps, { groupHistory, period: { start: `${selectedMonth}-01`, end: selectedMonthEnd } }),
    [products, memberships, groupHistory, filterProps, selectedMonth, selectedMonthEnd],
  );
  const filtering = hasProductFilters(filterProps);
  const filteredProducts = useMemo(
    () => products.filter(product => filteredProductIds.has(product.id)),
    [products, filteredProductIds],
  );
  const productGroupMatches = (productId: string, groupId: string) => groupHistory.length > 0
    ? (() => { const resolution = resolveGroupAtDate(productId, selectedMonthEnd, groupHistory, memberships); return resolution.known && resolution.groupId === groupId; })()
    : memberships.some(membership => membership.product_id === productId && membership.group_id === groupId);
  const filteredCabinets = useMemo(
    () => cabinets.filter(cabinet =>
      (!filterProps.cabinetFilter || cabinet.id === filterProps.cabinetFilter)
      && (!filtering || filteredProducts.some(product => product.cabinet_id === cabinet.id)),
    ),
    [cabinets, filterProps.cabinetFilter, filtering, filteredProducts],
  );
  const filteredGroups = useMemo(
    () => groups.filter(group =>
      filteredCabinets.some(cabinet => cabinet.id === group.cabinet_id)
      && (!filterProps.groupFilter || group.id === filterProps.groupFilter)
      && (!filtering || filteredProducts.some(product =>
        productGroupMatches(product.id, group.id)
      )),
    ),
    [groups, filteredCabinets, filterProps.groupFilter, filtering, filteredProducts, memberships, groupHistory, selectedMonthEnd],
  );

  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState<CellEdit | null>(null);
  const [editValue, setEditValue] = useState('');
  const [importStatus, setImportStatus] = useState('');
  const toggle = (id: string) => {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const planMap = useMemo(() => {
    const map = new Map<string, MonthlyPlanRecord>();
    for (const p of monthlyPlans) {
      map.set(p.sku + '|' + p.month, p);
    }
    return map;
  }, [monthlyPlans]);

  const getPlan = (sku: string, month: string): MonthlyPlanRecord | undefined => {
    return planMap.get(sku + '|' + month);
  };
  const selectedMonthPlans = useMemo(
    () => monthlyPlans.filter(plan => plan.month === selectedMonth),
    [monthlyPlans, selectedMonth],
  );
  const monthBuyoutRate = selectedMonthPlans[0]?.buyoutRate ?? 85;
  const monthProfitability = selectedMonthPlans[0]?.profitability ?? 0;

  // Aggregate plan totals per group and cabinet
  const planTotals = useMemo(() => {
    const totals = new Map<string, Record<string, number>>();
    const init = (): Record<string, number> => ({
      avgQtyPerDay: 0, costPrice: 0, checkAmount: 0, netProfitPerUnit: 0,
      totalNetProfit: 0, profitability: 0, totalQty: 0, totalRubles: 0, revenue: 0,
      _cpSum: 0, _ckSum: 0, _npSum: 0, _cnt: 0,
    });

    for (const cab of filteredCabinets) {
      const cabTotal = init();
      const cabGroups = filteredGroups.filter(g => g.cabinet_id === cab.id);

      for (const grp of cabGroups) {
        const grpProducts = filteredProducts.filter(p =>
          productGroupMatches(p.id, grp.id)
        );
        const grpTotal = init();

        for (const pr of grpProducts) {
          const plan = getPlan(pr.sku, selectedMonth);
          if (!plan) continue;
          grpTotal.avgQtyPerDay += plan.avgQtyPerDay;
          grpTotal.totalNetProfit += plan.totalNetProfit;
          grpTotal.totalQty += plan.totalQty;
          grpTotal.totalRubles += plan.totalRubles;
          grpTotal._cpSum += plan.costPrice;
          grpTotal._ckSum += plan.checkAmount;
          grpTotal._npSum += plan.netProfitPerUnit;
          grpTotal._cnt++;
        }

        if (grpTotal._cnt > 0) {
          grpTotal.costPrice = grpTotal._cpSum / grpTotal._cnt;
          grpTotal.checkAmount = grpTotal._ckSum / grpTotal._cnt;
          grpTotal.netProfitPerUnit = grpTotal._npSum / grpTotal._cnt;
        }
        grpTotal.profitability = monthProfitability;
        totals.set(grp.id, { ...grpTotal });

        for (const k of ['avgQtyPerDay', 'totalNetProfit', 'totalQty', 'totalRubles', '_cpSum', '_ckSum', '_npSum', '_cnt']) {
          (cabTotal as any)[k] += (grpTotal as any)[k];
        }
      }
      if (cabTotal._cnt > 0) {
        cabTotal.costPrice = cabTotal._cpSum / cabTotal._cnt;
        cabTotal.checkAmount = cabTotal._ckSum / cabTotal._cnt;
        cabTotal.netProfitPerUnit = cabTotal._npSum / cabTotal._cnt;
      }
      cabTotal.profitability = monthProfitability;
      totals.set(cab.id, { ...cabTotal });
    }
    return totals;
  }, [filteredCabinets, filteredGroups, filteredProducts, memberships, groupHistory, selectedMonthEnd, planMap, selectedMonth, monthProfitability]);

  // Grand summary for the top bar
  const planSummary = useMemo(() => {
    let totalRubles = 0, totalNetProfit = 0, totalQty = 0, skuCount = 0;
    for (const cab of filteredCabinets) {
      const ct = planTotals.get(cab.id);
      if (!ct) continue;
      totalRubles += ct.totalRubles;
      totalNetProfit += ct.totalNetProfit;
      totalQty += ct.totalQty;
    }
    for (const pr of filteredProducts) {
      if (getPlan(pr.sku, selectedMonth)) skuCount++;
    }
    const profitability = monthProfitability;
    const revenue = totalRubles * monthBuyoutRate / 100;
    return { totalRubles, totalNetProfit, totalQty, profitability, skuCount, revenue };
  }, [filteredCabinets, filteredProducts, planTotals, planMap, selectedMonth, monthBuyoutRate, monthProfitability]);

  const treeRows = useMemo(() => {
    const rows: { id: string; sku: string; name: string; depth: number; type: 'cabinet' | 'group' | 'product'; parent: string | null }[] = [];
    const ungroupedIds = new Set(filteredProducts.filter(p => productGroupMatches(p.id, UNGROUPED_GROUP_ID)).map(p => p.id));

    for (const cab of filteredCabinets) {
      rows.push({ id: cab.id, sku: '', name: cab.name, depth: 0, type: 'cabinet', parent: null });
      const cabGroups = filteredGroups.filter(g => g.cabinet_id === cab.id).sort((a, b) => a.name.localeCompare(b.name));
      for (const grp of cabGroups) {
        const grpProducts = filteredProducts.filter(p =>
          productGroupMatches(p.id, grp.id)
        ).sort((a, b) => a.sku.localeCompare(b.sku));
        rows.push({ id: grp.id, sku: '', name: grp.name, depth: 1, type: 'group', parent: cab.id });
        if (expanded.has(grp.id)) {
          for (const pr of grpProducts) {
            rows.push({ id: pr.id, sku: pr.sku, name: pr.name, depth: 2, type: 'product', parent: grp.id });
          }
        }
      }
      const ungroupedProducts = filteredProducts.filter(p =>
        ungroupedIds.has(p.id) && p.cabinet_id === cab.id
      ).sort((a, b) => a.sku.localeCompare(b.sku));
      if ((!filterProps.groupFilter || isUngroupedFilter(filterProps.groupFilter)) && ungroupedProducts.length > 0) {
        const ugId = cab.id + '-' + UNGROUPED_GROUP_ID;
        rows.push({ id: ugId, sku: '', name: 'Без склейки', depth: 1, type: 'group', parent: cab.id });
        if (expanded.has(ugId)) {
          for (const pr of ungroupedProducts) {
            rows.push({ id: pr.id, sku: pr.sku, name: pr.name, depth: 2, type: 'product', parent: ugId });
          }
        }
      }
    }
    return rows;
  }, [filteredCabinets, filteredGroups, filteredProducts, memberships, groupHistory, selectedMonthEnd, expanded, filterProps.groupFilter]);

  const handleStartEdit = (sku: string, field: string) => {
    if (field !== 'avgQtyPerDay' && field !== 'checkAmount') return;
    const plan = getPlan(sku, selectedMonth);
    const val = plan ? (plan as any)[field] as number : 0;
    setEditing({ sku, field });
    setEditValue(String(val));
  };

  const handleFinishEdit = () => {
    if (!editing) return;
    const val = parseFloat(editValue.replace(/[^0-9.,-]/g, '').replace(',', '.'));
    if (!isNaN(val)) {
      const existing = getPlan(editing.sku, selectedMonth);
      if (existing) {
        upsertMonthlyPlan(recalculateMonthlyPlan({ ...existing, [editing.field]: val }));
      } else {
        const empty: MonthlyPlanRecord = { sku: editing.sku, month: selectedMonth, avgQtyPerDay: 0, costPrice: 0, checkAmount: 0, netProfitPerUnit: 0, totalNetProfit: 0, profitability: monthProfitability, totalQty: 0, totalRubles: 0, buyoutRate: monthBuyoutRate };
        upsertMonthlyPlan(recalculateMonthlyPlan({ ...empty, [editing.field]: val }));
      }
    }
    setEditing(null);
  };

  const renderCell = (sku: string, field: string, isEditing: boolean) => {
    if (field === 'revenue') {
      const plan = getPlan(sku, selectedMonth);
      const val = plan ? plan.totalRubles * plan.buyoutRate / 100 : 0;
      const fieldDef = PLAN_FIELDS.find(f => f.key === 'revenue')!;
      return <span className="pl-cell-val">{f(val, fieldDef.decimals)}{fieldDef.suffix}</span>;
    }
    const plan = getPlan(sku, selectedMonth);
    const val = plan ? (plan as any)[field] as number : 0;
    const fieldDef = PLAN_FIELDS.find(f => f.key === field)!;
    const display = f(val, fieldDef.decimals) + fieldDef.suffix;

    if (isEditing) {
      return (
        <input
          className="pl-cell-input"
          type="text"
          value={editValue}
          autoFocus
          onChange={e => setEditValue(e.target.value)}
          onBlur={handleFinishEdit}
          onKeyDown={e => {
            if (e.key === 'Enter') handleFinishEdit();
            if (e.key === 'Escape') setEditing(null);
          }}
        />
      );
    }
    return (
      <span className="pl-cell-val" onDoubleClick={() => handleStartEdit(sku, field)}>
        {display}
      </span>
    );
  };

  const handleImportFile = useCallback(async (file: File) => {
    setImportStatus('Чтение файла...');
    try {
      const data = await file.arrayBuffer();
      const workbook = XLSX.read(data, { type: 'array', cellDates: true });
      const sheetName = workbook.SheetNames[0];
      const sheet = workbook.Sheets[sheetName];
      const arr: unknown[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '', raw: true });

      if (arr.length < 3) {
        setImportStatus('Ошибка: файл содержит недостаточно строк');
        return;
      }

      const headerRow = arr[0] || [];
      const subheaderRow = arr[1] || [];
      const monthStarts = headerRow
        .map((value, column) => ({ column, month: parseMonthFromHeader(String(value || '')) }))
        .filter((item): item is { column: number; month: number } => item.column > 0 && item.month !== null);

      if (monthStarts.length === 0) {
        setImportStatus('Ошибка: в первой строке не найдены месяцы');
        return;
      }

      let year = Number(selectedMonth.slice(0, 4));
      let previousMonth = monthStarts[0].month;
      const monthBlocks = monthStarts.map((item, index) => {
        if (index > 0 && item.month < previousMonth) year++;
        previousMonth = item.month;
        const endColumn = monthStarts[index + 1]?.column ?? headerRow.length;
        return {
          month: `${year}-${String(item.month).padStart(2, '0')}`,
          fields: mapPlanColumns(subheaderRow, item.column, endColumn),
        };
      });

      const invalidMonths = monthBlocks.filter(block => Object.keys(block.fields).length < 2);
      if (invalidMonths.length > 0) {
        setImportStatus(`Ошибка: не найдены «Среднее шт/день» и «Чек» для ${invalidMonths.map(block => block.month).join(', ')}`);
        return;
      }

      let imported = 0;
      const records: MonthlyPlanRecord[] = [];
      for (let i = 2; i < arr.length; i++) {
        const row = arr[i];
        const sku = normalizePlanSku(row[0]);
        if (!sku) continue;

        findOrCreateProduct(sku);

        for (const block of monthBlocks) {
          const existingMonthPlan = monthlyPlans.find(plan => plan.month === block.month);
          const rec = recalculateMonthlyPlan({
            sku, month: block.month,
            avgQtyPerDay: parsePlanNumber(row[block.fields.avgQtyPerDay]),
            checkAmount: parsePlanNumber(row[block.fields.checkAmount]),
            costPrice: 0,
            netProfitPerUnit: 0,
            totalNetProfit: 0,
            profitability: existingMonthPlan?.profitability ?? 0,
            totalQty: 0,
            totalRubles: 0,
            buyoutRate: existingMonthPlan?.buyoutRate ?? 85,
          });
          records.push(rec);
          imported++;
        }
      }
      await upsertMonthlyPlans(records);
      setImportStatus(`Импортировано ${imported} записей для ${monthBlocks.length} месяцев`);
      setTimeout(() => setImportStatus(''), 4000);
    } catch (err) {
      setImportStatus('Ошибка: ' + (err instanceof Error ? err.message : 'Неизвестная ошибка'));
    }
  }, [selectedMonth, monthlyPlans]);

  return (
    <div className="planning-page analytics-page-shell">
      <header className="analytics-page-header">
        <div><span>БИЗНЕС-МЕТРИКИ</span><h1>Планирование</h1><p>Помесячный план заказов, выручки, прибыли и рентабельности по ассортименту.</p></div>
      </header>
      <div className="pl-top">
        <div className="pl-top-title">План</div>
        <div className="table-toolbar workspace-toolbar">
          <div className="date-filters planning-period-controls">
          <div className="pl-period-selector">
            <label>Месяц:</label>
            <input type="month" value={selectedMonth} onChange={e => setSelectedMonth(e.target.value)} />
          </div>
          <div className="pl-buyout-selector">
            <label>% выкупа:</label>
            <input type="number" className="pl-buyout-input" value={monthBuyoutRate} onChange={e => updateMonthAssumptions(Number(e.target.value) || 0, monthProfitability, selectedMonthPlans, upsertMonthlyPlans)} min={0} max={100} />
          </div>
          <div className="pl-buyout-selector">
            <label>Рентабельность:</label>
            <input type="number" className="pl-buyout-input" value={monthProfitability} onChange={e => updateMonthAssumptions(monthBuyoutRate, Number(e.target.value) || 0, selectedMonthPlans, upsertMonthlyPlans)} min={-100} max={100} step="0.1" />
          </div>
          </div>
          <FilterBar
            {...filterProps}
            period={{ start: `${selectedMonth}-01`, end: `${selectedMonth}-${new Date(Number(selectedMonth.slice(0, 4)), Number(selectedMonth.slice(5, 7)), 0).getDate().toString().padStart(2, '0')}` }}
            variant="dashboard"
            afterControls={(
              <div className="pl-import-area">
                <label className={`pl-import-btn ${importStatus ? 'done' : ''}`}>
                  {importStatus || 'Импорт из Excel'}
                  <input type="file" accept=".xlsx,.xls" hidden onChange={e => {
                    const file = e.target.files?.[0];
                    if (file) handleImportFile(file);
                    e.target.value = '';
                  }} />
                </label>
              </div>
            )}
          />
        </div>
      </div>

      <div className="pl-table-wrap">
        <div className="plan-summary">
          <div className="plan-summary-card">
            <div className="plan-summary-label">Заказы, руб</div>
            <div className="plan-summary-value">{f(planSummary.totalRubles)} ₽</div>
          </div>
          <div className="plan-summary-card">
            <div className="plan-summary-label">Выручка</div>
            <div className="plan-summary-value">{f(planSummary.revenue)} ₽</div>
          </div>
          <div className="plan-summary-card">
            <div className="plan-summary-label">ЧП итого</div>
            <div className="plan-summary-value">{f(planSummary.totalNetProfit)} ₽</div>
          </div>
          <div className="plan-summary-card">
            <div className="plan-summary-label">Рентаб-сть</div>
            <div className="plan-summary-value">{f(planSummary.profitability, 1)}%</div>
          </div>
          <div className="plan-summary-card">
            <div className="plan-summary-label">Кол-во</div>
            <div className="plan-summary-value">{f(planSummary.totalQty)}</div>
          </div>
          <div className="plan-summary-card">
            <div className="plan-summary-label">SKU с планом</div>
            <div className="plan-summary-value">{planSummary.skuCount}</div>
          </div>
        </div>
        <table className="pl-table">
          <thead>
            <tr className="pl-header-field">
              <th className="pl-th pl-th-name">Название</th>
              {PLAN_FIELDS.map(f => (
                <th key={f.key} className="pl-th pl-th-field">{f.label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {treeRows.map(row => {
              if (row.type !== 'product') {
                const totals = planTotals.get(row.id) || {};
                return (
                  <tr key={row.id} className={`pl-row pl-depth-${row.depth}`}>
                    <td className="pl-td pl-td-name" style={{ paddingLeft: 8 + row.depth * 18 }}>
                      {(row.type === 'group') && (
                        <span className="pl-expand" onClick={() => toggle(row.id)}>
                          {expanded.has(row.id) ? '−' : '+'}
                        </span>
                      )}
                      <span className={`pl-name pl-name-${row.type}`}>{row.name}</span>
                    </td>
                    {PLAN_FIELDS.map(fd => {
                      let val = fd.key === 'revenue'
                        ? ((totals as any).totalRubles || 0) * monthBuyoutRate / 100
                        : (totals as any)[fd.key];
                      if (val === undefined || val === null) val = 0;
                      return (
                        <td key={fd.key} className="pl-td pl-td-num">
                          <span className="pl-val">{f(val, fd.decimals)}{fd.suffix}</span>
                        </td>
                      );
                    })}
                  </tr>
                );
              }
              return (
                <tr key={row.id} className={`pl-row pl-depth-${row.depth}`}>
                  <td className="pl-td pl-td-name" style={{ paddingLeft: 8 + row.depth * 18 }}>
                    <span className="pl-name pl-name-pr">{row.sku} {row.name}</span>
                  </td>
                  {PLAN_FIELDS.map(f => {
                    const isEditing = editing?.sku === row.sku && editing?.field === f.key;
                    return (
                      <td key={f.key} className="pl-td pl-td-num">
                        {renderCell(row.sku, f.key, !!isEditing)}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function parseMonthFromHeader(h: string): number | null {
  const monthNames: Record<string, number> = {
    'январь': 1, 'февраль': 2, 'март': 3, 'апрель': 4, 'май': 5, 'июнь': 6,
    'июль': 7, 'август': 8, 'сентябрь': 9, 'октябрь': 10, 'ноябрь': 11, 'декабрь': 12,
  };
  const lower = h.toLowerCase().replace(/[^a-zа-я]/g, '');
  for (const [name, num] of Object.entries(monthNames)) {
    if (lower.includes(name)) return num;
  }
  return null;
}

type PlanImportField = 'avgQtyPerDay' | 'checkAmount';

const PLAN_IMPORT_HEADERS: Record<string, PlanImportField> = {
  'среднеештдень': 'avgQtyPerDay',
  'чек': 'checkAmount',
};

function normalizePlanHeader(value: unknown): string {
  return String(value || '').toLowerCase().replace(/ё/g, 'е').replace(/[^a-zа-я0-9]/g, '');
}

function mapPlanColumns(row: unknown[], start: number, end: number): Record<PlanImportField, number> {
  const result = {} as Record<PlanImportField, number>;
  for (let column = start; column < end; column++) {
    const field = PLAN_IMPORT_HEADERS[normalizePlanHeader(row[column])];
    if (field) result[field] = column;
  }
  return result;
}

function parsePlanNumber(value: unknown, percent = false): number {
  if (typeof value === 'number') {
    return percent && Math.abs(value) <= 1 && value !== 0 ? value * 100 : value;
  }
  const source = String(value ?? '').trim();
  if (!source) return 0;
  const normalized = source
    .replace(/[₽%]/g, '')
    .replace(/[\s\u00A0\u202F]/g, '')
    .replace(/,/g, '.')
    .replace(/[−–—]/g, '-');
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizePlanSku(value: unknown): string {
  const sku = String(value ?? '').trim().replace(/[\s\u00A0\u202F]/g, '');
  return sku && sku.toLowerCase() !== 'null' && /^\d+$/.test(sku) ? sku : '';
}

function recalculateMonthlyPlan(plan: MonthlyPlanRecord): MonthlyPlanRecord {
  const [year, month] = plan.month.split('-').map(Number);
  const daysInMonth = new Date(year, month, 0).getDate();
  const totalQty = plan.avgQtyPerDay * daysInMonth;
  const totalRubles = totalQty * plan.checkAmount;
  const revenue = totalRubles * plan.buyoutRate / 100;
  const totalNetProfit = revenue * plan.profitability / 100;
  return {
    ...plan,
    totalQty,
    totalRubles,
    netProfitPerUnit: plan.avgQtyPerDay ? totalNetProfit / totalQty : 0,
    totalNetProfit,
  };
}

function updateMonthAssumptions(
  buyoutRate: number,
  profitability: number,
  plans: MonthlyPlanRecord[],
  save: (records: MonthlyPlanRecord[]) => Promise<void>,
) {
  if (plans.length === 0) return;
  void save(plans.map(plan => recalculateMonthlyPlan({ ...plan, buyoutRate, profitability })))
    .catch(error => console.error('[planning] failed to save monthly assumptions', error));
}
