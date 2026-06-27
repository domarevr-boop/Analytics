import { useState } from 'react';
import type { DatePeriod } from '../data/mock';

interface Props {
  periodA: DatePeriod;
  periodB: DatePeriod;
  onChange: (a: DatePeriod, b: DatePeriod) => void;
}

const PRESETS = [
  { value: 3, label: '3 дня' },
  { value: 7, label: '7 дней' },
  { value: 14, label: '14 дней' },
  { value: 30, label: '30 дней' },
  { value: 90, label: '90 дней' },
];

const CUSTOM_VALUE = 0;

function addDays(dateStr: string, days: number) {
  const d = new Date(dateStr);
  d.setDate(d.getDate() + days);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function detectPreset(p: DatePeriod): number {
  const s = new Date(p.start);
  const e = new Date(p.end);
  const len = Math.round((e.getTime() - s.getTime()) / 86400000) + 1;
  return PRESETS.find(pr => pr.value === len)?.value ?? CUSTOM_VALUE;
}

export default function DateRangeFilter({ periodA, periodB, onChange }: Props) {
  const [presetA, setPresetA] = useState(() => detectPreset(periodA));
  const [presetB, setPresetB] = useState(() => detectPreset(periodB));

  const handlePreset = (side: 'A' | 'B', p: number) => {
    if (p === CUSTOM_VALUE) {
      side === 'A' ? setPresetA(p) : setPresetB(p);
      return;
    }
    const period = side === 'A' ? periodA : periodB;
    const end = period.end;
    const start = addDays(end, -(p - 1));
    const next = { start, end };
    if (side === 'A') { setPresetA(p); onChange(next, periodB); }
    else { setPresetB(p); onChange(periodA, next); }
  };

  const handleStart = (side: 'A' | 'B', start: string) => {
    if (side === 'A') { setPresetA(CUSTOM_VALUE); onChange({ start, end: periodA.end }, periodB); }
    else { setPresetB(CUSTOM_VALUE); onChange(periodA, { start, end: periodB.end }); }
  };

  const handleEnd = (side: 'A' | 'B', end: string) => {
    const p = side === 'A' ? presetA : presetB;
    const period = side === 'A' ? periodA : periodB;
    if (p !== CUSTOM_VALUE) {
      const start = addDays(end, -(p - 1));
      const next = { start, end };
      if (side === 'A') onChange(next, periodB);
      else onChange(periodA, next);
    } else {
      if (side === 'A') onChange({ start: period.start, end }, periodB);
      else onChange(periodA, { start: period.start, end });
    }
  };

  const renderGroup = (label: string, period: DatePeriod, preset: number, side: 'A' | 'B') => (
    <div className="daterange-group">
      <span className="daterange-label">{label}</span>
      <select className="daterange-select" value={preset} onChange={e => handlePreset(side, Number(e.target.value))}>
        {PRESETS.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
        <option value={CUSTOM_VALUE}>Произвольно</option>
      </select>
      <input type="date" className="daterange-input" value={period.start} onChange={e => handleStart(side, e.target.value)} />
      <span className="daterange-sep">—</span>
      <input type="date" className="daterange-input" value={period.end} onChange={e => handleEnd(side, e.target.value)} />
    </div>
  );

  return (
    <div className="daterange">
      {renderGroup('Текущий:', periodA, presetA, 'A')}
      {renderGroup('Прошлый:', periodB, presetB, 'B')}
    </div>
  );
}
