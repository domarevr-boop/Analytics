import { useState, useRef, useEffect } from 'react';

export interface MetricOption {
  key: string;
  label: string;
}

const ALL_METRICS: MetricOption[] = [
  { key: 'orders', label: 'Заказы' },
  { key: 'revenue', label: 'Выручка' },
  { key: 'profit', label: 'Прибыль' },
  { key: 'margin', label: 'Рентабельность' },
  { key: 'ad_spend', label: 'Расходы на рекламу' },
  { key: 'impressions', label: 'Показы' },
  { key: 'clicks', label: 'Клики' },
  { key: 'ctr', label: 'CTR' },
  { key: 'carts', label: 'Корзины' },
  { key: 'cr_order', label: 'CR заказа' },
  { key: 'drr', label: 'DRR' },
  { key: 'avg_price', label: 'Средний чек' },
];

interface MetricMultiSelectProps {
  selected: string[];
  onChange: (keys: string[]) => void;
}

export default function MetricMultiSelect({ selected, onChange }: MetricMultiSelectProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  const toggle = (key: string) => {
    if (selected.includes(key)) {
      if (selected.length > 1) onChange(selected.filter(k => k !== key));
    } else {
      onChange([...selected, key]);
    }
  };

  const label = selected.length === 1
    ? ALL_METRICS.find(m => m.key === selected[0])?.label || selected[0]
    : `Метрики: ${selected.length}`;

  return (
    <div className="msel" ref={ref}>
      <button className="msel-trigger" onClick={() => setOpen(!open)}>
        <span>{label}</span>
        <svg className={`msel-arrow ${open ? 'open' : ''}`} width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>
      {open && (
        <div className="msel-popup">
          {ALL_METRICS.map(m => (
            <label key={m.key} className="msel-item">
              <input type="checkbox" checked={selected.includes(m.key)} onChange={() => toggle(m.key)} />
              <span>{m.label}</span>
            </label>
          ))}
        </div>
      )}
    </div>
  );
}
