import { useState, useMemo, useSyncExternalStore } from 'react';
import { subscribe, getVersion, getMetrics, getMonthlyPlansForMonth } from '../data/store';
import { monthToPeriod, getDefaultMonth } from '../data/mock';

function f(n: number) { return Math.round(n).toLocaleString('ru-RU') + ' \u20BD'; }
function f1(n: number) { return n.toLocaleString('ru-RU', { maximumFractionDigits: 1 }) + '%'; }
function fPct(n: number) { return n.toLocaleString('ru-RU', { maximumFractionDigits: 1 }); }

interface MetricData {
  label: string;
  plan: number;
  fact: number;
  pct: number;
  forecast: number;
  forecastPct: number;
  planPerDay: number;
  factPerDay: number;
  isPercent: boolean;
}

const MONTHS_RU = ['', 'Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];

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
    let totalAdSpend = 0;
    let totalActualProfit = 0;
    for (const m of filtered) {
      totalOrderedAmount += m.ordered_amount;
      totalAdSpend += m.ad_spend;
      totalActualProfit += m.actual_profit;
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
    for (const p of monthlyPlans) {
      planTotalRubles += p.totalRubles;
      planTotalNetProfit += p.totalNetProfit;
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

    const factMargin = totalOrderedAmount ? (totalActualProfit / totalOrderedAmount) * 100 : 0;
    const factDrr = totalOrderedAmount ? (totalAdSpend / totalOrderedAmount) * 100 : 0;

    return [
      { label: 'План заказов', isPercent: false, ...calc(planBudget, totalOrderedAmount, last3Avg) },
      { label: 'Выручка', isPercent: false, ...calc(planBudget, totalOrderedAmount) },
      {
        label: 'Рентаб-сть', isPercent: true,
        plan: planProfitability, fact: factMargin,
        pct: planProfitability ? (factMargin / planProfitability) * 100 : 0,
        forecast: 0, forecastPct: 0, planPerDay: 0, factPerDay: 0,
      },
      { label: 'Прибыль', isPercent: false, ...calc(planProfit, totalActualProfit) },
      {
        label: 'ДРР', isPercent: true,
        plan: 0, fact: factDrr,
        pct: factDrr,
        forecast: 0, forecastPct: 0, planPerDay: 0, factPerDay: 0,
      },
      { label: 'Рекл.бюджет', isPercent: false, ...calc(0, totalAdSpend) },
    ] as MetricData[];
  }, [version, selectedMonth, periodA, isCurrentMonth, daysInMonth]);

  const renderValue = (m: MetricData, v: number) => {
    return m.isPercent ? f1(v) : f(v);
  };

  return (
    <div className="dashboard-block">
      <div className="db-month-selector">
        <label className="db-month-label">Месяц:</label>
        <input type="month" className="db-month-input" value={selectedMonth} onChange={e => setSelectedMonth(e.target.value)} />
        <span className="db-month-name">{monthLabel}</span>
      </div>
      <div className="db-cards">
        {metrics.map(m => {
          const pctClass = m.pct >= 100 ? 'up' : m.pct < 80 ? 'down' : '';
          const fwdClass = m.forecastPct >= 100 ? 'up' : m.forecastPct < 80 ? 'down' : '';
          return (
            <div key={m.label} className="db-card">
              <div className="db-name">{m.label}</div>
              <div className="db-sep" />
              <div className="db-row"><span className="db-lbl">План</span><span className="db-val">{renderValue(m, m.plan)}</span></div>
              <div className="db-row"><span className="db-lbl">Факт</span><span className="db-val">{renderValue(m, m.fact)}</span></div>
              <div className={`db-row db-pct ${pctClass}`}>
                <span className="db-lbl">Вып</span><span>{fPct(m.pct)}%</span>
              </div>
              {!m.isPercent && (
                <>
                  <div className="db-sep" />
                  <div className="db-row"><span className="db-lbl">Прогноз</span><span className="db-val">{renderValue(m, m.forecast)}</span></div>
                  <div className={`db-row db-pct ${fwdClass}`}>
                    <span className="db-lbl">Пр%</span><span>{fPct(m.forecastPct)}%</span>
                  </div>
                  <div className="db-sep" />
                  <div className="db-row"><span className="db-lbl">Пл/день</span><span className="db-val">{renderValue(m, m.planPerDay)}</span></div>
                  <div className="db-row"><span className="db-lbl">Фкт/день</span><span className="db-val">{renderValue(m, m.factPerDay)}</span></div>
                </>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
