import { useMemo, useState } from 'react';
import Russia from '@react-map/russia';
import { getRussiaRegionCode, getRussiaRegionName, RUSSIA_REGION_CODE_LIST, type RussiaRegionCode } from '../data/russiaRegions';

export interface RussiaMapAreaRow {
  area: string;
  district: string;
  value: number | null;
  orders: number;
  orderedAmount: number;
  deliveryHours: number | null;
  netProfitShare: number | null;
  orderedAmountShare: number;
}

interface RussiaMetricMapProps {
  rows: RussiaMapAreaRow[];
  metricLabel: string;
  formatValue: (value: number | null) => string;
  inverse?: boolean;
  diverging?: boolean;
  onAreaSelect: (area: string) => void;
}

const sequentialColors = ['#e8f1fb', '#d8f1ec', '#b8e7dc', '#79d3bd', '#18ad83'];

function quantile(values: number[], ratio: number) {
  if (values.length === 0) return 0;
  const index = Math.min(values.length - 1, Math.max(0, Math.round((values.length - 1) * ratio)));
  return values[index];
}

function findCodeFromTarget(target: EventTarget | null) {
  if (!(target instanceof SVGPathElement)) return null;
  const id = target.id;
  return RUSSIA_REGION_CODE_LIST.find(code => id.startsWith(`${code}-`)) || null;
}

export default function RussiaMetricMap({ rows, metricLabel, formatValue, inverse = false, diverging = false, onAreaSelect }: RussiaMetricMapProps) {
  const [hoveredCode, setHoveredCode] = useState<RussiaRegionCode | null>(null);
  const [pointer, setPointer] = useState({ x: 0, y: 0 });
  const rowByCode = useMemo(() => {
    const result = new Map<RussiaRegionCode, RussiaMapAreaRow>();
    rows.forEach(row => {
      const code = getRussiaRegionCode(row.area);
      if (code) result.set(code, row);
    });
    return result;
  }, [rows]);
  const values = useMemo(() => rows.map(row => row.value).filter((value): value is number => value !== null && Number.isFinite(value)).sort((left, right) => left - right), [rows]);
  const positiveValues = useMemo(() => values.filter(value => value >= 0), [values]);
  const negativeFloor = useMemo(() => Math.min(...values.filter(value => value < 0), -1), [values]);
  const thresholds = useMemo(() => [0.2, 0.4, 0.6, 0.8].map(ratio => quantile(positiveValues, ratio)), [positiveValues]);
  const cityColors = useMemo(() => {
    const colors: Record<string, string> = {};
    rowByCode.forEach((row, code) => {
      if (row.value === null || !Number.isFinite(row.value)) return;
      if (diverging && row.value < 0) {
        const intensity = Math.min(1, Math.abs(row.value / negativeFloor));
        colors[code] = intensity > 0.66 ? '#ef6b6b' : intensity > 0.33 ? '#f6a7a7' : '#fbd2d2';
        return;
      }
      let bucket = thresholds.findIndex(threshold => row.value! <= threshold);
      if (bucket < 0) bucket = sequentialColors.length - 1;
      if (inverse) bucket = sequentialColors.length - 1 - bucket;
      colors[code] = sequentialColors[bucket];
    });
    return colors;
  }, [diverging, inverse, negativeFloor, rowByCode, thresholds]);
  const hoveredRow = hoveredCode ? rowByCode.get(hoveredCode) : null;
  const unmatched = rows.filter(row => !getRussiaRegionCode(row.area));

  return (
    <div className="russia-metric-map">
      <div
        className="russia-metric-map-stage"
        role="img"
        aria-label={`Карта субъектов России: ${metricLabel}`}
        onMouseMove={event => {
          const code = findCodeFromTarget(event.target);
          const bounds = event.currentTarget.getBoundingClientRect();
          setHoveredCode(code);
          setPointer({ x: event.clientX - bounds.left, y: event.clientY - bounds.top });
        }}
        onMouseLeave={() => setHoveredCode(null)}
      >
        <Russia
          type="select-single"
          size={900}
          mapColor="#eef2f6"
          strokeColor="#ffffff"
          strokeWidth={0.8}
          hoverColor="#f8cc54"
          selectColor="#f4b91f"
          cityColors={cityColors}
          onSelect={code => {
            if (!code) return;
            const row = rowByCode.get(code as RussiaRegionCode);
            if (row) onAreaSelect(row.area);
          }}
        />
        {hoveredCode && <div className="russia-map-tooltip" style={{ left: pointer.x + 14, top: pointer.y + 14 }}>
          <strong>{hoveredRow?.area || getRussiaRegionName(hoveredCode)}</strong>
          {hoveredRow ? <>
            <span>{metricLabel}: <b>{formatValue(hoveredRow.value)}</b></span>
            <small>{hoveredRow.district}</small>
            <small>{hoveredRow.orders.toLocaleString('ru-RU')} заказов · {hoveredRow.orderedAmount.toLocaleString('ru-RU', { maximumFractionDigits: 0 })} ₽</small>
          </> : <span>Нет данных в выбранном срезе</span>}
        </div>}
      </div>
      <div className="russia-map-scale">
        <span><i style={{ background: '#eef2f6' }} />Нет данных</span>
        {sequentialColors.map((color, index) => <span key={color}><i style={{ background: color }} />{index === 0 ? 'Ниже' : index === sequentialColors.length - 1 ? 'Выше' : ''}</span>)}
        {diverging && <span><i style={{ background: '#ef6b6b' }} />Отрицательное значение</span>}
      </div>
      {unmatched.length > 0 && <div className="russia-map-unmatched"><b>Вне карты:</b> {unmatched.map(row => row.area).join(', ')}</div>}
    </div>
  );
}
