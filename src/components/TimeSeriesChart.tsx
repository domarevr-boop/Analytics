import { useMemo } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';

const CHART_COLORS = ['#FCD34D', '#10B981', '#EF4444', '#3B82F6', '#8B5CF6', '#F59E0B', '#EC4899', '#06B6D4'];
const METRIC_LABELS: Record<string, string> = {
  orders: 'Заказы', revenue: 'Выручка', profit: 'Прибыль', margin: 'Рентабельность',
  ad_spend: 'Расходы на рекламу', impressions: 'Показы', clicks: 'Клики',
  ctr: 'CTR', carts: 'Корзины', cr_order: 'CR заказа', drr: 'DRR', avg_price: 'Средний чек',
};

interface TimeSeriesChartProps {
  data: { date: string; values: Record<string, number> }[];
  selectedMetrics: string[];
}

function fmt(n: number, key: string): string {
  if (key === 'ctr' || key === 'cr_order' || key === 'drr' || key === 'margin') return n.toFixed(1) + '%';
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (abs >= 1_000) return Math.round(n / 1_000).toLocaleString('ru-RU') + 'k';
  return Math.round(n).toLocaleString('ru-RU');
}

export default function TimeSeriesChart({ data, selectedMetrics }: TimeSeriesChartProps) {
  const chartData = useMemo(() => {
    return data.map(d => {
      const point: Record<string, string | number> = { date: d.date };
      for (const key of selectedMetrics) {
        point[key] = d.values[key] ?? 0;
      }
      return point;
    });
  }, [data, selectedMetrics]);

  if (!selectedMetrics.length) return <div className="chart-empty">Выберите метрики для отображения</div>;
  if (!chartData.length) return <div className="chart-empty">Нет данных за выбранный период</div>;

  return (
    <div className="ts-chart-wrap">
      <ResponsiveContainer width="100%" height={320}>
        <LineChart data={chartData} margin={{ top: 8, right: 16, left: 8, bottom: 8 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
          <XAxis
            dataKey="date"
            tick={{ fontSize: 10, fill: '#9CA3AF' }}
            tickLine={false}
            axisLine={{ stroke: '#E5E7EB' }}
            tickFormatter={d => d.slice(5)}
          />
          <YAxis
            tick={{ fontSize: 10, fill: '#9CA3AF' }}
            tickLine={false}
            axisLine={{ stroke: '#E5E7EB' }}
            width={60}
            tickFormatter={n => fmt(Number(n), selectedMetrics[0])}
          />
          <Tooltip
            contentStyle={{
              background: '#fff', border: '1px solid #E5E7EB',
              borderRadius: 8, fontSize: 12, boxShadow: '0 4px 12px rgba(0,0,0,0.08)',
            }}
            labelFormatter={d => {
              const date = new Date(d + 'T00:00:00');
              return date.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });
            }}
            formatter={(val: number, name: string) => [fmt(val, name), METRIC_LABELS[name] || name]}
          />
          <Legend
            wrapperStyle={{ fontSize: 12, paddingTop: 8 }}
            formatter={(value: string) => METRIC_LABELS[value] || value}
          />
          {selectedMetrics.map((key, i) => (
            <Line
              key={key}
              type="monotone"
              dataKey={key}
              stroke={CHART_COLORS[i % CHART_COLORS.length]}
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 4, strokeWidth: 1 }}
              connectNulls
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
