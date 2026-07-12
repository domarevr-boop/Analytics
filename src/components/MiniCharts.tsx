import { useMemo } from 'react';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, ResponsiveContainer, Tooltip } from 'recharts';

function fmt(n: number): string {
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (abs >= 1_000) return Math.round(n / 1_000).toLocaleString('ru-RU') + 'k';
  return Math.round(n).toLocaleString('ru-RU');
}

function MiniArea({ data, dataKey, color, label, formatter }: {
  data: { date: string; values: Record<string, number> }[];
  dataKey: string;
  color: string;
  label: string;
  formatter?: (n: number) => string;
}) {
  const chartData = useMemo(() => data.map(d => ({ date: d.date, value: d.values[dataKey] ?? 0 })), [data, dataKey]);
  const latest = chartData.length ? chartData[chartData.length - 1].value : 0;
  const first = chartData.length ? chartData[0].value : 0;
  const pct = first ? ((latest - first) / first * 100).toFixed(1) : null;

  return (
    <div className="mini-chart">
      <div className="mini-chart-header">
        <span className="mini-chart-label">{label}</span>
        <span className="mini-chart-val">{formatter ? formatter(latest) : fmt(latest)}</span>
        {pct !== null && (
          <span className={`mini-chart-pct ${+pct >= 0 ? 'up' : 'down'}`}>
            {+pct >= 0 ? '+' : ''}{pct}%
          </span>
        )}
      </div>
      <div className="mini-chart-area">
        <ResponsiveContainer width="100%" height={180}>
          <AreaChart data={chartData} margin={{ top: 8, right: 8, left: 8, bottom: 8 }}>
            <defs>
              <linearGradient id={`grad-${dataKey}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={color} stopOpacity={0.2} />
                <stop offset="100%" stopColor={color} stopOpacity={0.02} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
            <XAxis dataKey="date" tick={{ fontSize: 9, fill: '#9CA3AF' }} tickLine={false} axisLine={{ stroke: '#E5E7EB' }} tickFormatter={d => d.slice(5)} />
            <YAxis tick={{ fontSize: 9, fill: '#9CA3AF' }} tickLine={false} axisLine={{ stroke: '#E5E7EB' }} width={40} tickFormatter={n => fmt(Number(n))} />
            <Tooltip
              contentStyle={{ background: '#fff', border: '1px solid #E5E7EB', borderRadius: 6, fontSize: 11 }}
              labelFormatter={d => d}
              formatter={value => {
                const numericValue = Number(value ?? 0);
                return [formatter ? formatter(numericValue) : fmt(numericValue), label];
              }}
            />
            <Area type="monotone" dataKey="value" stroke={color} strokeWidth={2} fill={`url(#grad-${dataKey})`} dot={false} />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

interface MiniChartsProps {
  data: { date: string; values: Record<string, number> }[];
}

export default function MiniCharts({ data }: MiniChartsProps) {
  return (
    <div className="mini-charts-row">
      <MiniArea data={data} dataKey="profit" color="#10B981" label="Прибыль" />
      <MiniArea data={data} dataKey="margin" color="#F59E0B" label="Рентабельность" formatter={n => n.toFixed(1) + '%'} />
      <MiniArea data={data} dataKey="ad_spend" color="#EF4444" label="Расходы на рекламу" />
    </div>
  );
}
