import { useMemo, useState } from 'react';
import Russia from '@react-map/russia';
import { getRussiaRegionCode, getRussiaRegionName, RUSSIA_REGION_CODE_LIST, type RussiaRegionCode } from '../data/russiaRegions';
import { geographyHeatColor, geographyHeatColors } from '../pages/analytics/geographyCalculations';

export interface RussiaMapAreaRow {
  area: string;
  district: string;
  value: number | null;
  orders: number;
  orderedAmount: number | null;
  deliveryHours: number | null;
  netProfitShare: number | null;
  orderedAmountShare: number | null;
}

interface RussiaMetricMapProps {
  rows: RussiaMapAreaRow[];
  metricLabel: string;
  formatValue: (value: number | null) => string;
  inverse?: boolean;
  contextLabel?: string;
  onAreaSelect: (area: string) => void;
}

function findCodeFromTarget(target: EventTarget | null) {
  if (!(target instanceof SVGPathElement)) return null;
  const id = target.id;
  return RUSSIA_REGION_CODE_LIST.find(code => id.startsWith(`${code}-`)) || null;
}

export default function RussiaMetricMap({ rows, metricLabel, formatValue, inverse = false, contextLabel, onAreaSelect }: RussiaMetricMapProps) {
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
  const minimum = values[0] ?? 0;
  const maximum = values.at(-1) ?? 0;
  const cityColors = useMemo(() => {
    const colors: Record<string, string> = {};
    rowByCode.forEach((row, code) => {
      if (row.value === null || !Number.isFinite(row.value)) return;
      const color = geographyHeatColor(row.value, minimum, maximum, inverse);
      if (color) colors[code] = color;
    });
    return colors;
  }, [inverse, maximum, minimum, rowByCode]);
  const hoveredRow = hoveredCode ? rowByCode.get(hoveredCode) : null;
  const unmatched = rows.filter(row => !getRussiaRegionCode(row.area));

  return (
    <div className="russia-metric-map">
      <div
        className="russia-metric-map-stage"
        role="img"
        aria-label={`Карта субъектов России: ${metricLabel}${contextLabel ? `, ${contextLabel}` : ''}`}
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
            <small>{hoveredRow.orders.toLocaleString('ru-RU')} заказов{hoveredRow.orderedAmount === null ? '' : ` · ${hoveredRow.orderedAmount.toLocaleString('ru-RU', { maximumFractionDigits: 0 })} ₽`}</small>
          </> : <span>Нет данных в выбранном срезе</span>}
        </div>}
      </div>
      <div className="russia-map-scale">
        <span><i style={{ background: '#eef2f6' }} />Нет данных</span>
        <span className="russia-map-gradient" style={{ background: inverse
          ? `linear-gradient(90deg, ${geographyHeatColors.high}, ${geographyHeatColors.middle}, ${geographyHeatColors.low})`
          : `linear-gradient(90deg, ${geographyHeatColors.low}, ${geographyHeatColors.middle}, ${geographyHeatColors.high})` }} />
        <span>{inverse ? 'Меньше · лучше' : 'Меньше'}</span>
        <span>Средне</span>
        <span>{inverse ? 'Больше · хуже' : 'Больше'}</span>
      </div>
      {unmatched.length > 0 && <div className="russia-map-unmatched"><b>Вне карты:</b> {unmatched.map(row => row.area).join(', ')}</div>}
    </div>
  );
}
