import { useState, useRef, useEffect, forwardRef } from 'react';
import DatePicker, { registerLocale } from 'react-datepicker';
import { ru } from 'date-fns/locale/ru';
import type { DatePeriod } from '../data/mock';
import { addDays, daysBetween, toDate, toStr, rangeDisplay, fmtDate } from '../data/dateUtils';
import 'react-datepicker/dist/react-datepicker.css';

registerLocale('ru', ru);

interface Props {
  label: string;
  value: DatePeriod;
  onChange: (p: DatePeriod) => void;
  maxDate: string;
}

const PRESETS = [
  { value: 1, label: 'Вчера' },
  { value: 7, label: 'Неделя' },
  { value: 30, label: 'Месяц' },
];

function detectPreset(p: DatePeriod): number {
  const len = daysBetween(p.start, p.end);
  return PRESETS.find(pr => pr.value === len)?.value ?? 0;
}

const DateBtn = forwardRef<HTMLButtonElement, { value?: string; onClick?: () => void; children: React.ReactNode }>(
  ({ children, onClick }, ref) => (
    <button className="drf-date-btn" type="button" onClick={onClick} ref={ref}>
      {children}
    </button>
  )
);

const DEV = import.meta.env.DEV;

export default function DateRangeFilter({ label, value, onChange, maxDate }: Props) {
  if (DEV) console.log('[DateRangeFilter] render', { label, maxDate, value });
  const [open, setOpen] = useState(false);
  const popupRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    const handleClick = (e: MouseEvent) => {
      if (popupRef.current && !popupRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('keydown', handleKey);
    document.addEventListener('mousedown', handleClick);
    return () => {
      document.removeEventListener('keydown', handleKey);
      document.removeEventListener('mousedown', handleClick);
    };
  }, [open]);

  const applyPreset = (p: number) => {
    const end = p === 1 ? addDays(maxDate, -1) : maxDate;
    const start = addDays(end, -(p - 1));
    if (DEV) console.log('[DateRangeFilter] applyPreset', { label, preset: p, maxDate, computed: { start, end } });
    onChange({ start, end });
    setOpen(false);
  };

  const handleStartChange = (date: Date | null) => {
    if (!date) return;
    const start = toStr(date);
    const end = start > value.end ? start : value.end;
    if (DEV) console.log('[DateRangeFilter] handleStartChange', { label, raw: date.toString(), start, end, value });
    onChange({ start, end });
  };

  const handleEndChange = (date: Date | null) => {
    if (!date) return;
    const end = toStr(date);
    const start = end < value.start ? end : value.start;
    if (DEV) console.log('[DateRangeFilter] handleEndChange', { label, raw: date.toString(), start, end, value });
    onChange({ start, end });
  };

  const presetActive = detectPreset(value);
  const startDate = toDate(value.start);
  const endDate = toDate(value.end);

  return (
    <div className="drf">
      <div className="drf-trigger-wrap">
        <button className="drf-trigger" type="button" onClick={() => setOpen(!open)}>
          <span className="drf-trigger-icon">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
              <line x1="16" y1="2" x2="16" y2="6" />
              <line x1="8" y1="2" x2="8" y2="6" />
              <line x1="3" y1="10" x2="21" y2="10" />
            </svg>
          </span>
          <span className="drf-trigger-label">{label}:</span>
          <span className="drf-trigger-current">{rangeDisplay(value)}</span>
        </button>

        {open && (
          <div className="drf-popup" ref={popupRef}>
          <div className="drf-popup-presets">
            {PRESETS.map(p => (
              <button
                key={p.value}
                className={`drf-popup-chip ${presetActive === p.value ? 'active' : ''}`}
                onClick={() => applyPreset(p.value)}
              >
                {p.label}
              </button>
            ))}
            <div className={`drf-popup-chip drf-popup-chip-custom ${presetActive === 0 ? 'active' : ''}`}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 20h9" /><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
              </svg>
            </div>
          </div>

          <div className="drf-popup-dates">
            <div className="drf-date-field">
              <span className="drf-date-field-label">От</span>
              <DatePicker
                selected={startDate}
                onChange={handleStartChange}
                locale="ru"
                dateFormat="d MMM yyyy"
                popperPlacement="bottom-start"
                customInput={<DateBtn>{fmtDate(startDate)}</DateBtn>}
              />
            </div>
            <div className="drf-date-field">
              <span className="drf-date-field-label">До</span>
              <DatePicker
                selected={endDate}
                onChange={handleEndChange}
                locale="ru"
                dateFormat="d MMM yyyy"
                popperPlacement="bottom-start"
                customInput={<DateBtn>{fmtDate(endDate)}</DateBtn>}
              />
            </div>
          </div>
          </div>
        )}
      </div>
    </div>
  );
}
