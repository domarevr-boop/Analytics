import type { ChartDataPoint } from '../hooks/useChartData';
import MiniCharts from './MiniCharts';

interface MiniChartsBlockProps {
  data: ChartDataPoint[];
}

export default function MiniChartsBlock({ data }: MiniChartsBlockProps) {
  return (
    <div className="mini-charts-block">
      <MiniCharts data={data} />
    </div>
  );
}
