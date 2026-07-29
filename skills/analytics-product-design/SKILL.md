---
name: analytics-product-design
description: Audit, design, and improve dense analytics dashboards, data tables, filters, KPI cards, navigation, and responsive states. Use for any Analytics MVP UI, UX, CSS, design-system, layout, visual hierarchy, or interaction change, especially when modernizing filters and data-heavy pages while preserving business logic.
---

# Analytics Product Design

Design a modern, dense, decision-oriented analytics interface without copying a reference literally.

## Establish context

1. Read `AGENTS.md`, `docs/VERSIONS.md`, the active version document, and `docs/ROADMAP.md`.
2. If `docs/DESIGN_SYSTEM.md` exists, treat it as the canonical project design source.
3. Read [references/audit-checklist.md](references/audit-checklist.md) before a broad audit.
4. Inspect the live page with the browser when authentication and runtime permit it; otherwise inspect components and styles and state the limitation.
5. Inspect user-provided references visually. Extract structural principles, not brand styling.

## Work in this order

1. Identify the user task, page context, primary data, and primary action.
2. Audit hierarchy, density, navigation, filters, tables, feedback states, responsiveness, and accessibility.
3. Separate systemic issues from local polish.
4. Propose the smallest reusable pattern that resolves the systemic issue.
5. Preserve data logic and behavior unless the request explicitly changes them.
6. Implement tokens and shared components before page-specific overrides.
7. Validate loading, empty, error, active, hover, focus, disabled, and narrow-screen states.
8. Run the most focused lint/build checks available and inspect the rendered result.
9. Update `docs/DESIGN_SYSTEM.md` whenever a general design rule changes.
10. Update this skill when its workflow, guardrails, or required references change.
11. Update active-version documentation and deploy when the project requires deployment.

## Design guardrails

- Prefer contextual data toolbars over rows of unrelated controls.
- Keep primary filters visible; place rare filters behind progressive disclosure.
- Show active-filter chips, result count, and contextual reset.
- Keep period controls visually distinct from entity filters.
- Use one range popover with quick presets, a calendar, draft state, and explicit apply/cancel actions for analytical periods.
- Show two calendar months on wide screens and one on narrow screens.
- Show KPI completion with a restrained progress indicator; avoid using a full card border as the only progress signal.
- On overview dashboards, give four primary decision KPIs stronger weight and move supporting metrics into a compact secondary strip.
- Treat category summary cards as navigation: selecting one must update the table and overview charts through the same filter state.
- Keep the overview sequence stable: primary KPI, category navigation, contextual toolbar, hierarchy table, then linked charts.
- Show data freshness and export near the overview context rather than inside the table.
- Keep a selected KPI visibly active and make a repeated click reverse its linked table and chart state.
- Differentiate cabinet, group, and product rows with subtle neutral hierarchy, not saturated fills.
- Use one product cell for image, title, SKU, and secondary identifiers.
- Do not repeat the seller SKU as both the product title and identifier chip when no distinct product name exists.
- Keep dense table grid lines quiet; reserve stronger separators for hierarchy and metric-group boundaries.
- Let users choose visible table metrics and persist the preference when the table is used repeatedly.
- Align numeric columns right and text columns left.
- Prefer neutral borders and surfaces over excessive shadows and nested cards.
- Use color for actions and meaning, not decoration.
- Keep compact controls usable: preserve readable text, visible focus, and reliable hit areas.
- Do not redesign multiple page families before validating the pattern on one representative page.
- Do not introduce a new design library without an explicit need.
- For dense time-series analytics, prefer an analytical-sheet pattern: compact KPI strip followed by sectioned metric-by-time matrices sharing one date axis.
- In a metric-by-time matrix, keep metric name, sparkline, and period delta sticky before the date columns.
- Normalize heatmap colors within each metric row by default; never compare unrelated units through one global color scale.
- Make heatmap direction semantic: lower expenses, DRR, delivery time, cancellations, and similar cost/risk metrics may be positive.
- Preserve exact values inside heatmap cells; color is a reading aid, not the only encoding.
- Keep inline sparklines axis-free, locally scaled, and tied to the same visible period as the row cells.
- Use compact analytical radii: 10px KPI, 12px section, 6–8px control, 2–4px heatmap cell.
- Use the spacing scale 4/6/8/12/16/20/24 and tabular numerals for dense analytical values.
- Distinguish selection, weekends, incomplete dates, and performance through separate visual channels.

## Reference handling

When a reference resembles XWay:

- Borrow information architecture, toolbar grouping, table density, and progressive disclosure.
- Do not copy logos, proprietary labels, exact colors, or distinctive branded assets.
- Reconcile the reference with the canonical project design document.

When a reference resembles a dense analytical matrix:

- Extract the shared date axis, section grouping, compact KPI anatomy, local heatmap normalization, row sparklines, and sticky context columns.
- Do not copy exact colors blindly; preserve semantic direction and accessible text contrast.
- Decide first whether the page is entity-oriented or metric-over-time oriented. Apply a matrix only to the latter.
- Read `references/dense-analytical-matrix.md` before implementing the pattern.

## Expected output

For audits, provide:

- strengths worth preserving;
- systemic weaknesses ordered by impact;
- proposed target structure;
- phased implementation plan;
- risks and validation criteria.

For implementation, produce focused code changes plus updated design/version documentation.
