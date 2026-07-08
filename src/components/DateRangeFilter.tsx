import { useState, useRef, useEffect, forwardRef } from 'react';
import DatePicker, { registerLocale } from 'react-datepicker';
import { ru } from 'date-fns/locale/ru';
import type { DatePeriod } from '../data/mock';
import { addDays, daysBetween, toDate, toStr, rangeDisplay, fmtDate, monthToPeriod } from '../data/dateUtils';
import 'react-datepicker/dist/react-datepicker.css';

registerLocale('ru', ru);

interface Props {
  periodA: DatePeriod;
  periodB: DatePeriod;
  onChange: (a: DatePeriod, b: DatePeriod) => void;
  maxDate: string;
}

const PRESETS = [
  { value: 1, label: 'Вчера' },
  { value: 7, label: 'Неделя' },
  { value: 30, label: '30 дней' },
];

function getCalendarMonth(dateStr: string): DatePeriod {
  const d = toDate(dateStr);
  const month = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  return monthToPeriod(month);
}

function monthLabel(dateStr: string): string {
  const d = toDate(dateStr);
  return d.toLocaleDateString('ru-RU', { month: 'long', year: 'numeric' });
}

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

export default function DateRangeFilter({ periodA, periodB, onChange, maxDate }: Props) {
  if (DEV) console.log('[DateRangeFilter] render', { maxDate, periodA, periodB });
  const [open, setOpen] = useState(false);
  const [synced, setSynced] = useState(true);
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

  function calcSyncedPeriodB(nextA: DatePeriod): DatePeriod {
    const len = daysBetween(nextA.start, nextA.end);
    const bEnd = addDays(nextA.start, -1);
    const bStart = addDays(bEnd, -(len - 1));
    return { start: bStart, end: bEnd };
  }

  const apply = (nextA: DatePeriod) => {
    const nextB = synced ? calcSyncedPeriodB(nextA) : periodB;
    onChange(nextA, nextB);
  };

  const applyPreset = (p: number) => {
    const end = p === 1 ? addDays(maxDate, -1) : maxDate;
    const start = addDays(end, -(p - 1));
    if (DEV) console.log('[DateRangeFilter] applyPreset', { preset: p, maxDate, computed: { start, end } });
    apply({ start, end });
    setOpen(false);
  };

  const handleStartChange = (date: Date | null) => {
    if (!date) return;
    const start = toStr(date);
    const end = start > periodA.end ? start : periodA.end;
    if (DEV) console.log('[DateRangeFilter] handleStartChange', { raw: date.toString(), start, end, periodA });
    apply({ start, end });
  };

  const handleEndChange = (date: Date | null) => {
    if (!date) return;
    const end = toStr(date);
    const start = end < periodA.start ? end : periodA.start;
    if (DEV) console.log('[DateRangeFilter] handleEndChange', { raw: date.toString(), start, end, periodA });
    apply({ start, end });
  };

  const toggleSync = () => {
    if (synced) {
      setSynced(false);
    } else {
      setSynced(true);
      onChange(periodA, calcSyncedPeriodB(periodA));
    }
  };

  const applyCalendarMonth = () => {
    const cm = getCalendarMonth(maxDate);
    const nextB = synced ? calcSyncedPeriodB(cm) : periodB;
    onChange(cm, nextB);
    setOpen(false);
  };

  const isCalendarMonth = (() => {
    const d = toDate(maxDate);
    const month = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    const cm = monthToPeriod(month);
    return periodA.start === cm.start && periodA.end === cm.end;
  })();

  const presetActive = detectPreset(periodA);
  const startDate = toDate(periodA.start);
  const endDate = toDate(periodA.end);

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
          <span className="drf-trigger-current">{rangeDisplay(periodA)}</span>
          <span className="drf-trigger-vs">⚖️</span>
          <span className="drf-trigger-compare">{rangeDisplay(periodB)}</span>
        </button>

        <button className={`drf-sync ${synced ? 'active' : ''}`} onClick={toggleSync}
          title={synced ? 'Синхронизация включена' : 'Синхронизация выключена'}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M4 12a8 8 0 0 1 8-8 7.9 7.9 0 0 1 5.6 2.3L20 8" />
            <path d="M4 12a8 8 0 0 0 8 8 7.9 7.9 0 0 0 5.6-2.3L20 16" />
            <polyline points="16 5 20 5 20 9" />
            <polyline points="8 19 4 19 4 15" />
            {synced && <line x1="2" y1="2" x2="22" y2="22" className="drf-sync-x" />}
          </svg>
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
            <button
              className={`drf-popup-chip ${isCalendarMonth ? 'active' : ''}`}
              onClick={applyCalendarMonth}
            >
              {monthLabel(maxDate)}
            </button>
            <div className={`drf-popup-chip drf-popup-chip-custom ${presetActive === 0 && !isCalendarMonth ? 'active' : ''}`}>
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

          <div className="drf-popup-compare">
            <span className="drf-popup-compare-label">Сравнение:</span>
            <span className="drf-popup-compare-dates">
              {fmtDate(toDate(periodB.start))} – {fmtDate(toDate(periodB.end))}
            </span>
          </div>
          </div>
        )}
      </div>
    </div>
  );
}
