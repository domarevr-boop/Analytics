import { useState, useMemo, useSyncExternalStore } from 'react';
import { subscribe, getVersion, getProfitabilityRecords, getCabinets, getGroups, getProducts, getMemberships, UNGROUPED_GROUP_ID } from '../data/store';
import { subscribeExtraExpenses, getExtraExpensesVersion, getExtraExpenses, setExtraExpense } from '../data/profitStore';

function pad(n: number) { return n < 10 ? '0' + n : '' + n; }
function todayStr() { const d = new Date(); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
function monthStart(m: string) { return m + '-01'; }
function monthEnd(m: string) { const d = new Date(+m.split('-')[0], +m.split('-')[1], 0); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }

function f(n: number) { return Math.round(n).toLocaleString('ru-RU'); }
function f1(n: number) { return n.toLocaleString('ru-RU', { maximumFractionDigits: 1 }); }

interface ProfitNode {
  id: string;
  type: 'cabinet' | 'group' | 'product';
  name: string;
  sku?: string;
  depth: number;
  parent: string | null;
  revenue: number;
  profit: number;
  cabinetId: string;
}

const PRESETS = [
  { label: 'Текущий месяц', days: 'month' },
  { label: '7 дней', days: 7 },
  { label: '14 дней', days: 14 },
  { label: '30 дней', days: 30 },
  { label: '90 дней', days: 90 },
] as const;

function addDays(dateStr: string, days: number) {
  const d = new Date(dateStr);
  d.setDate(d.getDate() + days);
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
}

export default function ProfitabilityPage() {
  const version = useSyncExternalStore(subscribe, getVersion);
  const eeVersion = useSyncExternalStore(subscribeExtraExpenses, getExtraExpensesVersion);

  const now = new Date();
  const curMonth = now.getFullYear() + '-' + pad(now.getMonth() + 1);
  const [dateFrom, setDateFrom] = useState(() => monthStart(curMonth));
  const [dateTo, setDateTo] = useState(() => monthEnd(curMonth));
  const [presetLabel, setPresetLabel] = useState('Текущий месяц');

  const period = { start: dateFrom, end: dateTo };
  const extraExpenses = useMemo(() => getExtraExpenses(), [eeVersion]);

  const tree = useMemo(() => {
    const cabinets = getCabinets();
    const groups = getGroups();
    const products = getProducts();
    const memberships = getMemberships();
    const allProfitability = getProfitabilityRecords();

    // Match profitability records whose period_start falls within the selected range
    const prodMap = new Map<string, { revenue: number; profit: number }>();
    for (const r of allProfitability) {
      if (r.period_start >= period.start && r.period_start <= period.end) {
        const cur = prodMap.get(r.product_id) || { revenue: 0, profit: 0 };
        cur.revenue += r.profit_revenue || 0;
        cur.profit += r.actual_profit || 0;
        prodMap.set(r.product_id, cur);
      }
    }

    const ungroupedIds = new Set(
      memberships.filter(m => m.group_id === UNGROUPED_GROUP_ID).map(m => m.product_id)
    );

    const nodes: ProfitNode[] = [];
    const productSet = new Set<string>();

    const addProductNodes = (parentId: string, productList: typeof products, depth: number) => {
      for (const pr of productList) {
        productSet.add(pr.id);
        const data = prodMap.get(pr.id) || { revenue: 0, profit: 0 };
        nodes.push({
          id: pr.id, type: 'product', name: pr.name, sku: pr.sku,
          depth, parent: parentId,
          revenue: data.revenue, profit: data.profit,
          cabinetId: pr.cabinet_id,
        });
      }
    };

    for (const cab of cabinets) {
      const cabGroups = groups.filter(g => g.cabinet_id === cab.id);
      const groupData: { grp: typeof groups[0]; rev: number; prof: number }[] = [];

      for (const grp of cabGroups) {
        let rev = 0, prof = 0;
        const grpProducts = products.filter(p =>
          memberships.some(m => m.product_id === p.id && m.group_id === grp.id)
        );
        addProductNodes(grp.id, grpProducts, 2);
        for (const p of grpProducts) {
          const d = prodMap.get(p.id) || { revenue: 0, profit: 0 };
          rev += d.revenue; prof += d.profit;
        }
        groupData.push({ grp, rev, prof });
      }

      groupData.sort((a, b) => b.rev - a.rev);

      let cabRev = 0, cabProf = 0;
      for (const { grp, rev, prof } of groupData) {
        nodes.push({
          id: grp.id, type: 'group', name: grp.name,
          depth: 1, parent: cab.id,
          revenue: rev, profit: prof, cabinetId: cab.id,
        });
        cabRev += rev; cabProf += prof;
      }

      const ungroupedProducts = products.filter(p =>
        ungroupedIds.has(p.id) && p.cabinet_id === cab.id && !productSet.has(p.id)
      );
      if (ungroupedProducts.length > 0) {
        let rev = 0, prof = 0;
        addProductNodes(cab.id + '-' + UNGROUPED_GROUP_ID, ungroupedProducts, 2);
        for (const p of ungroupedProducts) {
          const d = prodMap.get(p.id) || { revenue: 0, profit: 0 };
          rev += d.revenue; prof += d.profit;
        }
        nodes.push({
          id: cab.id + '-' + UNGROUPED_GROUP_ID, type: 'group',
          name: 'Без склейки', depth: 1, parent: cab.id,
          revenue: rev, profit: prof, cabinetId: cab.id,
        });
        cabRev += rev; cabProf += prof;
      }

      nodes.push({
        id: cab.id, type: 'cabinet', name: cab.name,
        depth: 0, parent: null,
        revenue: cabRev, profit: cabProf, cabinetId: cab.id,
      });
    }

    return nodes;
  }, [version, period]);

  const summary = useMemo(() => {
    const cabs = tree.filter(n => n.type === 'cabinet');
    let totalRev = 0, totalProf = 0;
    for (const c of cabs) {
      totalRev += c.revenue;
      totalProf += c.profit;
    }
    const margin = totalRev ? (totalProf / totalRev) * 100 : 0;
    let weightedEeSum = 0, weightedEeRev = 0;
    for (const c of cabs) {
      const ee = extraExpenses[c.cabinetId] || 0;
      if (ee) {
        weightedEeRev += c.revenue;
        weightedEeSum += c.revenue * ee;
      }
    }
    const weightedEe = weightedEeRev ? weightedEeSum / weightedEeRev : 0;
    const profitability = margin - weightedEe;
    const netProfit = profitability * totalRev / 100;
    return { revenue: totalRev, profit: totalProf, margin, extraExpenses: weightedEe, profitability, netProfit };
  }, [tree, extraExpenses]);

  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const toggle = (id: string) => {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const visible = useMemo(() => {
    const result: ProfitNode[] = [];
    const expandedCabs = new Set(tree.filter(n => n.type === 'cabinet' && expanded.has(n.id)).map(n => n.id));
    const expandedGroups = new Set(tree.filter(n => n.type === 'group' && expanded.has(n.id)).map(n => n.id));

    for (const n of tree) {
      if (n.type === 'cabinet') {
        result.push(n);
        if (expandedCabs.has(n.id)) {
          for (const child of tree) {
            if (child.parent === n.id && child.type === 'group') {
              result.push(child);
              if (expandedGroups.has(child.id)) {
                for (const grandChild of tree) {
                  if (grandChild.parent === child.id) result.push(grandChild);
                }
              }
            }
          }
        }
      }
    }
    return result;
  }, [tree, expanded]);

  return (
    <div className="profit-page">
      <div className="profit-date-range">
        <span className="profit-date-label">Период:</span>
        <span className="profit-date-preset-label">{presetLabel}</span>
        <input type="date" className="daterange-input" value={dateFrom} onChange={e => { setDateFrom(e.target.value); setPresetLabel(''); }} />
        <span className="daterange-sep">—</span>
        <input type="date" className="daterange-input" value={dateTo} onChange={e => { setDateTo(e.target.value); setPresetLabel(''); }} />
        <span className="nav-sep">|</span>
        {PRESETS.map(p => (
          <span key={p.label} className="profit-preset" onClick={() => {
            if (p.days === 'month') {
              const m = new Date().getFullYear() + '-' + pad(new Date().getMonth() + 1);
              setDateFrom(monthStart(m)); setDateTo(monthEnd(m));
            } else {
              setDateTo(todayStr()); setDateFrom(addDays(todayStr(), -(p.days - 1)));
            }
            setPresetLabel(p.label);
          }}>{p.label}</span>
        ))}
      </div>

      <div className="profit-summary">
        <div className="profit-summary-card">
          <div className="profit-summary-label">Выручка</div>
          <div className="profit-summary-value">{f(summary.revenue)} ₽</div>
        </div>
        <div className="profit-summary-card">
          <div className="profit-summary-label">Чистая прибыль</div>
          <div className="profit-summary-value">{f(summary.netProfit)} ₽</div>
        </div>
        <div className="profit-summary-card">
          <div className="profit-summary-label">Маржа</div>
          <div className="profit-summary-value">{f1(summary.margin)}%</div>
        </div>
        <div className="profit-summary-card">
          <div className="profit-summary-label">Доп. расходы</div>
          <div className="profit-summary-value">{f1(summary.extraExpenses)}%</div>
        </div>
        <div className="profit-summary-card profit-summary-highlight">
          <div className="profit-summary-label">Рентабельность</div>
          <div className="profit-summary-value">{f1(summary.profitability)}%</div>
        </div>
      </div>

      <div className="profit-expenses">
        <span className="profit-expenses-title">Доп. расходы по кабинетам:</span>
        {tree.filter(n => n.type === 'cabinet').length === 0 && <span className="profit-expenses-empty">Нет кабинетов</span>}
        {tree.filter(n => n.type === 'cabinet').map(cab => (
          <div key={cab.id} className="profit-expense-item">
            <span className="profit-expense-label">{cab.name}</span>
            <input
              type="number"
              className="profit-expense-input"
              min="0" max="100" step="0.1"
              value={extraExpenses[cab.cabinetId] || 0}
              onChange={e => setExtraExpense(cab.cabinetId, parseFloat(e.target.value) || 0)}
            />
            <span className="profit-expense-suffix">%</span>
          </div>
        ))}
      </div>

      <div className="profit-table-wrap">
        <table className="profit-table">
          <thead>
            <tr>
              <th className="pt-th pt-toggle-col"></th>
              <th className="pt-th pt-name-col">Артикул / Название</th>
              <th className="pt-th pt-num">Выручка</th>
              <th className="pt-th pt-num">Себест-сть</th>
              <th className="pt-th pt-num">Валовая прибыль</th>
              <th className="pt-th pt-num">Маржа %</th>
              <th className="pt-th pt-num">Доп. расх. %</th>
              <th className="pt-th pt-num">Рентаб-сть %</th>
              <th className="pt-th pt-num">ЧП</th>
            </tr>
          </thead>
          <tbody>
            {visible.map(n => {
              const children = tree.filter(c => c.parent === n.id);
              const hasChildren = children.length > 0;
              const isExpanded = expanded.has(n.id);
              const cost = n.revenue - n.profit;
              const margin = n.revenue ? (n.profit / n.revenue) * 100 : 0;
              const ee = extraExpenses[n.cabinetId] || 0;
              const profitability = margin - ee;
              const netProfit = profitability / 100 * n.revenue;

              return (
                <tr key={n.id} className={`profit-row profit-${n.type}`}>
                  <td className="pt-td pt-toggle">
                    {hasChildren && (
                      <span className="profit-expand" onClick={() => toggle(n.id)}>
                        {isExpanded ? '−' : '+'}
                      </span>
                    )}
                  </td>
                  <td className="pt-td pt-name" style={{ paddingLeft: 12 + n.depth * 20 }}>
                    {n.type === 'product' ? (
                      <><span className="profit-sku">{n.sku}</span> {n.name}</>
                    ) : (
                      <span className={`profit-typename profit-${n.type}-name`}>{n.name}</span>
                    )}
                  </td>
                  <td className="pt-td pt-num">{f(n.revenue)}</td>
                  <td className="pt-td pt-num pt-dim">{f(Math.max(0, cost))}</td>
                  <td className="pt-td pt-num">{f(n.profit)}</td>
                  <td className="pt-td pt-num">{f1(margin)}</td>
                  <td className="pt-td pt-num">{f1(ee)}</td>
                  <td className={`pt-td pt-num pt-pct ${profitability >= 0 ? 'up' : 'down'}`}>{f1(profitability)}</td>
                  <td className="pt-td pt-num">{f(netProfit)}</td>
                </tr>
              );
            })}
            {visible.length === 0 && (
              <tr><td colSpan={9} className="pt-empty">Нет данных за выбранный месяц</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
