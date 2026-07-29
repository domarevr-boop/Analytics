import { useMemo, useSyncExternalStore } from 'react';
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { ChartDataPoint } from '../hooks/useChartData';
import { getCabinets, getVersion, subscribe } from '../data/store';

interface ChartsBlockProps {
  data: ChartDataPoint[];
}

export default function ChartsBlock({ data }: ChartsBlockProps) {
  useSyncExternalStore(subscribe, getVersion);
  const cabinets = getCabinets();
  const rows = useMemo(() => data.map(point => ({
    date: point.date,
    ...Object.fromEntries(cabinets.map(cabinet => [cabinet.id, point.values[`cabinet_orders_${cabinet.id}`] || 0])),
  })), [data, cabinets]);
  const colors = ['#F0B429', '#2563EB', '#10A778', '#8B5CF6'];
  const fmt = (value: number) => Math.abs(value) >= 1_000_000 ? `${(value / 1_000_000).toFixed(1)}M` : `${Math.round(value / 1_000)}k`;

  return (
    <div className="charts-block">
      <div className="charts-toolbar">
        <span className="charts-toolbar-label">Сумма заказов по кабинетам</span>
      </div>
      <ResponsiveContainer width="100%" height={250}>
        <LineChart data={rows} margin={{ top: 8, right: 12, left: 2, bottom: 2 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#E7ECF2" />
          <XAxis dataKey="date" tickFormatter={date => String(date).slice(5)} tick={{ fontSize: 9, fill: '#8A97A8' }} tickLine={false} />
          <YAxis tickFormatter={value => fmt(Number(value))} tick={{ fontSize: 9, fill: '#8A97A8' }} tickLine={false} width={42} />
          <Tooltip formatter={(value, name) => [`${fmt(Number(value || 0))} ₽`, cabinets.find(cabinet => cabinet.id === name)?.name || String(name)]} />
          <Legend formatter={value => cabinets.find(cabinet => cabinet.id === value)?.name || value} wrapperStyle={{ fontSize: 10 }} />
          {cabinets.map((cabinet, index) => <Line key={cabinet.id} type="monotone" dataKey={cabinet.id} name={cabinet.id} stroke={colors[index % colors.length]} strokeWidth={2.1} dot={false} activeDot={{ r: 4 }} />)}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
