import { useState, useRef, useEffect } from 'react';

const METRICS = [
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
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  function toggle(key: string) {
    if (selected.includes(key)) {
      onChange(selected.filter(k => k !== key));
    } else {
      onChange([...selected, key]);
    }
  }

  return (
    <div className="msel" ref={ref}>
      <div className="msel-trigger" onClick={() => setOpen(v => !v)}>
        <span>{selected.length ? `${selected.length} метрики` : 'Метрики'}</span>
        <span className={`msel-arrow ${open ? 'open' : ''}`}>▾</span>
      </div>
      {open && (
        <div className="msel-popup">
          {METRICS.map(m => (
            <label key={m.key} className="msel-item">
              <input type="checkbox" checked={selected.includes(m.key)} onChange={() => toggle(m.key)} />
              {m.label}
            </label>
          ))}
        </div>
      )}
    </div>
  );
}
