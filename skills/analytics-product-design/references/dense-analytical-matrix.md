# Dense analytical matrix

Use this pattern for repeated analysis of many metrics over one shared time axis.

## Page anatomy

1. Compact KPI strip, normally 66–80px high.
2. Context filters associated with the whole sheet.
3. White section cards grouped by business meaning.
4. Each section contains metric rows and the same date columns.

## Metric row anatomy

1. Metric label.
2. Axis-free sparkline for the visible period.
3. Signed delta with an explicit comparison horizon.
4. Exact values by date.

Keep the first three columns sticky. A working row is normally 20–24px high.
Keep each time column at a fixed width immediately after this sticky context. A short period must not stretch across the available page width; leave neutral space on the right instead.

## Heatmap modes

Default: normalize values inside one metric row. Use a soft diverging scale with a neutral dead zone. Apply semantic direction before color mapping.

Optional: normalize one date column across comparable entities. Label this mode explicitly and never mix it with row normalization.

Do not normalize currency, counts, percentages, and durations together.

## Inline charts

- Size: 44–64px wide, 14–20px high.
- Stroke: 1–1.5px.
- No axes, grid, legend, or persistent points.
- Local Y range by default; zero-based only when zero is analytically meaningful.
- Same filters and visible dates as the matrix cells.

## Tokens

- Page gap: 10–12px.
- Section padding: 10–14px.
- KPI gap: 8px.
- KPI radius: 10px.
- Section radius: 12px.
- Control radius: 6–8px.
- Cell radius: 2–4px.
- Numeric text: 9–11px with tabular numerals.
- Header/support text: 7–9px.

## Interaction

- Sticky metric context during horizontal scroll.
- Exact-value tooltip with date, delta, and color rationale.
- Separate indicators for selection, current date, weekends, and incomplete data.
- Row hover must not overwrite semantic heatmap color.
- Empty and one-point rows use neutral states.

## Avoid

- Large card padding around every row.
- Global heatmap scaling across unrelated units.
- Saturated red and green backgrounds behind small text.
- Sparklines that use a different period than the visible cells.
- Repeating the same insight in KPI, large chart, sparkline, and heatmap without a distinct purpose.
