---
name: analytics-product-design
description: Audit, design, and improve dense Analytics MVP dashboards, filters, KPI tiles, charts, analytical matrices, product pages, and client-experience workspaces while preserving data logic.
---

# Analytics Product Design

Проектируй плотный современный аналитический интерфейс, ориентированный на решение, а не на декоративное копирование референса.

## Контекст

1. Прочитай ближайший `AGENTS.md` и проверь `git status`.
2. Прочитай `PROJECT_STATE.md`, `docs/VERSIONS.md`, активный version-документ и релевантный раздел `docs/ROADMAP.md`.
3. Считай `docs/DESIGN_SYSTEM.md` каноническим источником дизайна, а `docs/UI_COMPONENTS.md` — контрактом компонентов.
4. Для широкого аудита прочитай `references/audit-checklist.md`.
5. Для временной матрицы прочитай `references/dense-analytical-matrix.md`.
6. Осмотри live-страницу, если runtime доступен; иначе проверь компоненты, CSS и состояния и явно укажи ограничение.

## Порядок работы

1. Зафиксируй решение пользователя, основной data surface и частые действия.
2. Проверь иерархию, плотность, фильтры, таблицы, графики, feedback states, адаптивность и доступность.
3. Отдели системную проблему от локальной косметики.
4. Переиспользуй существующий компонент или введи минимальный общий контракт.
5. Не меняй формулы, импорт, API и хранение без прямого запроса.
6. Сначала обнови общий токен/компонент, затем page-specific CSS.
7. Проверь loading, empty, error, active, hover, focus, disabled и narrow-screen states.
8. Запусти целевые тесты, затем `npm run lint` и `npm run build` для изменения приложения.
9. При новом общем правиле обнови `docs/DESIGN_SYSTEM.md`, `docs/UI_COMPONENTS.md` и этот навык.
10. Обнови version-документ/roadmap только при изменении статуса или объёма задачи.

## Ключевые guardrails

- Главная задаёт эталон фильтра периода и entity filters.
- Период визуально отделён от сущностей; редкие фильтры скрыты прогрессивно.
- KPI выводятся отдельными плитками: label, value, delta, sparkline, optional progress.
- Отсутствующие значения не превращаются в нули.
- Numeric columns выравниваются вправо, text columns — влево; tabular numerals обязательны для плотных данных.
- Product cell объединяет фото, название, SKU и вторичные ID.
- В metric-over-time матрице context columns sticky, date columns fixed-width и не растягиваются.
- Heatmap нормализуется внутри сравнимой строки и учитывает inverse-good метрики.
- График содержит не больше двух основных метрик без явной необходимости.
- Select, date range и segmented control не получают page-local дизайн при наличии общего контракта.
- Цвет используется для значения и состояния, не для декора.
- Не распространяй новый паттерн на несколько семейств страниц до проверки на одной репрезентативной странице.
- Не добавляй новую UI-библиотеку без отдельной необходимости.

## Паттерны

- Overview: KPI → category navigation → toolbar → hierarchy table → linked charts.
- Product detail: identity + period → comparative KPI → trend + funnel → traffic → geography.
- Analytical matrix: sticky entity/metric → sparkline → delta → shared fixed date axis.
- CX topics: composite indexes → drivers → symmetric topic map → topic table → selected-topic detail.
- Standard topic map: `Нишевые / Мейнстрим × Позитивные / Негативные`; X share, Y tonality, size mentions, color group, outline selection.

## Работа с референсом

- Извлекай информационную архитектуру, плотность, группировку контролов и паттерны взаимодействия.
- Не копируй логотип, бренд, точные цвета и уникальные визуальные активы.
- При конфликте референса с проектом сохраняй бизнес-контекст и каноническую дизайн-систему.

## Результат

Для аудита: сильные стороны, системные проблемы по приоритету, целевая структура, план, риски и критерии проверки.

Для реализации: сфокусированные изменения кода, визуальная проверка, обновлённая системная документация и результат проверок.
