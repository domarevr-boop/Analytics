---
name: design-system
description: Design rules, color palette, typography, component styles and layout conventions for Analytics MVP
license: MIT
compatibility: opencode
metadata:
  project: Analytics MVP
  palette: neutral-amber
---

## Color Palette

| Role | Hex | CSS Variable | Notes |
|------|-----|-------------|-------|
| Primary accent | `#FCD34D` | `--color-primary` | amber-300, buttons, active tabs |
| Primary hover | `#F6C23E` | `--color-primary-hover` | |
| Primary bg | `#FEF9C3` | `--color-primary-bg` | highlights, selected items |
| Navbar bg | `#3D3A35` | `--color-navbar-bg` | warm dark, top bar |
| Page bg | `#F5F5F5` | `--color-bg` | neutral light gray |
| Card bg | `#FFFFFF` | `--color-bg-white` | white cards |
| Text primary | `#1F2937` | `--color-text` | |
| Text secondary | `#6B7280` | `--color-text-secondary` | |
| Text muted | `#9CA3AF` | `--color-text-muted` / `--color-text-dim` | |
| Border | `#E5E7EB` | `--color-border` | card borders, table lines |
| Border light | `#F3F4F6` | `--color-border-light` | |
| Success | `#10B981` | `--color-success` | green up arrows, profit |
| Danger | `#EF4444` | `--color-danger` | red down arrows, ad_spend |
| Warning | `#F59E0B` | `--color-warning` | amber for margin chart |

## Typography

- **Body font:** Inter, 'Segoe UI', system-ui, sans-serif
- **Numbers:** JetBrains Mono, monospace (applied to: `.db-val`, `.at-mv`, `.at-mc`, `.mini-chart-val`, `.pt-num`, etc.)
- **Sizes:** body 14px, table 13px, small labels 10-11px, metric values 20px/15px/12px
- **Weights:** normal 400, medium 500, semibold 600, bold 700

## Spacing & Sizing

| Spacing | Value | Used For |
|---------|-------|----------|
| Card radius | 14px | `--radius-card` |
| Small radius | 10px | `--radius-sm` |
| Medium radius | 12px | `--radius-md`, popups |
| Card shadow | `0 1px 2px rgba(0,0,0,0.04), 0 6px 20px rgba(0,0,0,0.04)` | `--shadow-card` |
| Popup shadow | `0 8px 24px rgba(0,0,0,0.12)` | `--shadow-modal` |
| Page content padding | 24px 32px (1600px+: 20px 40px, 1100px-: 16px 20px) | |
| Card padding | 16px 20px (1600px+: 20px 24px) | |
| Gap between cards | 12px | |
| Max page width | 1640px | but not explicitly constrained — cards fill width |

## Components

### Navbar
- Height: 48px, bg: `#3D3A35`, flex row, space-between
- Logo: white, bold 15px
- Tabs: #D1D5DB, hover: white bg rgba(255,255,255,0.08), active: amber-300 bg + dark text
- Dropdown groups: position absolute, white bg, shadow, 4px padding
- Dropdown items: 13px, secondary text, hover bg #F5F5F5

### Cards (`.page-card`)
- White bg, 14px radius, shadow
- Full width with small margins from page-content padding
- Table card (`.page-card.table-card`): no padding, contains toolbar + table-container

### Tables
- `.at` — `width: max-content; min-width: 100%`, 13px
- Sticky header (`.at-th`): bg `var(--color-bg)`, uppercase 10px, sticky top
- Row hover: `#FAFAFA`
- Group headers (`.at-group`): bg `var(--color-bg)`, bold 11px
- Metric cells: right-aligned, secondary value + primary value with up/down % change
- Photo column: 30x30px thumbnails with fallback
- Plan column: progress bar (6px, amber fill), percent label, forecast
- Expand/collapse toggle: `+` / `−` in first column
- **DON'T use cold colors** for headers (`.at-th`, `.at-group`, `.pl-th`, `.profit-table th`) — use `var(--color-bg)` not blue/gray tones

### Charts (Recharts)
- TimeSeriesChart: 320px height, LineChart with legend + tooltip
- Mini charts: 180px height, 3 AreaCharts in flex row
- Line colors (in order): `#FCD34D`, `#10B981`, `#EF4444`, `#3B82F6`, `#8B5CF6`, `#F59E0B`, `#EC4899`, `#06B6D4`
- Mini chart colors: profit=#10B981, margin=#F59E0B, ad_spend=#EF4444
- Grid: `#E5E7EB`, dashed 3 3
- Axis ticks: 9-10px, `#9CA3AF`
- Tooltip: white bg, 8px radius, shadow
- Chart wrappers: explicit height with `overflow: visible; position: relative;` to avoid clipping

### Forms & Controls
- Filter selects: 28px height, 11px, border `var(--color-border)`, focus amber border
- Buttons: 28-32px height, 12-13px, border 1px solid `var(--color-border)`, hover bg #F0F0F0
- Primary button: amber bg + border
- Danger button: red text + border

### Filters (FilterBar)
- Layout: flex row, gap 6px, align center, height 36px
- Cabinet, Brand, Group: `<select>` elements
- SKU: `<input>` with autocomplete dropdown, 120-160px width
- Dropdown: white bg, shadow, max-height 240px, scrollable

## Layout

### Page Structure
```
.dashboard (min-height: 100vh, flex column, overflow-y: auto)
  ├── .navbar (48px, sticky top)
  └── .page-content (flex column, gap 12px, padding 24px 32px)
       ├── .page-card → DashboardBlock (summary cards)
       ├── .page-card.table-card → toolbar + table
       ├── .page-card → ChartsBlock (line chart)
       └── .page-card → MiniChartsBlock (3 area charts)
```

- Page scrolls naturally (`.dashboard` has `overflow-y: auto`)
- Each card at full natural height — no internal scrolling
- Table overflows horizontally (`.table-container overflow-x: auto`)
- Scrollbar: 8px, track #F0F0F0, thumb #9CA3AF

### Responsive Breakpoints
- `>= 1600px`: more horizontal padding (40px vs 32px)
- `<= 1100px`: less padding (20px vs 32px), navbar padding reduced

## Chart Data Logic
- `useChartData()` hook: filter by cabinet → brand → group → sku (sku = lowest level)
- Groups metrics by date, sums daily values, computes derived metrics (margin, ctr, drr, avg_price)
- Formatting: >= 1M → `(n/1M).toFixed(1) + 'M'`, >= 1k → `Math.round(n/1k) + 'k'`, else `Math.round(n).toLocaleString('ru-RU')`
- Percents (margin, ctr, drr, cr_order): `n.toFixed(1) + '%'`
