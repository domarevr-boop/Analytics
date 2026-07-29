import { useState, useMemo, useSyncExternalStore } from 'react';
import { subscribe, getVersion, getMetrics, getMonthlyPlansForMonth, getProfitabilityRecords, getProducts } from '../data/store';
import { monthToPeriod, getDefaultMonth } from '../data/mock';
import { getWbImageUrls } from '../data/images';
import { subscribeExtraExpenses, getExtraExpensesVersion, getCabinetExtraExpense } from '../data/profitStore';
import { getReportNetProfit } from '../data/profitabilityCalculations';

function short(n: number, isPercent: boolean) {
  if (isPercent) return n.toLocaleString('ru-RU', { maximumFractionDigits: 1 }) + '%';
  const abs = Math.abs(n);
  const sign = n < 0 ? '−' : '';
  if (abs >= 1_000_000) return sign + (abs / 1_000_000).toLocaleString('ru-RU', { maximumFractionDigits: 1 }) + 'M';
  if (abs >= 1_000) return sign + Math.round(abs / 1_000).toLocaleString('ru-RU') + 'k';
  return sign + Math.round(abs).toLocaleString('ru-RU');
}

interface MetricData {
  key: string;
  group: 'Продажи' | 'Прибыльность' | 'Реклама';
  label: string;
  tooltip: string;
  plan: number;
  fact: number;
  pct: number;
  forecast: number;
  forecastPct: number;
  planPerDay: number;
  factPerDay: number;
  isPercent: boolean;
  planAvailable?: boolean;
  factExtra?: { label: string; value: number };
  spark: number[];
}

function Sparkline({ values, tone }: { values: number[]; tone: 'blue' | 'green' }) {
  if (values.length < 2) return null;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const points = values.map((value, index) => {
    const x = (index / (values.length - 1)) * 100;
    const y = 25 - ((value - min) / range) * 21;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');
  return <svg className={`db-card-trend ${tone}`} viewBox="0 0 100 28" preserveAspectRatio="none" aria-hidden="true"><polyline points={points} /></svg>;
}

function DbCard({
  m,
  renderValue,
  primary,
  selected,
  onActivate,
}: {
  m: MetricData;
  renderValue: (m: MetricData, v: number) => string;
  primary: boolean;
  selected: boolean;
  onActivate: () => void;
}) {
  const pctClass = m.pct >= 100 ? 'up' : m.pct < 80 ? 'down' : '';
  const fwdClass = m.forecastPct >= 100 ? 'up' : m.forecastPct < 80 ? 'down' : '';
  const barClass = m.plan > 0
    ? (m.pct >= 90 ? 'db-bar-up' : m.pct >= 70 ? 'db-bar-warn' : 'db-bar-down')
    : '';

  const planAvailable = m.planAvailable !== false;
  const showSecondary = planAvailable && !m.isPercent;
  const status = !planAvailable ? 'План не задан' : m.pct >= 100 ? 'План выполнен' : m.pct >= 80 ? 'Близко к плану' : 'Ниже плана';
  return (
    <button
      type="button"
      className={`db-card ${primary ? 'db-card-primary' : 'db-card-secondary'} ${barClass}${selected ? ' db-card-selected' : ''}`}
      onClick={onActivate}
      aria-pressed={selected}
    >
      <div className="db-card-header">
        <div className="db-name" title={`${m.tooltip}. Источник: импорт и месячный план.`}>{m.label}</div>
      </div>
      <Sparkline values={m.spark} tone={m.key === 'margin' || m.key === 'profit' ? 'green' : 'blue'} />
      <div className="db-row-main">
        <span className="db-value-label">Факт</span>
        <span className="db-val">{renderValue(m, m.fact)}</span>
        <span className={`db-plan${planAvailable ? '' : ' db-plan-empty'}`}>
          План <strong>{planAvailable ? renderValue(m, m.plan) : 'не задан'}</strong>
        </span>
      </div>
      {showSecondary && (
        <div className="db-row-secondary">
          <span>Прогноз <strong>{renderValue(m, m.forecast)}</strong></span>
          {m.forecastPct > 0 && <span className={`db-fwd db-pct ${fwdClass}`}>{m.forecastPct.toFixed(1)}%</span>}
          {m.factPerDay > 0 && <span>В день <strong>{renderValue(m, m.factPerDay)}</strong></span>}
        </div>
      )}
      {planAvailable && (
        <div className="db-progress" aria-label={`Выполнение плана ${m.pct.toFixed(1)}%`}>
          <span className="db-progress-fill" style={{ width: `${Math.min(100, Math.max(0, m.pct))}%` }} />
          <b>{m.pct.toFixed(1)}%</b>
        </div>
      )}
      <div className={`db-status ${planAvailable ? pctClass || 'warn' : 'empty'}`}>
        <span>{status}</span>
        {!planAvailable && (
          <span
            className="db-plan-action"
            role="button"
            tabIndex={0}
            onClick={event => {
              event.stopPropagation();
              window.dispatchEvent(new Event('analytics:open-planning'));
            }}
          >Задать план</span>
        )}
      </div>
    </button>
  );
}

interface DashboardBlockProps {
  selectedCategory?: string;
  onCategorySelect?: (category: string) => void;
  onExport?: () => void;
}

export default function DashboardBlock({ selectedCategory = '', onCategorySelect, onExport }: DashboardBlockProps) {
  const version = useSyncExternalStore(subscribe, getVersion);
  const extraExpensesVersion = useSyncExternalStore(subscribeExtraExpenses, getExtraExpensesVersion);
  const [selectedMonth, setSelectedMonth] = useState(getDefaultMonth);
  const [selectedMetric, setSelectedMetric] = useState('');
  const lastDataDate = useMemo(() => getMetrics().reduce((latest, metric) => metric.date > latest ? metric.date : latest, ''), [version]);

  const periodA = useMemo(() => monthToPeriod(selectedMonth), [selectedMonth]);
  const [y, m] = selectedMonth.split('-').map(Number);
  const isCurrentMonth = selectedMonth === getDefaultMonth();
  const daysInMonth = new Date(y, m, 0).getDate();

  const metrics = useMemo(() => {
    const allMetrics = getMetrics();
    const productsById = new Map(getProducts().map(product => [product.id, product]));
    const categoryProductIds = selectedCategory
      ? new Set(getProducts().filter(product => (product.category || 'Без категории') === selectedCategory).map(product => product.id))
      : null;
    const categoryProductSkus = selectedCategory
      ? new Set(getProducts().filter(product => (product.category || 'Без категории') === selectedCategory).map(product => product.sku))
      : null;
    const profitability = getProfitabilityRecords().filter(record =>
      record.period_end >= periodA.start && record.period_start <= periodA.end
      && (!categoryProductIds || categoryProductIds.has(record.product_id))
    );
    const monthlyPlans = getMonthlyPlansForMonth(selectedMonth)
      .filter(plan => !categoryProductSkus || categoryProductSkus.has(plan.sku));

    const filtered = allMetrics.filter(m =>
      m.date >= periodA.start && m.date <= periodA.end
      && (!categoryProductIds || categoryProductIds.has(m.product_id))
    );

    const daysSoFar = Math.max(1, new Set(filtered.map(m => m.date)).size);
    const remainingDays = daysInMonth - daysSoFar;

    let totalOrderedAmount = 0;
    let totalAdSpend = 0;
    let totalActualProfit = 0;
    let totalProfitRevenue = 0;

    for (const m of filtered) {
      totalOrderedAmount += m.ordered_amount;
      totalAdSpend += m.ad_spend;
    }

    if (profitability.length > 0) {
      for (const record of profitability) {
        const cabinetId = productsById.get(record.product_id)?.cabinet_id || '';
        const extraExpensePct = getCabinetExtraExpense(selectedMonth, cabinetId);
        totalActualProfit += getReportNetProfit(record, extraExpensePct);
        totalProfitRevenue += record.profit_revenue;
      }
    } else {
      for (const m of filtered) {
        const cabinetId = productsById.get(m.product_id)?.cabinet_id || '';
        const extraExpensePct = getCabinetExtraExpense(selectedMonth, cabinetId);
        const profit = (m.profit_revenue || 0) - (m.cost || 0) - (m.agent_fee || 0) - (m.logistics_cost || 0) - (m.marketing_cost || 0) - (m.storage_cost || 0) - (m.profit_revenue || 0) * extraExpensePct / 100;
        totalActualProfit += profit;
        totalProfitRevenue += m.profit_revenue || 0;
      }
    }

    const sortedDates = [...new Set([
      ...filtered.map(m => m.date),
      ...profitability.map(record => record.period_start),
    ])].sort();
    const last3Dates = sortedDates.slice(-3);
    const last3OrderedAmount = filtered
      .filter(m => last3Dates.includes(m.date))
      .reduce((s, m) => s + m.ordered_amount, 0);
    const last3Avg = last3Dates.length ? last3OrderedAmount / last3Dates.length : 0;

    // Plan from MonthlyPlanRecord
    let planTotalRubles = 0;
    let planTotalNetProfit = 0;
    let planRevenue = 0;
    for (const p of monthlyPlans) {
      planTotalRubles += p.totalRubles;
      planTotalNetProfit += p.totalNetProfit;
      planRevenue += p.totalRubles * (p.buyoutRate || 85) / 100;
    }
    const planProfitability = planRevenue ? (planTotalNetProfit / planRevenue) * 100 : 0;
    const planBudget = planTotalRubles;
    const planProfit = planTotalNetProfit;

    const calc = (plan: number, fact: number, avg3?: number) => {
      const dailyRate = fact / daysSoFar;
      const forecastRate = avg3 ?? dailyRate;
      const forecast = isCurrentMonth ? fact + forecastRate * remainingDays : fact;
      return {
        plan,
        fact,
        pct: plan ? (fact / plan) * 100 : 0,
        forecast,
        forecastPct: plan ? (forecast / plan) * 100 : 0,
        planPerDay: plan / daysInMonth,
        factPerDay: dailyRate,
      };
    };

    const factDrr = totalOrderedAmount ? (totalAdSpend / totalOrderedAmount) * 100 : 0;
    const soyaMargin = totalProfitRevenue ? (totalActualProfit / totalProfitRevenue) * 100 : 0;

    const avg3 = last3Avg;
    const profitabilityByDate = new Map<string, { revenue: number; profit: number }>();
    for (const record of profitability) {
      const cabinetId = productsById.get(record.product_id)?.cabinet_id || '';
      const extraExpensePct = getCabinetExtraExpense(selectedMonth, cabinetId);
      const current = profitabilityByDate.get(record.period_start) || { revenue: 0, profit: 0 };
      current.revenue += record.profit_revenue;
      current.profit += getReportNetProfit(record, extraExpensePct);
      profitabilityByDate.set(record.period_start, current);
    }
    const daily = sortedDates.map(date => {
      const totals = filtered.filter(metric => metric.date === date).reduce((total, metric) => {
        const cabinetId = productsById.get(metric.product_id)?.cabinet_id || '';
        const extraExpensePct = getCabinetExtraExpense(selectedMonth, cabinetId);
        const profit = (metric.profit_revenue || 0) - (metric.cost || 0) - (metric.agent_fee || 0) - (metric.logistics_cost || 0) - (metric.marketing_cost || 0) - (metric.storage_cost || 0) - (metric.profit_revenue || 0) * extraExpensePct / 100;
      total.orderedAmount += metric.ordered_amount;
      total.revenue += metric.profit_revenue || 0;
      total.profit += profit;
      total.adSpend += metric.ad_spend;
      return total;
      }, { orderedAmount: 0, revenue: 0, profit: 0, adSpend: 0 });
      const report = profitabilityByDate.get(date);
      if (report) { totals.revenue = report.revenue; totals.profit = report.profit; }
      return totals;
    });
    const sparks = {
      factOrders: daily.map(day => day.orderedAmount),
      revenue: daily.map(day => day.revenue),
      profit: daily.map(day => day.profit),
      margin: daily.map(day => day.revenue ? day.profit / day.revenue * 100 : 0),
      drr: daily.map(day => day.orderedAmount ? day.adSpend / day.orderedAmount * 100 : 0),
      adSpend: daily.map(day => day.adSpend),
    };

    return [
      {
        key: 'fact_orders', group: 'Продажи',
        label: 'План заказов', tooltip: 'Плановая сумма заказов на месяц',
        isPercent: false,
        spark: sparks.factOrders,
        ...calc(planBudget, totalOrderedAmount, avg3),
      },
      {
        key: 'revenue', group: 'Продажи',
        label: 'Выручка', tooltip: 'Выручка',
        isPercent: false,
        spark: sparks.revenue,
        ...calc(planRevenue, totalProfitRevenue),
      },
      {
        key: 'margin', group: 'Прибыльность',
        label: 'Рентаб-сть', tooltip: 'Рентабельность (Выручка - Расходы)',
        isPercent: true,
        spark: sparks.margin,
        plan: planProfitability, fact: soyaMargin,
        pct: planProfitability ? (soyaMargin / planProfitability) * 100 : 0,
        forecast: 0, forecastPct: 0, planPerDay: 0, factPerDay: 0,
      },
      {
        key: 'profit', group: 'Прибыльность',
        label: 'Чистая прибыль', tooltip: 'Чистая прибыль',
        isPercent: false, spark: sparks.profit, ...calc(planProfit, totalActualProfit),
      },
      {
        key: 'drr', group: 'Реклама',
        label: 'ДРР', tooltip: 'Доля рекламных расходов = Расходы на рекламу ÷ Сумма заказа',
        isPercent: true, planAvailable: false, spark: sparks.drr,
        plan: 0, fact: factDrr,
        pct: 0,
        forecast: 0, forecastPct: 0, planPerDay: 0, factPerDay: 0,
      },
      {
        key: 'ad_spend', group: 'Реклама',
        label: 'Рекл.бюджет', tooltip: 'Общие расходы на рекламу за период',
        isPercent: false, planAvailable: false, spark: sparks.adSpend, ...calc(0, totalAdSpend),
      },
    ] as MetricData[];
  }, [version, extraExpensesVersion, selectedMonth, selectedCategory, periodA, isCurrentMonth, daysInMonth]);

  const renderValue = (m: MetricData, v: number) => short(v, m.isPercent);
  const categoryKpis = useMemo(() => {
    const productList = getProducts();
    const products = new Map(productList.map(product => [product.id, product]));
    const totals = new Map<string, { orders: number; revenue: number; profit: number; plan: number }>();
    getMetrics().filter(metric => metric.date >= periodA.start && metric.date <= periodA.end).forEach(metric => {
      const category = products.get(metric.product_id)?.category || 'Без категории';
      const current = totals.get(category) || { orders: 0, revenue: 0, profit: 0, plan: 0 };
      const extraExpensePct = getCabinetExtraExpense(periodA.start.slice(0, 7), products.get(metric.product_id)?.cabinet_id || '');
      const profit = (metric.profit_revenue || 0) - (metric.cost || 0) - (metric.agent_fee || 0) - (metric.logistics_cost || 0) - (metric.marketing_cost || 0) - (metric.storage_cost || 0) - (metric.profit_revenue || 0) * extraExpensePct / 100;
      current.orders += metric.orders; current.revenue += metric.ordered_amount; current.profit += profit; totals.set(category, current);
    });
    const categoryBySku = new Map(productList.map(product => [product.sku, product.category || 'Без категории']));
    for (const plan of getMonthlyPlansForMonth(selectedMonth)) {
      const category = categoryBySku.get(plan.sku);
      if (!category) continue;
      const current = totals.get(category) || { orders: 0, revenue: 0, profit: 0, plan: 0 };
      current.plan += plan.totalRubles;
      totals.set(category, current);
    }
    const profitabilityByCategory = new Map<string, { profit: number; revenue: number }>();
    getProfitabilityRecords().filter(record => record.period_end >= periodA.start && record.period_start <= periodA.end).forEach(record => {
      const category = products.get(record.product_id)?.category || 'Без категории';
      const current = profitabilityByCategory.get(category) || { profit: 0, revenue: 0 };
      const extraExpensePct = getCabinetExtraExpense(periodA.start.slice(0, 7), products.get(record.product_id)?.cabinet_id || '');
      current.profit += getReportNetProfit(record, extraExpensePct);
      current.revenue += record.profit_revenue; profitabilityByCategory.set(category, current);
    });
    for (const [category] of profitabilityByCategory) {
      if (!totals.has(category)) totals.set(category, { orders: 0, revenue: 0, profit: 0, plan: 0 });
    }
    return [...totals.entries()].map(([name, values]) => {
      const fact = profitabilityByCategory.get(name);
      const profit = fact?.profit ?? values.profit;
      const revenue = fact?.revenue || values.revenue;
      const imageProduct = productList.find(product => (product.category || 'Без категории') === name && product.wb_sku);
      return { name, ...values, profit, planPct: values.plan ? values.revenue / values.plan * 100 : 0, margin: revenue ? profit / revenue * 100 : 0, image: imageProduct?.wb_sku ? getWbImageUrls(imageProduct.wb_sku)[0] : '' };
    }).sort((a, b) => b.revenue - a.revenue).slice(0, 6);
  }, [version, extraExpensesVersion, periodA]);
  const handleMetricSelect = (metricKey: string) => {
    const active = selectedMetric !== metricKey;
    setSelectedMetric(active ? metricKey : '');
    window.dispatchEvent(new CustomEvent('analytics:kpi-select', { detail: { metricKey, active } }));
  };

  return (
    <div className="dashboard-block analytics-sheet">
      <div className="db-overview-toolbar analytics-toolbar">
        <div className="db-month-selector">
          <label className="db-month-label">Месяц</label>
          <input type="month" className="db-month-input" value={selectedMonth} onChange={e => setSelectedMonth(e.target.value)} />
        </div>
        <div className="db-overview-actions">
          <div className="db-data-freshness">
            <span className="db-freshness-dot" />
            Данные по {lastDataDate ? new Date(`${lastDataDate}T00:00:00`).toLocaleDateString('ru-RU') : '—'}
          </div>
          {onExport && <button type="button" className="db-export-button" onClick={onExport}>Экспорт</button>}
        </div>
      </div>
      <div className="db-primary-cards analytics-kpi-sheet">
        {(['fact_orders', 'revenue', 'profit', 'margin'] as const).map(key => {
          const metric = metrics.find(item => item.key === key);
          return metric ? <DbCard key={metric.key} m={metric} renderValue={renderValue} primary selected={selectedMetric === metric.key} onActivate={() => handleMetricSelect(metric.key)} /> : null;
        })}
      </div>
      {categoryKpis.length > 0 && (
        <div className="db-category-strip">
          {categoryKpis.map(category => (
            <button
              type="button"
              className={`db-category-item${selectedCategory === category.name ? ' selected' : ''}`}
              key={category.name}
              onClick={() => onCategorySelect?.(category.name)}
              aria-pressed={selectedCategory === category.name}
            >
              {category.image ? <img src={category.image} alt="" onError={event => { event.currentTarget.style.display = 'none'; }} /> : <span className="db-category-cover">{category.name.slice(0, 1)}</span>}
              <div className="db-category-content">
                <div className="db-category-title"><strong>{category.name}</strong><span aria-hidden="true">›</span></div>
                <div className="db-category-value-row">
                  <div className="db-category-revenue">{short(category.revenue, false)} ₽</div>
                  <span className="db-category-orders"><i>План заказов</i>{category.plan ? `${category.planPct.toFixed(1)}%` : 'не задан'}</span>
                </div>
                <div className="db-category-footer">
                  <span><i>Прибыль</i>{short(category.profit, false)} ₽</span>
                  <span className="db-category-margin">{category.margin.toFixed(1)}%</span>
                </div>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
