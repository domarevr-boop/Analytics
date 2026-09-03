import type { ReactNode } from 'react';

type Density = 'overview' | 'analytics' | 'data';
type Tone = 'positive' | 'negative' | 'neutral';

export function AnalyticsPageHeader({ eyebrow, title, description, meta, actions }: {
  eyebrow?: string;
  title: string;
  description: string;
  meta?: ReactNode;
  actions?: ReactNode;
}) {
  return <header className="ds-page-header">
    <div className="ds-page-heading">
      {eyebrow && <span className="ds-eyebrow">{eyebrow}</span>}
      <h1>{title}</h1>
      <p>{description}</p>
    </div>
    {(meta || actions) && <div className="ds-page-actions">{meta}{actions}</div>}
  </header>;
}

export function AnalyticsToolbar({ children, trailing, status }: { children: ReactNode; trailing?: ReactNode; status?: ReactNode }) {
  return <section className="ds-toolbar">
    <div className="ds-toolbar-main">{children}</div>
    {trailing && <div className="ds-toolbar-trailing">{trailing}</div>}
    {status && <div className="ds-toolbar-status">{status}</div>}
  </section>;
}

export function SegmentedControl<T extends string>({ value, options, onChange, label }: {
  value: T;
  options: Array<{ value: T; label: string }>;
  onChange: (value: T) => void;
  label: string;
}) {
  return <div className="ds-segmented" role="group" aria-label={label}>
    {options.map(option => <button type="button" key={option.value} className={value === option.value ? 'active' : ''} aria-pressed={value === option.value} onClick={() => onChange(option.value)}>{option.label}</button>)}
  </div>;
}

export function KpiTile({ label, value, delta, deltaSuffix = '%', comparison = 'к предыдущему периоду', tone = 'neutral', visual, details }: {
  label: string;
  value: ReactNode;
  delta?: ReactNode;
  deltaSuffix?: string;
  comparison?: string;
  tone?: Tone;
  visual?: ReactNode;
  details?: ReactNode;
}) {
  return <article className="ds-kpi">
    <span className="ds-kpi-label">{label}</span>
    <div className="ds-kpi-value-row"><strong>{value}</strong>{visual}</div>
    {delta !== undefined && <small className={`ds-delta ds-delta-${tone}`}>{tone === 'positive' ? '▲' : tone === 'negative' ? '▼' : '•'} {delta}{deltaSuffix} <em>{comparison}</em></small>}
    {details && <div className="ds-kpi-details">{details}</div>}
  </article>;
}

export function AnalyticsPanel({ children, className = '', density = 'analytics' }: { children: ReactNode; className?: string; density?: Density }) {
  return <section className={`ds-panel ds-density-${density}${className ? ` ${className}` : ''}`}>{children}</section>;
}

export function PanelHeader({ title, description, eyebrow, controls }: { title: string; description?: string; eyebrow?: string; controls?: ReactNode }) {
  return <header className="ds-panel-header">
    <div>{eyebrow && <span className="ds-eyebrow">{eyebrow}</span>}<h2>{title}</h2>{description && <p>{description}</p>}</div>
    {controls && <div className="ds-panel-controls">{controls}</div>}
  </header>;
}

export function EmptyState({ title, description, action }: { title: string; description: string; action?: ReactNode }) {
  return <section className="ds-empty" role="status">
    <span className="ds-empty-icon" aria-hidden="true">◇</span>
    <strong>{title}</strong>
    <p>{description}</p>
    {action}
  </section>;
}
