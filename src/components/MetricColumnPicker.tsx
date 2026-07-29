import { useEffect, useRef, useState } from 'react';
import {
  TABLE_METRIC_GROUPS,
  TABLE_METRIC_LABELS,
  type TableMetricKey,
} from './AnalyticsTable';

interface Props {
  selected: TableMetricKey[];
  onChange: (metrics: TableMetricKey[]) => void;
}

const ALL_METRICS = TABLE_METRIC_GROUPS.flatMap(group => [...group.keys]);
const CORE_METRICS: TableMetricKey[] = ['fact_orders', 'orders', 'avg_price', 'profit', 'margin', 'revenue'];

export default function MetricColumnPicker({ selected, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const selectedSet = new Set(selected);

  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [open]);

  const toggle = (metric: TableMetricKey) => {
    if (selectedSet.has(metric)) {
      if (selected.length === 1) return;
      onChange(selected.filter(key => key !== metric));
      return;
    }
    onChange(ALL_METRICS.filter(key => selectedSet.has(key) || key === metric));
  };

  const toggleGroup = (metrics: readonly TableMetricKey[]) => {
    const groupSelected = metrics.every(metric => selectedSet.has(metric));
    if (groupSelected) {
      const next = selected.filter(metric => !metrics.includes(metric));
      if (next.length > 0) onChange(next);
      return;
    }
    onChange(ALL_METRICS.filter(metric => selectedSet.has(metric) || metrics.includes(metric)));
  };

  return (
    <div className="metric-picker" ref={ref}>
      <button
        type="button"
        className={`metric-picker-trigger${open ? ' active' : ''}`}
        onClick={() => setOpen(value => !value)}
      >
        Метрики
        <span>{selected.length}</span>
      </button>
      {open && (
        <div className="metric-picker-popover">
          <div className="metric-picker-header">
            <strong>Колонки таблицы</strong>
            <span>Минимум одна метрика</span>
          </div>
          <div className="metric-picker-presets">
            <button type="button" onClick={() => onChange(CORE_METRICS)}>Основные</button>
            <button type="button" onClick={() => onChange(ALL_METRICS)}>Все метрики</button>
          </div>
          <div className="metric-picker-groups">
            {TABLE_METRIC_GROUPS.map(group => {
              const checked = group.keys.every(metric => selectedSet.has(metric));
              const partial = !checked && group.keys.some(metric => selectedSet.has(metric));
              return (
                <div className="metric-picker-group" key={group.label}>
                  <label className="metric-picker-group-title">
                    <input
                      type="checkbox"
                      checked={checked}
                      ref={input => {
                        if (input) input.indeterminate = partial;
                      }}
                      onChange={() => toggleGroup(group.keys)}
                    />
                    <span>{group.label}</span>
                  </label>
                  <div className="metric-picker-options">
                    {group.keys.map(metric => (
                      <label key={metric}>
                        <input
                          type="checkbox"
                          checked={selectedSet.has(metric)}
                          onChange={() => toggle(metric)}
                        />
                        <span>{TABLE_METRIC_LABELS[metric]}</span>
                      </label>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
