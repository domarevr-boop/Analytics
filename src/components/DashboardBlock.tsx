import { useState, useMemo, useSyncExternalStore } from 'react';
import { subscribe, getVersion, getMetrics, getMonthlyPlansForMonth, getProducts } from '../data/store';
import { monthToPeriod, getDefaultMonth } from '../data/mock';
import { getExtraExpenses } from '../data/profitStore';

function short(n: number, isPercent: boolean) {
  if (isPercent) return n.toLocaleString('ru-RU', { maximumFractionDigits: 1 }) + '%';
  const abs = Math.abs(n);
  const sign = n < 0 ? '−' : '';
  if (abs >= 1_000_000) return sign + (abs / 1_000_000).toLocaleString('ru-RU', { maximumFractionDigits: 1 }) + 'M';
  if (abs >= 1_000) return sign + Math.round(abs / 1_000).toLocaleString('ru-RU') + 'k';
  return sign + Math.round(abs).toLocaleString('ru-RU');
}

interface MetricData {
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
  hidePlan?: boolean;
  factExtra?: { label: string; value: number };
}

const MONTHS_RU = ['', 'Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];

function DbCard({ m, renderValue }: { m: MetricData; renderValue: (m: MetricData, v: number) => string }) {
  const pctClass = m.pct >= 100 ? 'up' : m.pct < 80 ? 'down' : '';
  const fwdClass = m.forecastPct >= 100 ? 'up' : m.forecastPct < 80 ? 'down' : '';
  const barClass = m.plan > 0
    ? (m.pct >= 90 ? 'db-bar-up' : m.pct >= 70 ? 'db-bar-warn' : 'db-bar-down')
    : '';

  const showPlan = !m.hidePlan && m.plan > 0;
  const showSecondary = showPlan && !m.isPercent;

  return (
    <div className={`db-card ${barClass}`}>
      <div className="db-name" title={m.tooltip}>{m.label}</div>
      <div className="db-row-main">
        <span className="db-val">{renderValue(m, m.fact)}</span>
        {showPlan && (
          <>
            <span className="db-main-sep">|</span>
            <span className="db-val-md">{renderValue(m, m.plan)}</span>
            <span className="db-main-sep">|</span>
            <span className={`db-val-sm db-pct ${pctClass}`}>{m.pct.toFixed(1)}%</span>
          </>
        )}
      </div>
      {showSecondary && (
        <div className="db-row-secondary">
          <span>Прогноз {renderValue(m, m.forecast)}</span>
          {m.forecastPct > 0 && <span className={`db-fwd db-pct ${fwdClass}`}>({m.forecastPct.toFixed(1)}%)</span>}
          {(m.planPerDay > 0 || m.factPerDay > 0) && <span className="db-sec-dot">·</span>}
          {m.planPerDay > 0 && <span>Пл/д {renderValue(m, m.planPerDay)}</span>}
          {m.planPerDay > 0 && m.factPerDay > 0 && <span className="db-sec-dot">·</span>}
          {m.factPerDay > 0 && <span>Фкт/д {renderValue(m, m.factPerDay)}</span>}
        </div>
      )}
    </div>
  );
}

export default function DashboardBlock() {
  const version = useSyncExternalStore(subscribe, getVersion);
  const [selectedMonth, setSelectedMonth] = useState(getDefaultMonth);

  const periodA = useMemo(() => monthToPeriod(selectedMonth), [selectedMonth]);
  const [y, m] = selectedMonth.split('-').map(Number);
  const monthLabel = `${MONTHS_RU[m]} ${y}`;
  const isCurrentMonth = selectedMonth === getDefaultMonth();
  const daysInMonth = new Date(y, m, 0).getDate();

  const metrics = useMemo(() => {
    const allMetrics = getMetrics();
    const monthlyPlans = getMonthlyPlansForMonth(selectedMonth);

    const filtered = allMetrics.filter(m =>
      m.date >= periodA.start && m.date <= periodA.end
    );

    const daysSoFar = Math.max(1, new Set(filtered.map(m => m.date)).size);
    const remainingDays = daysInMonth - daysSoFar;

    let totalOrderedAmount = 0;
    let totalBuyoutAmount = 0;
    let totalAdSpend = 0;
    let totalActualProfit = 0;
    let totalProfitRevenue = 0;
    for (const m of filtered) {
      totalOrderedAmount += m.ordered_amount;
      totalBuyoutAmount += m.buyout_amount;
      totalAdSpend += m.ad_spend;
      totalActualProfit += m.actual_profit;
      totalProfitRevenue += m.profit_revenue || 0;
    }

    const sortedDates = [...new Set(filtered.map(m => m.date))].sort();
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
    const planProfitability = planTotalRubles ? (planTotalNetProfit / planTotalRubles) * 100 : 0;
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

    // Сойка: weighted extra expenses
    const _products = getProducts();
    const cabRev: Record<string, number> = {};
    for (const m of filtered) {
      if (!m.profit_revenue) continue;
      const pr = _products.find(p => p.id === m.product_id);
      const cid = pr?.cabinet_id || '';
      cabRev[cid] = (cabRev[cid] || 0) + (m.profit_revenue || 0);
    }
    const eeData = getExtraExpenses();
    let weightedEeSum = 0, weightedEeRev = 0;
    for (const [cid, rev] of Object.entries(cabRev)) {
      const ee = eeData[cid] || 0;
      if (ee) { weightedEeSum += rev * ee; weightedEeRev += rev; }
    }
    const weightedEe = weightedEeRev ? weightedEeSum / weightedEeRev : 0;
    const soyaMargin = totalProfitRevenue ? (totalActualProfit / totalProfitRevenue) * 100 : 0;
    const soyaProfitability = soyaMargin - weightedEe;
    const netProfit = soyaProfitability / 100 * totalProfitRevenue;

    const avg3 = last3Avg;

    return [
      {
        label: 'План заказов', tooltip: 'Плановая сумма заказов на месяц',
        isPercent: false,
        ...calc(planBudget, totalOrderedAmount, avg3),
      },
      {
        label: 'Выручка', tooltip: 'Выручка из отчёта о прибыли',
        isPercent: false,
        ...calc(planRevenue, totalProfitRevenue),
      },
      {
        label: 'Рентаб-сть (Сойка)', tooltip: 'Рентабельность с учётом внереализационных расходов',
        isPercent: true,
        plan: planProfitability, fact: soyaProfitability,
        pct: planProfitability ? (soyaProfitability / planProfitability) * 100 : 0,
        forecast: 0, forecastPct: 0, planPerDay: 0, factPerDay: 0,
      },
      {
        label: 'Чистая прибыль', tooltip: 'Чистая прибыль = Выручка (Сойка) × Рентабельность (Сойка)',
        isPercent: false, ...calc(planProfit, netProfit),
      },
      {
        label: 'ДРР', tooltip: 'Доля рекламных расходов = Расходы на рекламу ÷ Сумма заказа',
        isPercent: true, hidePlan: true,
        plan: 0, fact: factDrr,
        pct: 0,
        forecast: 0, forecastPct: 0, planPerDay: 0, factPerDay: 0,
      },
      {
        label: 'Рекл.бюджет', tooltip: 'Общие расходы на рекламу за период',
        isPercent: false, ...calc(0, totalAdSpend),
      },
    ] as MetricData[];
  }, [version, selectedMonth, periodA, isCurrentMonth, daysInMonth]);

  const renderValue = (m: MetricData, v: number) => short(v, m.isPercent);

  return (
    <div className="dashboard-block">
      <div className="db-month-selector">
        <label className="db-month-label">Месяц:</label>
        <input type="month" className="db-month-input" value={selectedMonth} onChange={e => setSelectedMonth(e.target.value)} />
        <span className="db-month-name">{monthLabel}</span>
      </div>
      <div className="db-cards">
        {metrics.map(m => (
          <DbCard key={m.label} m={m} renderValue={renderValue} />
        ))}
      </div>
    </div>
  );
}
