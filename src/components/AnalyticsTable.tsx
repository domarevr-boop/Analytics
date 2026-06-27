import { useState, useMemo, useSyncExternalStore } from 'react';
import type { MetricValues, TableRow } from '../types';
import { subscribe, getVersion, getProducts, UNGROUPED_GROUP_ID } from '../data/store';
import { getTableData, getHierarchy } from '../data/mock';
import type { DatePeriod } from '../data/mock';

const emptyMetrics = (): MetricValues => ({ impressions: 0, clicks: 0, ctr: 0, carts: 0, cr_cart: 0, orders: 0, cr_order: 0, ad_spend: 0, ad_clicks: 0, ad_orders: 0, cpc: 0, cpo: 0, drr: 0, drrForecast: 0, drrActual: 0, plan_orders: 0, fact_orders: 0, plan_pct: 0, revenue: 0, effectiveRevenue: 0, buyout_amount: 0, profit: 0, margin: 0, stock: 0 });
const addTo = (a: MetricValues, b: MetricValues) => {
  a.impressions += b.impressions; a.clicks += b.clicks;
  a.carts += b.carts; a.orders += b.orders;
  a.ad_spend += b.ad_spend; a.plan_orders += b.plan_orders;
  a.fact_orders += b.fact_orders; a.revenue += b.revenue;
  a.effectiveRevenue += b.effectiveRevenue; a.buyout_amount += b.buyout_amount; a.profit += b.profit; a.stock += b.stock;
};

const f = (n: number) => Math.round(n).toLocaleString('ru-RU');
const f1 = (n: number) => n.toLocaleString('ru-RU', { maximumFractionDigits: 1 });
const f2 = (n: number) => n.toLocaleString('ru-RU', { maximumFractionDigits: 2 });

function pctChange(curr: number, prev: number): number | null {
  if (prev === 0) return curr > 0 ? null : 0;
  return ((curr - prev) / prev) * 100;
}

const HEADER_GROUPS = [
  { label: 'Воронка', keys: ['impressions', 'clicks', 'ctr', 'carts', 'cr_cart', 'orders', 'cr_order'] },
  { label: 'Реклама', keys: ['ad_spend', 'drrForecast', 'drrActual'] },
  { label: 'План', keys: ['plan_orders', 'fact_orders', 'plan_pct'] },
  { label: 'Финансы', keys: ['revenue', 'profit', 'margin'] },
] as const;

const LABELS: Record<string, string> = {
  impressions: 'Показы', clicks: 'Клики', ctr: 'CTR',
  carts: 'Корзины', cr_cart: 'CR корз', orders: 'Заказы', cr_order: 'CR зак',
  ad_spend: 'Расход', cpc: 'CPC', cpo: 'CPO', drr: 'ДРР', drrForecast: 'ДРР прогн', drrActual: 'ДРР факт',
  plan_orders: 'План', fact_orders: 'Факт', plan_pct: 'Вып. плана',
  revenue: 'Выручка', profit: 'Прибыль', margin: 'Рент-сть',
};

interface Props {
  cabinetFilter: string;
  brandFilter: string;
  groupFilter: string;
  searchQuery: string;
  periodA: DatePeriod;
  periodB: DatePeriod;
}

export default function AnalyticsTable({ cabinetFilter, brandFilter, groupFilter, searchQuery, periodA, periodB }: Props) {
  const version = useSyncExternalStore(subscribe, getVersion);
  const filters = useMemo(() => {
    const f: Record<string, string> = {};
    if (cabinetFilter) f.cabinetId = cabinetFilter;
    if (brandFilter) f.brandId = brandFilter;
    if (groupFilter) f.groupId = groupFilter;
    return f;
  }, [cabinetFilter, brandFilter, groupFilter]);
  const allRows = useMemo(() => getTableData(periodA, periodB, filters), [version, periodA, periodB, filters]);
  const hierarchy = useMemo(() => getHierarchy(), [version]);
  const products = useMemo(() => getProducts(), [version]);
  const [expanded, setExpanded] = useState<Set<string>>(new Set([allRows[0]?.id]));

  const toggle = (id: string) => {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const visible = useMemo(() => {
    const productsMatchingBrand = brandFilter
      ? new Set(products.filter(p => p.brand_id === brandFilter).map(p => p.id))
      : null;

    const q = searchQuery.toLowerCase().trim();

    // Collect ancestor IDs for matching products
    const matchingIds = new Set<string>();
    if (productsMatchingBrand) {
      for (const row of allRows) {
        if (row.type === 'product' && productsMatchingBrand.has(row.id)) {
          matchingIds.add(row.id);
          // Walk up parents
          let parentId = row.parent;
          while (parentId) {
            matchingIds.add(parentId);
            const parent = allRows.find(r => r.id === parentId);
            parentId = parent?.parent || null;
          }
        }
      }
    }

    const result: TableRow[] = [];
    const walk = (rows: TableRow[]) => {
      for (const row of rows) {
        const matchCab = !cabinetFilter || row.id === cabinetFilter;
        const matchBrand = !brandFilter || matchingIds.has(row.id);
        const matchGroup = !groupFilter || row.id === groupFilter ||
          (groupFilter === UNGROUPED_GROUP_ID && row.id.endsWith('-' + UNGROUPED_GROUP_ID));

        const matchSearch = !q || (row.sku && (row.sku.toLowerCase().includes(q) || row.name.toLowerCase().includes(q)));
        if (matchCab && matchBrand && matchGroup) {
          if (q && row.type === 'product' && !matchSearch) continue;
          result.push(row);
          const children = allRows.filter(r => r.parent === row.id);
          if (expanded.has(row.id) && children.length) {
            if (brandFilter || q) {
              children.forEach(c => { if (!expanded.has(c.id)) expanded.add(c.id); });
            }
            walk(children);
          }
        }
      }
    };
    walk(allRows.filter(r => r.parent === null));
    return result;
  }, [allRows, hierarchy, cabinetFilter, brandFilter, groupFilter, searchQuery, expanded]);

  const totalRow = useMemo(() => {
    if (!visible.length) return null;
    const rootRows = allRows.filter(r => r.parent === null);
    if (rootRows.length === 1) return rootRows[0];
    const total = emptyMetrics();
    for (const r of rootRows) {
      addTo(total, r.current);
    }
    return { id: 'total', type: 'cabinet' as const, name: 'Итого', parent: null, depth: 0, current: total, previous: total };
  }, [allRows, visible]);

  return (
    <div className="table-container">
      <table className="at">
        <thead>
          <tr className="at-header">
            <th className="at-th at-left-top" rowSpan={2} colSpan={3}></th>
            {HEADER_GROUPS.map(g => (
              <th key={g.label} className="at-group" colSpan={g.keys.length}>{g.label}</th>
            ))}
          </tr>
          <tr className="at-subheader">
            {HEADER_GROUPS.flatMap(g => g.keys).map(k => (
              <th key={k} className="at-th at-metric">{LABELS[k]}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {visible.map(row => {
            const children = allRows.filter(r => r.parent === row.id);
            const hasChildren = children.length > 0;
            const isExpanded = expanded.has(row.id);

            return (
              <tr key={row.id} className={`at-row at-${row.type}`}>
                <td className="at-td at-toggle">
                  {hasChildren && (
                    <span className="at-expand" onClick={() => toggle(row.id)}>
                      {isExpanded ? '−' : '+'}
                    </span>
                  )}
                </td>
                <td className="at-td at-photo">
                  <span className="photo-placeholder"></span>
                </td>
                <td className="at-td at-name" style={{ paddingLeft: 8 + row.depth * 18 }}>
                  {row.type === 'product' ? (
                    <><span className="at-sku">{row.sku}</span> {row.name}</>
                  ) : (
                    <span className={`at-typename at-${row.type}`}>{row.name}</span>
                  )}
                </td>
                {cell(row.current.impressions, pctChange(row.current.impressions, row.previous.impressions))}
                {cell(row.current.clicks, pctChange(row.current.clicks, row.previous.clicks))}
                {cell(row.current.ctr, pctChange(row.current.ctr, row.previous.ctr), '%', true)}
                {cell(row.current.carts, pctChange(row.current.carts, row.previous.carts))}
                {cell(row.current.cr_cart, pctChange(row.current.cr_cart, row.previous.cr_cart), '%', true)}
                {cell(row.current.orders, pctChange(row.current.orders, row.previous.orders))}
                {cell(row.current.cr_order, pctChange(row.current.cr_order, row.previous.cr_order), '%', true)}
                {cell(`${f(row.current.ad_spend)} ₽`, pctChange(row.current.ad_spend, row.previous.ad_spend))}
                {cell(row.current.drrForecast, pctChange(row.current.drrForecast, row.previous.drrForecast), '%', true, true)}
                {cell(row.current.drrActual, pctChange(row.current.drrActual, row.previous.drrActual), '%', true, true)}
                {cell(row.current.plan_orders, pctChange(row.current.plan_orders, row.previous.plan_orders))}
                {cell(row.current.fact_orders, pctChange(row.current.fact_orders, row.previous.fact_orders))}
                {cell(row.current.plan_pct, pctChange(row.current.plan_pct, row.previous.plan_pct), '%', true)}
                {cell(`${f(row.current.revenue)} ₽`, pctChange(row.current.revenue, row.previous.revenue))}
                {cell(`${f(row.current.profit)} ₽`, pctChange(row.current.profit, row.previous.profit))}
                {cell(row.current.margin, pctChange(row.current.margin, row.previous.margin), '%', true)}
              </tr>
            );
          })}
        </tbody>
        {totalRow && (
          <tfoot>
            <tr className="at-row at-total">
              <td className="at-td at-toggle"></td>
              <td className="at-td at-photo"></td>
              <td className="at-td at-name">Итого</td>
              {cell(totalRow.current.impressions, pctChange(totalRow.current.impressions, totalRow.previous.impressions))}
              {cell(totalRow.current.clicks, pctChange(totalRow.current.clicks, totalRow.previous.clicks))}
              {cell(totalRow.current.ctr, pctChange(totalRow.current.ctr, totalRow.previous.ctr), '%', true)}
              {cell(totalRow.current.carts, pctChange(totalRow.current.carts, totalRow.previous.carts))}
              {cell(totalRow.current.cr_cart, pctChange(totalRow.current.cr_cart, totalRow.previous.cr_cart), '%', true)}
              {cell(totalRow.current.orders, pctChange(totalRow.current.orders, totalRow.previous.orders))}
              {cell(totalRow.current.cr_order, pctChange(totalRow.current.cr_order, totalRow.previous.cr_order), '%', true)}
              {cell(`${f(totalRow.current.ad_spend)} ₽`, pctChange(totalRow.current.ad_spend, totalRow.previous.ad_spend))}
              {cell(totalRow.current.drrForecast, pctChange(totalRow.current.drrForecast, totalRow.previous.drrForecast), '%', true, true)}
              {cell(totalRow.current.drrActual, pctChange(totalRow.current.drrActual, totalRow.previous.drrActual), '%', true, true)}
              {cell(totalRow.current.plan_orders, pctChange(totalRow.current.plan_orders, totalRow.previous.plan_orders))}
              {cell(totalRow.current.fact_orders, pctChange(totalRow.current.fact_orders, totalRow.previous.fact_orders))}
              {cell(totalRow.current.plan_pct, pctChange(totalRow.current.plan_pct, totalRow.previous.plan_pct), '%', true)}
              {cell(`${f(totalRow.current.revenue)} ₽`, pctChange(totalRow.current.revenue, totalRow.previous.revenue))}
              {cell(`${f(totalRow.current.profit)} ₽`, pctChange(totalRow.current.profit, totalRow.previous.profit))}
              {cell(totalRow.current.margin, pctChange(totalRow.current.margin, totalRow.previous.margin), '%', true)}
            </tr>
          </tfoot>
        )}
      </table>
    </div>
  );
}

function cell(
  value: string | number,
  change: number | null,
  suffix = '',
  decimals = false,
  rev = false,
) {
  const v = typeof value === 'number'
    ? (decimals ? f2(value) : f(value)) + suffix
    : value;
  const isGood = change !== null && (rev ? change < 0 : change >= 0);

  return (
    <td className="at-td at-mcell">
      <span className="at-mv">{v}</span>
      {change !== null && (
        <span className={`at-mc ${isGood ? 'up' : 'down'} ${Math.abs(change) < 0.01 ? 'flat' : ''}`}>
          {change > 0 ? '+' : ''}{f1(change)}%
        </span>
      )}
    </td>
  );
}
