import { useState, useMemo, useCallback, useSyncExternalStore } from 'react';
import { subscribe, getVersion, getCabinets, getGroups, getProducts, getMemberships, getMonthlyPlans, upsertMonthlyPlan, findOrCreateProduct, UNGROUPED_GROUP_ID } from '../data/store';
import type { MonthlyPlanRecord } from '../types';
import * as XLSX from 'xlsx';

const PLAN_FIELDS: { key: keyof Omit<MonthlyPlanRecord, 'sku' | 'month'>; label: string; suffix: string; decimals: number }[] = [
  { key: 'avgQtyPerDay', label: 'Ср шт/день', suffix: '', decimals: 1 },
  { key: 'costPrice', label: 'Себес', suffix: ' ₽', decimals: 2 },
  { key: 'checkAmount', label: 'Чек', suffix: ' ₽', decimals: 2 },
  { key: 'netProfitPerUnit', label: 'ЧП', suffix: ' ₽', decimals: 2 },
  { key: 'totalNetProfit', label: 'ЧП итого', suffix: ' ₽', decimals: 0 },
  { key: 'profitability', label: 'Рент', suffix: '%', decimals: 1 },
  { key: 'totalQty', label: 'Суммарно', suffix: '', decimals: 0 },
  { key: 'totalRubles', label: 'Заказы, руб', suffix: ' ₽', decimals: 0 },
  { key: 'buyoutRate', label: '% выкупа', suffix: '%', decimals: 1 },
];

function f(v: number, d: number = 0): string {
  return v.toLocaleString('ru-RU', { minimumFractionDigits: d, maximumFractionDigits: d });
}

interface CellEdit {
  sku: string;
  field: keyof Omit<MonthlyPlanRecord, 'sku' | 'month'>;
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

  const handleStartEdit = (sku: string, field: keyof Omit<MonthlyPlanRecord, 'sku' | 'month'>) => {
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

  const renderCell = (sku: string, field: keyof Omit<MonthlyPlanRecord, 'sku' | 'month'>, isEditing: boolean) => {
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
                    {PLAN_FIELDS.map(f => (
                      <td key={f.key} className="pl-td pl-td-num"></td>
                    ))}
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
