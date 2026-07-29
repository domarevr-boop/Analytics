import { useEffect, useRef, useState } from 'react';
import DatePicker, { registerLocale } from 'react-datepicker';
import { ru } from 'date-fns/locale/ru';
import type { DatePeriod } from '../data/mock';
import { addDays, fmtDate, rangeDisplay, toDate, toStr } from '../data/dateUtils';
import 'react-datepicker/dist/react-datepicker.css';

registerLocale('ru', ru);

interface Props {
  label: string;
  value: DatePeriod;
  onChange: (period: DatePeriod) => void;
  maxDate: string;
}

interface DatePreset {
  id: string;
  label: string;
  period: DatePeriod;
}

function getPresets(maxDate: string): DatePreset[] {
  const monthStart = `${maxDate.slice(0, 7)}-01`;
  const previousMonthEnd = addDays(monthStart, -1);
  const previousMonthStart = `${previousMonthEnd.slice(0, 7)}-01`;

  return [
    { id: 'last-day', label: 'Последний день', period: { start: maxDate, end: maxDate } },
    { id: '7-days', label: 'Последние 7 дней', period: { start: addDays(maxDate, -6), end: maxDate } },
    { id: '14-days', label: 'Последние 14 дней', period: { start: addDays(maxDate, -13), end: maxDate } },
    { id: '30-days', label: 'Последние 30 дней', period: { start: addDays(maxDate, -29), end: maxDate } },
    { id: 'current-month', label: 'Текущий месяц', period: { start: monthStart, end: maxDate } },
    { id: 'previous-month', label: 'Прошлый месяц', period: { start: previousMonthStart, end: previousMonthEnd } },
  ];
}

function samePeriod(left: DatePeriod, right: DatePeriod) {
  return left.start === right.start && left.end === right.end;
}

export default function DateRangeFilter({ label, value, onChange, maxDate }: Props) {
  const [open, setOpen] = useState(false);
  const [draftStart, setDraftStart] = useState<Date | null>(() => toDate(value.start));
  const [draftEnd, setDraftEnd] = useState<Date | null>(() => toDate(value.end));
  const popupRef = useRef<HTMLDivElement>(null);
  const presets = getPresets(maxDate);
  const activePreset = presets.find(preset => samePeriod(preset.period, value))?.id;

  useEffect(() => {
    if (!open) return;
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    const handleClick = (event: MouseEvent) => {
      if (popupRef.current && !popupRef.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('keydown', handleKey);
    document.addEventListener('mousedown', handleClick);
    return () => {
      document.removeEventListener('keydown', handleKey);
      document.removeEventListener('mousedown', handleClick);
    };
  }, [open]);

  const openPicker = () => {
    setDraftStart(toDate(value.start));
    setDraftEnd(toDate(value.end));
    setOpen(current => !current);
  };

  const selectPreset = (preset: DatePreset) => {
    setDraftStart(toDate(preset.period.start));
    setDraftEnd(toDate(preset.period.end));
  };

  const apply = () => {
    if (!draftStart || !draftEnd) return;
    onChange({ start: toStr(draftStart), end: toStr(draftEnd) });
    setOpen(false);
  };

  return (
    <div className="drf">
      <div className="drf-trigger-wrap">
        <button className={`drf-trigger${open ? ' active' : ''}`} type="button" onClick={openPicker}>
          <span className="drf-trigger-icon" aria-hidden="true">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
              <line x1="16" y1="2" x2="16" y2="6" />
              <line x1="8" y1="2" x2="8" y2="6" />
              <line x1="3" y1="10" x2="21" y2="10" />
            </svg>
          </span>
          <span className="drf-trigger-label">{label}</span>
          <span className="drf-trigger-current">{rangeDisplay(value)}</span>
        </button>

        {open && (
          <div className="drf-popup" ref={popupRef}>
            <aside className="drf-preset-list">
              <span className="drf-popup-eyebrow">Быстрый выбор</span>
              {presets.map(preset => {
                const selected = draftStart && draftEnd
                  && samePeriod(preset.period, { start: toStr(draftStart), end: toStr(draftEnd) });
                return (
                  <button
                    type="button"
                    key={preset.id}
                    className={selected ? 'active' : ''}
                    onClick={() => selectPreset(preset)}
                  >
                    {preset.label}
                    {activePreset === preset.id && <span>Текущий</span>}
                  </button>
                );
              })}
            </aside>
            <div className="drf-calendar-panel">
              <div className="drf-popup-header">
                <div>
                  <span className="drf-popup-eyebrow">{label}</span>
                  <strong>Выберите диапазон</strong>
                </div>
                <span>Данные по {fmtDate(toDate(maxDate))}</span>
              </div>
              <DatePicker
                inline
                selectsRange
                startDate={draftStart}
                endDate={draftEnd}
                onChange={dates => {
                  const [start, end] = dates;
                  setDraftStart(start);
                  setDraftEnd(end);
                }}
                maxDate={toDate(maxDate)}
                monthsShown={2}
                locale="ru"
                calendarStartDay={1}
              />
              <div className="drf-popup-footer">
                <div className="drf-selected-range">
                  <span>Выбранный период</span>
                  <strong>
                    {draftStart ? fmtDate(draftStart) : '—'}
                    {' — '}
                    {draftEnd ? fmtDate(draftEnd) : '—'}
                  </strong>
                </div>
                <div className="drf-popup-actions">
                  <button type="button" className="drf-cancel" onClick={() => setOpen(false)}>Отмена</button>
                  <button type="button" className="drf-apply" disabled={!draftStart || !draftEnd} onClick={apply}>Применить</button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
