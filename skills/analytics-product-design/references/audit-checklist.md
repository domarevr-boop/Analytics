# Interface audit checklist

## Context

- What decision does the page support?
- What is the primary data surface?
- Which controls change that surface?
- Which actions are frequent, occasional, or rare?

## Hierarchy

- Is the page title distinct from section titles?
- Is the primary action obvious?
- Are summary, controls, and data visually connected?
- Are nested cards adding hierarchy or only decoration?

## Filters

- Are period controls separated from entity filters?
- Does changing a complex date range require explicit confirmation?
- Are useful presets available without hiding custom range selection?
- Are frequent filters immediately available?
- Are rare filters progressively disclosed?
- Are active conditions visible and individually removable?
- Is result count visible?
- Is reset contextual?
- Are dependent filters understandable?
- Can search cover title, SKU, and marketplace identifiers?

## Tables

- Does the product cell contain the right identity information?
- Are headers readable and states obvious?
- Are numeric columns aligned consistently?
- Do sticky headers or columns preserve context?
- Are loading, empty, error, hover, selected, and expanded states designed?
- Does horizontal scrolling preserve the main entity?
- Can users reduce the table to the metrics needed for their task?
- Are cabinet, group, and product levels distinguishable without overpowering the metric values?
- If columns are dates, do all sections share the same time axis and column widths?
- Are metric name, trend, and delta preserved while the time grid scrolls?
- Is heatmap normalization local to the intended comparison scope?
- Does the heatmap respect inverse-good metrics such as cost, DRR, cancellations, and delivery time?
- Can every colored cell still be understood from its text and tooltip?
- Do row sparklines use the same range and filters as the visible cells?
- Are selected dates, weekends, and incomplete periods visually independent from performance color?

## KPI

- Are fact, plan, forecast, and completion explicitly labelled?
- Does every card in one KPI panel use the same fact/plan structure?
- Is an unavailable plan shown as “not set” instead of a misleading zero?
- Are planned financial metrics sourced from the same monthly model as the table?
- Is completion represented by a readable progress signal rather than decoration alone?
- In compact KPI strips, do value, sparkline, delta, and comparison horizon each add distinct information?
- Is an “add metric” tile visually secondary to actual KPI data?

## Visual system

- Are spacing, radii, control heights, type sizes, borders, and shadows tokenized?
- Is color semantic and restrained?
- Is information density appropriate for repeated daily use?
- Are click targets and focus states usable?
- Does dense analytics follow the 4/6/8/12/16/20/24 spacing scale?
- Are radii restrained by role: KPI 10px, section 12px, control 6–8px, heatmap 2–4px?
- Are tabular numerals enabled for dense numeric values?

## Validation

- Compare before and after at desktop and narrow widths.
- Test with no filters, one filter, several filters, and zero results.
- Test long product names and large numbers.
- Confirm business calculations and filter behavior did not change.
- Run focused lint/build checks.
