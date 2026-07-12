import { useState } from 'react';
import type { ChartDataPoint } from '../hooks/useChartData';
import MetricMultiSelect from './MetricMultiSelect';
import TimeSeriesChart from './TimeSeriesChart';

interface ChartsBlockProps {
  data: ChartDataPoint[];
}

export default function ChartsBlock({ data }: ChartsBlockProps) {
  const [selectedMetrics, setSelectedMetrics] = useState<string[]>(['orders']);

  return (
    <div className="charts-block">
      <div className="charts-toolbar">
        <span className="charts-toolbar-label">Графики</span>
        <MetricMultiSelect selected={selectedMetrics} onChange={setSelectedMetrics} />
      </div>
      <TimeSeriesChart data={data} selectedMetrics={selectedMetrics} />
    </div>
  );
}
