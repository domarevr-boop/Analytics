# Design Guide

## CSS Variables (:root in App.css)

### Colors — Tailwind Teal + Slate (v2, improved contrast)

| Variable | Value | Tailwind | Usage |
|---|---|---|---|
| `--color-primary` | `#0F766E` | teal-700 | Акцентный (кнопки, фокус, графики) |
| `--color-primary-hover` | `#115E59` | teal-800 | Ховер primary-кнопок |
| `--color-primary-bg` | `#CCFBF1` | teal-100 | Фон активных/выбранных элементов, группы метрик |
| `--color-text` | `#0F172A` | slate-900 | Основной текст |
| `--color-text-secondary` | `#475569` | slate-600 | Вторичный текст (лейблы, nav, неактивные вкладки) |
| `--color-text-muted` | `#64748B` | slate-500 | Muted текст (хинты, плейсхолдеры) — WCAG AA ✓ |
| `--color-text-dim` | `#64748B` | slate-500 | Dim текст (debug counters, field labels, .db-lbl) — унифицирован с muted |
| `--color-bg` | `#F8FAFC` | slate-50 | Фон страницы |
| `--color-bg-white` | `#fff` | white | Фон карточек |
| `--color-border` | `#CBD5E1` | slate-300 | Все бордеры |
| `--color-border-light` | `#E2E8F0` | slate-200 | Лёгкие разделители |
| `--color-success` | `#22C55E` | green-500 | Зелёный (up, success) |
| `--color-danger` | `#EF4444` | red-500 | Красный (down, error, danger) |
| `--color-warning` | `#F59E0B` | amber-500 | Жёлтый (warning, processing) |

### Принципы использования цвета
- **Primary** (`#0F766E` — teal-700): только для интерактивных элементов (кнопки, focus ring, chart bars, chart-btn active)
- **Primary-bg** (`#CCFBF1` — teal-100): для фона выбранных/активных состояний (active tab, table group headers). Текст на primary-bg всегда **slate-900** (максимальный контраст)
- **Text-secondary** (`#475569` — slate-600): для всей неактивной навигации, лейблов, подписей
- **Text-muted** (`#64748B` — slate-500): для плейсхолдеров, disabled-состояний, dim-текста
- **Success/Danger/Warning**: только для изменения метрик (up/down/flat)
- **Nav hover**: фон `--color-border` (slate-300), чтобы визуально отличаться от active (primary-bg)

### Border Radius
| Variable | Value | Usage |
|---|---|---|
| `--radius-sm` | `10px` | Кнопки, инпуты, селекты, бейджи |
| `--radius-md` | `12px` | Карточки, панели, таблицы |
| `--radius-lg` | `14px` | Модалки, дропзона |

### Shadows
| Variable | Value | Usage |
|---|---|---|
| `--shadow-card` | `0 1px 2px rgba(0,0,0,0.04), 0 6px 20px rgba(0,0,0,0.04)` | Карточки, панели, таблицы |
| `--shadow-modal` | `0 4px 24px rgba(0,0,0,0.15)` | Модальные окна |

## Typography

### Font Stack
- **Inter** — весь UI текст (лейблы, заголовки, названия строк, навбар, кнопки)
- **JetBrains Mono** — все числовые значения (KPI, метрики в таблицах, суммы, проценты)

Подключены через Google Fonts в `index.html`:
```html
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;700&display=swap" rel="stylesheet" />
```

JetBrains Mono даёт моноширинное выравнивание цифр (без `font-variant-numeric: tabular-nums`) и улучшенную различимость символов.

### Scale (модуль 1.2)

#### Page Titles
| Class | Size | Weight | Usage |
|---|---|---|---|
| `.page-title` | `22px` | `600` | Заголовок страницы (Import, Dev) |
| `.section-title` | `16px` | `600` | Заголовок секции |

#### KPI Cards (Dashboard) — Compact Layout (v3)

Все карточки в один ряд (`.db-cards` flex), каждая 2 строки:

```
┌─────────────────────────────────────┐
│ ПЛАН ЗАКАЗОВ                        │  ← .db-name
│  3 456 789 ₽  │  5 000 000 ₽  │ 69% │  ← .db-row-main (Факт | План | Вып%)
│  Прогноз 4.2M (84%) · Пл/д 161k · Фкт/д 112k  │  ← .db-row-secondary
└─────────────────────────────────────┘
```

| Class | Size | Weight | Usage |
|---|---|---|---|
| `.db-val` | `20px` | `700` | Факт (главное число) |
| `.db-val-md` | `15px` | `600` | План (второе число) |
| `.db-val-sm` | `12px` | `500` | Вып% (третье число) |
| `.db-name` | `10px` | `700` | Название метрики (uppercase) |
| `.db-row-main` | — | — | Flex-строка: `Факт \| План \| Вып%` |
| `.db-main-sep` | `16px` | `200` | Вертикальный разделитель `\|` |
| `.db-row-secondary` | `10px` | `400` | Вторичная строка (Прогноз, per-day), muted |
| `.db-sec-dot` | — | — | Точка-разделитель `·` |
| `.db-fwd` | — | `500` | Число прогноза % (up/down coloring) |

**Особенности:**
- `hidePlan` (ДРР) — только Факт, без разделителей, без secondary
- `isPercent` (Рентабельность) — Факт% \| План% \| Вып%, без secondary
- `plan=0` (Рекл.бюджет) — только Факт, без plan/pct, без secondary

#### Table (Analytics)
| Class | Size | Weight | Usage |
|---|---|---|---|
| `.at` (table) | `13px` | `400` | Таблица аналитики |
| `.at-th` | `10px` | `600` | Заголовки колонок (uppercase) |
| `.at-group` | `11px` | `700` | Группы метрик (uppercase, teal bg) |
| `.at-metric` | `10px` | `600` | Подписи метрик в группе |
| `.at-mv` | `13px` | `400` | Значения метрик |
| `.at-mv.primary` | `15px` | `700` | Ключевые метрики (заказы, выручка) |
| `.at-mc` | `11px` | `500` | Изменение метрик (up/down) |
| `.at-name` | `13px` | `400` | Названия строк (SKU, бренд) |

#### Planning Page
| Class | Size | Weight | Usage |
|---|---|---|---|
| `.plan-summary-value` | `16px` | `700` | Саммари-бар |
| `.plan-summary-label` | `10px` | `600` | Лейблы саммари-бара (uppercase) |
| `.pl-top-label` | `10px` | `400` | Лейблы топ-бара |
| `.pl-top-val` | `14px` | `700` | Значения топ-бара |

#### Profitability Page
| Class | Size | Weight | Usage |
|---|---|---|---|
| `.profit-summary-value` | `16px` | `700` | Показатели (выручка, ЧП, маржа...) |
| `.profit-summary-label` | `10px` | `600` | Лейблы (uppercase) |

### Body
| Selector | Size | Weight | Usage |
|---|---|---|---|
| `body` | `14px` | `400` | Основной текст, кнопки, инпуты |

## Layout

### Page Structure
```
NavBar (44px, sticky top)
  ↓
Page Title + Actions (опционально)
  ↓
KPI Summary Cards (Dashboard dashboard-block, Profitability profit-summary)
  ↓
Filters Row (filterbar, 36px)
  ↓
Main Content Table (flex: 1, overflow: auto)
```

### Spacing
| Value | Usage |
|---|---|
| `8px` | Базовый шаг |
| `12-16px` | Padding карточек |
| `12px` | Padding фильтров |
| `12-14px` | Padding ячеек таблиц |
| `16px` | Padding страниц |

### Containers
- `.dashboard`: `max-width: 1920px`, `margin: 0 auto`
- Все блоки внутри: `flex-shrink: 0`
- Таблица: `flex: 1`, `overflow: auto`

## Components

### Dashboard KPI Cards (`.db-card`) — Compact v3
- Белая карточка, `box-shadow: var(--shadow-card)`
- `min-width: 140px`, `padding: 8px 12px`
- `border-left: 4px solid transparent` (для цветовой индикации)
- **Строка 1:** `Факт | План | Вып%` (flex, baseline)
- **Строка 2:** `Прогноз N (P%) · Пл/д N · Фкт/д N` (10px, muted)
- Спец-кейсы: ДРР → только Факт; Рентаб-сть → без secondary строки; Рекл.бюджет → без план/вып%

### Tables (`.at`)
- `border-collapse: collapse`
- Header: sticky (`top: 0`, `z-index: 10`)
- Header background: `--color-border`
- Группы метрик: `background: var(--color-primary-bg)`, `color: var(--color-primary-hover)`
- Row hover: `#fafbfc`
- Padding: `th: 8px 10px`, `td: 14px 12px`

### NavBar
- Height: `44px`
- Background: `#fff`
- Bottom border: `1px solid var(--color-border)`
- Shadow: `var(--shadow-card)`
- Tabs: `padding: 6px 14px`, `border-radius: var(--radius-sm)`, size `13px`
- Active tab: `background: var(--color-primary-bg)`, `color: var(--color-primary)`, weight `700`

### Filter Bar
- Height: `36px`
- Background: `#fff`
- Selects/inputs: `height: 28px`, `border-radius: var(--radius-sm)`

### Buttons
- Height: `32px`
- Border-radius: `var(--radius-sm)`
- Primary: `background: var(--color-primary)`, `color: #fff`
- Secondary: `background: #fff`, `border: 1px solid var(--color-border)`
- Danger: `color: var(--color-danger)`, `border-color: var(--color-danger)`

### Profitability Page
- `flex: 1`, `flex-direction: column`
- `padding: 16px 0`
- Summary cards: `border-radius: var(--radius-md)`, `box-shadow: var(--shadow-card)`

## Navigation
| Tab | Page Key | Label |
|---|---|---|
| Главная | `dashboard` | Главная |
| План | `planning` | План |
| Рентабельность | `profitability` | Рентабельность |
| Справочник | `dictionary` | Справочник |
| Импорт | `import` | Импорт |

## Historical Changes

### CSS Variables Introduced
- Заменили все хардкодные цвета на CSS-переменные
- Обновлена палитра на Tailwind Teal + Slate (variant A)
- `--color-primary-bg`: `#EFF6FF` → `#F0FDFA` → `#CCFBF1` → `#A7F3D0` (усиление насыщенности)
- `--color-primary`: `#3B82F6` → `#0D9488` → `#2DD4BF` (teal-400)
- Neutrals: slate-50/100/200/400/500/900

### Visual Updates (Chronological)
1. **Card shadows** — added to `.db-card`, `.dashboard-block`, `.profit-summary-card`, `.dict-edit-panel`, `.profit-table-wrap`, `.navbar`
2. **Input heights** — unified to 28-32px
3. **Border-radius** — unified: sm=4px→8px, md=6px→10px, lg=8px→12px
4. **Navbar** — height 32px→40px→44px
5. **Table padding** — th: 6px→8px/10px, td: 8px→14px/12px
6. **KPI font sizes** — `.db-val` 13px→18px→20px, `.db-val-md` (14px→15px), `.db-val-sm` (12px)
7. **Fact/Plan order** — swapped in KPI cards (fact on top)
8. **Profitability** — `.profit-summary-value` 18px→16px
9. **Nav tab** — renamed "Воронка" → "Главная"
10. **Color palette** — switched to Tailwind Teal + Slate (variant A)
11. **Group headers** — background: `var(--color-primary-bg)`, text: `var(--color-text)` (slate-900, max contrast)
12. **Per-metric chart toggles** — added chart buttons in sub-header row, independent toggle per metric
13. **Font stack** — added JetBrains Mono for all numeric values (Inter сохранился для UI)
14. **Font scale** — unified to module 1.2: `at-mv` 14px→13px, `at-mv.primary` 16px→15px, `at-mc` 12px→11px, `at-th` 11px→10px, `at-group` 10px→11px, `at-metric` 9px→10px, `db-lbl` 9px→10px, `pl-top-label` 9px→10px, `db-row-extra` 9px→10px (минимальный размер 10px)
15. **Color palette v2** — improved contrast: primary `#2DD4BF→#0F766E` (teal-400→700), primary-hover `#14B8A6→#115E59` (teal-500→800), primary-bg `#A7F3D0→#CCFBF1` (teal-200→100), text-secondary `#64748B→#475569` (slate-500→600), text-muted `#94A3B8→#64748B` (slate-400→500), text-dim `#8c9cb0→#64748B` (unified with muted), border `#E2E8F0→#CBD5E1` (slate-200→300). Текст на primary-bg — slate-900 (не teal). Nav hover — `--color-border` (отличается от active).
16. **Dashboard KPI cards v3** — compact 2-line layout: `Факт | План | Вып%` в одной строке, вторичная строка с прогнозом/per-day (muted). Удалён `factExtra` (Сойка стала основным фактом для Выручки). Все карточки в один ряд (без `db-cards-side`). Убран `fPct`, `db-sep`, `db-lbl`, `db-row`. Padding карт `10px→8px`, `min-width 150px→140px`, `db-name margin-bottom 6px→2px`.
17. **Dashboard block — removed подложка** — убран `background: #fff`, `border-bottom`, `box-shadow` у `.dashboard-block`; карточки висят на фоне страницы. `margin-bottom` 8px→16px. У `.db-month-selector` убран `border-bottom`, padding `6px 12px`→`4px 0 8px`.
18. **Border-radius scale increased** — `--radius-sm` 8px→10px, `--radius-md` 10px→12px, `--radius-lg` 12px→14px (единая шкала для всех блоков).
