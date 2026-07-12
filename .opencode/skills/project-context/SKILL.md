---
name: project-context
description: Track project architecture, current stage, what's done and what's planned for the Analytics MVP
license: MIT
compatibility: opencode
metadata:
  project: Analytics MVP
  version: v3.0
---

## Project Goal
- Maintain local-only MVP with IndexedDB storage, warm/amber palette, card-based layout with charts dashboard
- Deployed via GitHub Pages at https://domarevr-boop.github.io/Analytics/

## Tech Stack
- Frontend: React 19, Vite, TypeScript
- Charts: Recharts
- Storage: IndexedDB via custom repository (`src/database/db.ts`)
- Auth: Supabase email auth (`src/auth/auth.ts`)
- Deployment: GitHub Pages (gh-pages branch)

## Key Architecture

### Data Flow
1. CSV import → `parseFile.ts` with column mapping → `store.ts:importMappedData()`
2. Store keeps in-memory arrays (`_metrics`, `_products`, `_cabinets`, etc.) + persists to IndexedDB
3. UI subscribes via `useSyncExternalStore(subscribe, getVersion)`
4. `getTableData()` in `mock.ts` generates hierarchical table rows (cabinet → group → brand → product)

### Key Files
| File | Purpose |
|------|---------|
| `src/App.tsx` | Root component, routing by PageName, filter state, period state |
| `src/App.css` | All styling (~2800 lines): layout, cards, tables, charts, responsive |
| `src/components/NavBar.tsx` | Dark warm navbar with dropdown groups (Аналитика ▾, Бизнес-метрики ▾) |
| `src/components/FilterBar.tsx` | Cabinet/brand/group selects + SKU search input |
| `src/components/AnalyticsTable.tsx` | Main data table with hierarchy, mini bar charts, plans |
| `src/components/DateRangeFilter.tsx` | Single-period date filter, used twice (Период + Сравнение) |
| `src/components/ChartsBlock.tsx` | Line chart with metric multi-select |
| `src/components/MiniChartsBlock.tsx` | 3 area charts (profit, margin, ad_spend) |
| `src/hooks/useChartData.ts` | Shared hook: filter metrics by period/cabinet/brand/group/sku → daily aggregates |
| `src/data/store.ts` | In-memory store, CRUD, import logic, migrations v1-v3 |
| `src/data/parseFile.ts` | CSV parser with column mapping |
| `src/data/mock.ts` | `getTableData()`, `getHierarchy()`, `getDefaultPeriods()`, plan utilities |
| `src/components/DashboardBlock.tsx` | Top summary cards (orders, revenue, profit, margin, etc.) — separate universe, DON'T MODIFY |

## Current Stage: v3.0

### ✅ Done
- NavBar with dropdown groups (Аналитика ▾, Бизнес-метрики ▾) and dark warm bg #3D3A35
- 3 stub pages: FunnelPage, EntryPointsPage, SearchPhrasesPage
- Palette: neutral grays bg #F5F5F5 + amber-300 #FCD34D primary, warm dark navbar #3D3A35
- Recharts + chart components: TimeSeriesChart (line, 320px), MiniCharts (3 area, 180px), ChartsBlock, MiniChartsBlock
- Page-level scrolling (min-height: 100vh + overflow-y: auto on .dashboard)
- DateRangeFilter split into Период + Сравнение, no auto-reset
- `fmtCell` fixed: UTC getters → local getters
- SKU `<select>` replaced with search input in FilterBar

### ❌ Bugs / Issues
1. **UTC date shift** (`store.ts:migration v1`) — dates imported before fix are shifted -1 day. Migration detection flawed. Blocked.
2. **Group filter** — `matchGroup` in `AnalyticsTable.tsx:visible` only checks `row.id === groupFilter`, children of group are excluded. Partially fixed with `groupRowIds.has(row.parent)`.
3. **SKU filter** — search input added, but filtering logic in table not fully working. Children/parents not resolved correctly when skuFilter is set.
4. **Migration v3** — `localStorage.removeItem('_opencode_migrated_v1')` then refresh to re-run migration.

### 📋 Planned (current priority)
1. Fix group + SKU filter logic in AnalyticsTable
2. MVP FunnelPage (funnel visualization, period comparison)
3. MVP EntryPointsPage (top products by metrics, sortable)
4. MVP SearchPhrasesPage (requires xway import with search phrases)
5. Finalize PlanningPage (import/export, progress bars vs actuals)
6. Finalize ProfitabilityPage (overhead costs, net profit calculation)

### Key Decisions
- Two independent date panels (not combined with sync) — user preference
- Warm+amber after user testing → neutral grays after warm deemed "too saturated"
- Dark warm navbar over cool gray to maintain palette unity
- Charts split into 2 page-cards to avoid flex height conflicts with ResponsiveContainer
- Charts use ResponsiveContainer with explicit parent heights (320px, 180px)
- DashboardBlock is a separate universe — do NOT modify it or pass filters to it

## Critical Context
- `parseFile.ts:86-94` — `fmtCell` uses local getters (not UTC). Existing data needs migration v3 to fix shifted dates.
- Migration v3 flag: `localStorage.removeItem('_opencode_migrated_v1')` in console to re-run
- CDN cache on GitHub Pages may delay updates by 1-5 minutes despite `--no-history` force pushes
- ChartsBlock filters metrics by date range + cabinet/brand/group/sku, groups by date, sums per day
- Selected metrics persist in local state via `useState(['orders'])`
