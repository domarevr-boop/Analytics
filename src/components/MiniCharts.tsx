import { useMemo } from 'react';
import {
  Bar,
  CartesianGrid,
  Cell,
  ComposedChart,
  Legend,
  Line,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

const CATEGORY_COLORS = ['#2563EB', '#3B82F6', '#14B8A6', '#34D399', '#7DD3FC', '#A7F3D0'];

function fmt(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${Math.round(value / 1_000).toLocaleString('ru-RU')}k`;
  return Math.round(value).toLocaleString('ru-RU');
}

function chartRows(data: { date: string; values: Record<string, number> }[]) {
  return data.map(point => ({
    date: point.date,
    margin: point.values.margin || 0,
    profit: point.values.profit || 0,
    adSpend: point.values.ad_spend || 0,
    drr: point.values.drr || 0,
  }));
}

function CategoryOrders({ data }: { data: { name: string; value: number }[] }) {
  const total = data.reduce((sum, item) => sum + item.value, 0);
  return (
    <div className="mini-chart overview-donut-card">
      <div className="mini-chart-header">
        <span className="mini-chart-label">Сумма заказов по категориям</span>
      </div>
      <div className="overview-donut-layout">
        <div className="overview-donut-chart">
          <ResponsiveContainer width="100%" height={220}>
            <PieChart>
              <Pie data={data} dataKey="value" nameKey="name" innerRadius={47} outerRadius={72} paddingAngle={2}>
                {data.map((item, index) => <Cell key={item.name} fill={CATEGORY_COLORS[index % CATEGORY_COLORS.length]} />)}
              </Pie>
              <Tooltip formatter={value => [`${fmt(Number(value || 0))} ₽`, 'Сумма заказов']} />
            </PieChart>
          </ResponsiveContainer>
          <div className="overview-donut-total"><strong>{fmt(total)} ₽</strong><span>Всего</span></div>
        </div>
        <div className="overview-donut-legend">
          {data.map((item, index) => (
            <div key={item.name}>
              <i style={{ background: CATEGORY_COLORS[index % CATEGORY_COLORS.length] }} />
              <span title={item.name}>{item.name}</span>
              <strong>{total ? `${(item.value / total * 100).toFixed(1)}%` : '0%'}</strong>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function ProfitabilityTrend({ data }: { data: ReturnType<typeof chartRows> }) {
  return (
    <div className="mini-chart">
      <div className="mini-chart-header">
        <span className="mini-chart-label">Чистая прибыль и рентабельность</span>
      </div>
      <div className="mini-chart-area">
        <ResponsiveContainer width="100%" height={220}>
          <ComposedChart data={data} margin={{ top: 10, right: 4, left: 0, bottom: 4 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#E7ECF2" />
            <XAxis dataKey="date" tickFormatter={date => date.slice(5)} tick={{ fontSize: 9, fill: '#8A97A8' }} tickLine={false} />
            <YAxis yAxisId="rub" tickFormatter={value => fmt(Number(value))} tick={{ fontSize: 9, fill: '#8A97A8' }} tickLine={false} width={40} />
            <YAxis yAxisId="pct" orientation="right" tickFormatter={value => `${Number(value).toFixed(0)}%`} tick={{ fontSize: 9, fill: '#8A97A8' }} tickLine={false} width={32} />
            <Tooltip formatter={(value, name) => name === 'margin' ? [`${Number(value || 0).toFixed(1)}%`, 'Рентабельность'] : [`${fmt(Number(value || 0))} ₽`, 'Чистая прибыль']} labelFormatter={date => String(date)} />
            <Legend formatter={value => value === 'profit' ? 'Чистая прибыль' : 'Рентабельность'} wrapperStyle={{ fontSize: 10 }} />
            <Bar yAxisId="rub" dataKey="profit" fill="#B9E6D5" radius={[3, 3, 0, 0]} maxBarSize={18} />
            <Line yAxisId="pct" type="monotone" dataKey="margin" stroke="#10A778" strokeWidth={2.2} dot={false} activeDot={{ r: 4 }} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

function AdvertisingEfficiency({ data }: { data: ReturnType<typeof chartRows> }) {
  return (
    <div className="mini-chart">
      <div className="mini-chart-header">
        <span className="mini-chart-label">Расходы на рекламу и ДРР</span>
      </div>
      <div className="mini-chart-area">
        <ResponsiveContainer width="100%" height={220}>
          <ComposedChart data={data} margin={{ top: 10, right: 4, left: 0, bottom: 4 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#E7ECF2" />
            <XAxis dataKey="date" tickFormatter={date => date.slice(5)} tick={{ fontSize: 9, fill: '#8A97A8' }} tickLine={false} />
            <YAxis yAxisId="rub" tickFormatter={value => fmt(Number(value))} tick={{ fontSize: 9, fill: '#8A97A8' }} tickLine={false} width={40} />
            <YAxis yAxisId="pct" orientation="right" tickFormatter={value => `${Number(value).toFixed(0)}%`} tick={{ fontSize: 9, fill: '#8A97A8' }} tickLine={false} width={34} />
            <Tooltip formatter={(value, name) => name === 'drr' ? [`${Number(value || 0).toFixed(1)}%`, 'ДРР'] : [`${fmt(Number(value || 0))} ₽`, 'Расходы']} />
            <Legend formatter={value => value === 'adSpend' ? 'Расходы' : 'ДРР'} wrapperStyle={{ fontSize: 10 }} />
            <Bar yAxisId="rub" dataKey="adSpend" fill="#F6C84C" radius={[3, 3, 0, 0]} maxBarSize={18} />
            <Line yAxisId="pct" type="monotone" dataKey="drr" stroke="#10A778" strokeWidth={2.1} dot={false} activeDot={{ r: 4 }} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

interface MiniChartsProps {
  data: { date: string; values: Record<string, number> }[];
  categoryData: { name: string; value: number }[];
}

export default function MiniCharts({ data, categoryData }: MiniChartsProps) {
  const rows = useMemo(() => chartRows(data), [data]);
  return (
    <div className="mini-charts-row">
      <CategoryOrders data={categoryData} />
      <ProfitabilityTrend data={rows} />
      <AdvertisingEfficiency data={rows} />
    </div>
  );
}
