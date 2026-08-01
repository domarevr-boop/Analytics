# UI Components

This document defines the reusable visual contracts for analytical controls. Business pages may vary in data and composition, but the same control must not receive a new local visual language.

## Period Filters

- Use `DateRangeFilter` for analytical date ranges.
- Primary and comparison periods are separate controls placed in one `.date-filters` group.
- When the primary period changes, comparison defaults to the immediately preceding period of equal length.
- Comparison remains editable after the automatic update.
- Both triggers use the same height, border, radius, typography, focus state, and calendar popover as Dashboard.

## Select Controls

- Base analytical select: white surface, `#d8e1eb` border, 7px radius, project font, neutral text, and blue focus ring.
- Standard compact height is 30px; dense chart controls may use 28px, Dashboard filters may use 34px.
- A select must not introduce a colored background unless color identifies the selected series through a separate dot or swatch.
- Page-specific CSS may adjust width only. Border, radius, typography, hover, focus, and disabled states remain shared.
- Use native `select` for short single-choice lists. Use a dedicated popover only for searchable, grouped, or multi-select data.

## Segmented Buttons

- Use one shared segmented-control anatomy for metric tabs, granularity, and entity context.
- Container: neutral border and surface, 7px radius, 2px inner padding.
- Active item: restrained yellow surface, dark text, stronger weight.
- Do not use unrelated pill, tab, and button styles for the same interaction type.

## Product Detail

- Product identity, tags, primary period, and comparison period stay in the left context area.
- KPI cards are independent tiles on the page background; do not wrap them in an additional white sheet.
- Funnel stage labels sit left of the funnel, absolute values stay inside, and conversion labels sit right.
- Traffic metric tabs belong to the chart they control and align with the chart plotting area.
