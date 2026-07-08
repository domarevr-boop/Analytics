import { useState, useMemo, useCallback, useSyncExternalStore } from 'react';
import { subscribe, getVersion, getCabinets, getGroups, getProducts, getMemberships, getMonthlyPlans, upsertMonthlyPlan, findOrCreateProduct, UNGROUPED_GROUP_ID } from '../data/store';
import type { MonthlyPlanRecord } from '../types';
import * as XLSX from 'xlsx';

const PLAN_FIELDS: { key: string; label: string; suffix: string; decimals: number }[] = [
  { key: 'avgQtyPerDay', label: 'Ср шт/день', suffix: '', decimals: 1 },
  { key: 'costPrice', label: 'Себес', suffix: ' ₽', decimals: 2 },
  { key: 'checkAmount', label: 'Чек', suffix: ' ₽', decimals: 2 },
  { key: 'netProfitPerUnit', label: 'ЧП', suffix: ' ₽', decimals: 2 },
  { key: 'totalNetProfit', label: 'ЧП итого', suffix: ' ₽', decimals: 0 },
  { key: 'profitability', label: 'Рент', suffix: '%', decimals: 1 },
  { key: 'totalQty', label: 'Суммарно', suffix: '', decimals: 0 },
  { key: 'totalRubles', label: 'Заказы, руб', suffix: ' ₽', decimals: 0 },
  { key: 'revenue', label: 'Выручка', suffix: ' ₽', decimals: 0 },
];



function f(v: number, d: number = 0): string {
  return v.toLocaleString('ru-RU', { minimumFractionDigits: d, maximumFractionDigits: d });
}

interface CellEdit {
  sku: string;
  field: string;
}

export default function PlanningPage() {
  const version = useSyncExternalStore(subscribe, getVersion);
  const cabinets = useMemo(() => getCabinets(), [version]);
  const groups = useMemo(() => getGroups(), [version]);
  const products = useMemo(() => getProducts(), [version]);
  const memberships = useMemo(() => getMemberships(), [version]);
  const monthlyPlans = useMemo(() => getMonthlyPlans(), [version]);

  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState<CellEdit | null>(null);
  const [editValue, setEditValue] = useState('');
  const [selectedMonth, setSelectedMonth] = useState(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  });
  const [importStatus, setImportStatus] = useState('');
  const [globalBuyoutRate, setGlobalBuyoutRate] = useState(85);

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

  // Aggregate plan totals per group and cabinet
  const planTotals = useMemo(() => {
    const totals = new Map<string, Record<string, number>>();
    const init = (): Record<string, number> => ({
      avgQtyPerDay: 0, costPrice: 0, checkAmount: 0, netProfitPerUnit: 0,
      totalNetProfit: 0, profitability: 0, totalQty: 0, totalRubles: 0, revenue: 0,
      _cpSum: 0, _ckSum: 0, _npSum: 0, _cnt: 0,
    });

    for (const cab of cabinets) {
      const cabTotal = init();
      const cabGroups = groups.filter(g => g.cabinet_id === cab.id);

      for (const grp of cabGroups) {
        const grpProducts = products.filter(p =>
          memberships.some(m => m.product_id === p.id && m.group_id === grp.id)
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
        grpTotal.profitability = grpTotal.totalRubles ? (grpTotal.totalNetProfit / grpTotal.totalRubles) * 100 : 0;
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
      cabTotal.profitability = cabTotal.totalRubles ? (cabTotal.totalNetProfit / cabTotal.totalRubles) * 100 : 0;
      totals.set(cab.id, { ...cabTotal });
    }
    return totals;
  }, [cabinets, groups, products, memberships, planMap, selectedMonth]);

  // Grand summary for the top bar
  const planSummary = useMemo(() => {
    let totalRubles = 0, totalNetProfit = 0, totalQty = 0, skuCount = 0;
    for (const cab of cabinets) {
      const ct = planTotals.get(cab.id);
      if (!ct) continue;
      totalRubles += ct.totalRubles;
      totalNetProfit += ct.totalNetProfit;
      totalQty += ct.totalQty;
    }
    for (const pr of products) {
      if (getPlan(pr.sku, selectedMonth)) skuCount++;
    }
    const profitability = totalRubles ? (totalNetProfit / totalRubles) * 100 : 0;
    const revenue = totalRubles * globalBuyoutRate / 100;
    return { totalRubles, totalNetProfit, totalQty, profitability, skuCount, revenue };
  }, [cabinets, products, planTotals, planMap, selectedMonth, globalBuyoutRate]);

  const treeRows = useMemo(() => {
    const rows: { id: string; sku: string; name: string; depth: number; type: 'cabinet' | 'group' | 'product'; parent: string | null }[] = [];
    const ungroupedIds = new Set(memberships.filter(m => m.group_id === UNGROUPED_GROUP_ID).map(m => m.product_id));

    for (const cab of cabinets) {
      rows.push({ id: cab.id, sku: '', name: cab.name, depth: 0, type: 'cabinet', parent: null });
      const cabGroups = groups.filter(g => g.cabinet_id === cab.id).sort((a, b) => a.name.localeCompare(b.name));
      for (const grp of cabGroups) {
        const grpProducts = products.filter(p =>
          memberships.some(m => m.product_id === p.id && m.group_id === grp.id)
        ).sort((a, b) => a.sku.localeCompare(b.sku));
        rows.push({ id: grp.id, sku: '', name: grp.name, depth: 1, type: 'group', parent: cab.id });
        if (expanded.has(grp.id)) {
          for (const pr of grpProducts) {
            rows.push({ id: pr.id, sku: pr.sku, name: pr.name, depth: 2, type: 'product', parent: grp.id });
          }
        }
      }
      const ungroupedProducts = products.filter(p =>
        ungroupedIds.has(p.id) && p.cabinet_id === cab.id
      ).sort((a, b) => a.sku.localeCompare(b.sku));
      if (ungroupedProducts.length > 0) {
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
  }, [cabinets, groups, products, memberships, expanded]);

  const handleStartEdit = (sku: string, field: string) => {
    if (field === 'revenue') return;
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
        upsertMonthlyPlan({ ...existing, [editing.field]: val });
      } else {
        const empty: MonthlyPlanRecord = { sku: editing.sku, month: selectedMonth, avgQtyPerDay: 0, costPrice: 0, checkAmount: 0, netProfitPerUnit: 0, totalNetProfit: 0, profitability: 0, totalQty: 0, totalRubles: 0, buyoutRate: 85 };
        upsertMonthlyPlan({ ...empty, [editing.field]: val });
      }
    }
    setEditing(null);
  };

  const renderCell = (sku: string, field: string, isEditing: boolean) => {
    if (field === 'revenue') {
      const plan = getPlan(sku, selectedMonth);
      const val = plan ? plan.totalRubles * globalBuyoutRate / 100 : 0;
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
      const arr: any[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });

      if (arr.length < 3) {
        setImportStatus('Ошибка: файл содержит недостаточно строк');
        return;
      }

      const headerRow = arr[0];

      const months: string[] = [];
      let col = 1;
      while (col < headerRow.length) {
        const h = String(headerRow[col] || '').trim();
        if (!h) break;
        const monthNum = parseMonthFromHeader(h);
        if (monthNum) {
          months.push(`${selectedMonth.slice(0, 4)}-${String(monthNum).padStart(2, '0')}`);
          col += 8;
        } else {
          col++;
        }
      }

      let imported = 0;
      for (let i = 2; i < arr.length; i++) {
        const row = arr[i];
        const sku = String(row[0] || '').trim();
        if (!sku || sku === 'null' || sku === '' || isNaN(Number(sku))) continue;

        findOrCreateProduct(sku);

        let colIdx = 1;
        for (const month of months) {
          const rec: MonthlyPlanRecord = {
            sku, month,
            avgQtyPerDay: Number(row[colIdx] ?? 0) || 0,
            costPrice: Number(row[colIdx + 1] ?? 0) || 0,
            checkAmount: Number(row[colIdx + 2] ?? 0) || 0,
            netProfitPerUnit: Number(row[colIdx + 3] ?? 0) || 0,
            totalNetProfit: Number(row[colIdx + 4] ?? 0) || 0,
            profitability: Number(row[colIdx + 5] ?? 0) || 0,
            totalQty: Number(row[colIdx + 6] ?? 0) || 0,
            totalRubles: Number(row[colIdx + 7] ?? 0) || 0,
            buyoutRate: 85,
          };
          upsertMonthlyPlan(rec);
          imported++;
          colIdx += 8;
        }
      }
      setImportStatus(`Импортировано ${imported} записей для ${months.length} месяцев`);
      setTimeout(() => setImportStatus(''), 4000);
    } catch (err) {
      setImportStatus('Ошибка: ' + (err instanceof Error ? err.message : 'Неизвестная ошибка'));
    }
  }, [selectedMonth]);

  return (
    <div className="planning-page">
      <div className="pl-top">
        <div className="pl-top-title">План</div>
        <div className="pl-top-controls">
          <div className="pl-period-selector">
            <label>Месяц:</label>
            <input type="month" value={selectedMonth} onChange={e => setSelectedMonth(e.target.value)} />
          </div>
          <div className="pl-buyout-selector">
            <label>% выкупа:</label>
            <input type="number" className="pl-buyout-input" value={globalBuyoutRate} onChange={e => setGlobalBuyoutRate(Number(e.target.value) || 0)} min={0} max={100} />
          </div>
          <div className="pl-import-area">
            <label className={`pl-import-btn ${importStatus ? 'done' : ''}`}>
              {importStatus || 'Импорт из Excel'}
              <input type="file" accept=".xlsx,.xls" hidden onChange={e => {
                const f = e.target.files?.[0];
                if (f) handleImportFile(f);
                e.target.value = '';
              }} />
            </label>
          </div>
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
                        ? ((totals as any).totalRubles || 0) * globalBuyoutRate / 100
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
