# Analytics MVP

Аналитическая система для отчётов Wildberries: продажи, воронка, реклама, рентабельность, география, точки входа, поисковый спрос, рынок, конкуренты и клиентский опыт.

## Контуры проекта

- **V4 production** — ветка `main`, local-first хранение основных отчётов в браузере и отдельный серверный CX-контур Supabase. Рабочая папка владельца: `C:\Users\vipdo\Documents\test\Analytics`.
- **V5 staging** — ветка `v5/backend-foundation` в отдельном worktree `C:\Users\vipdo\Documents\test\Analytics-v5`; 10 сентября 2026 года сборка опубликована по адресу `https://domarevr-boop.github.io/Analytics/v5/` и проверена до экрана входа. Цель — отдельный Supabase/PostgreSQL, серверный импорт и воспроизводимые расчёты. V5 использует только отдельные БД/Storage и не заменяет production V4.

В V5-шапке всегда показан жёлтый staging-индикатор с процентом текущего проверяемого roadmap. Его значение хранится в `src/config/v5Release.ts` и автоматически сверяется с чекбоксами `docs/ROADMAP.md`.

Текущая архитектура и статус зафиксированы в [PROJECT_STATE](PROJECT_STATE.md), полный переход — в [плане миграции V5](docs/V5_MIGRATION_PLAN.md), а документы и агентские средства — в [едином реестре](docs/INDEX.md). Перед изменениями прочитайте [AGENTS.md](AGENTS.md) и ближайший локальный `AGENTS.md`.

Технические команды и границы удалённых миграций находятся в [Supabase V5 README](supabase/README.md). Прямой `supabase db push` не используется: только защищённый `npm run db:v5:push` после guard и dry-run.

## Локальный запуск

```bash
npm ci
npm run dev
```

Основные проверки:

```bash
npm run build
npm run lint
npm run test:cx
npm run test:groups
npm run test:planning
npm run test:dashboard
npm run test:profitability
npm run test:reporting
npm run test:v5-infra
```

Для V5 скопируйте `.env.example` в локальный `.env.local` и укажите только URL и публичный anon key **отдельного V5 Supabase-проекта**. Service-role ключ запрещён во frontend и Git. До создания такого проекта серверные миграции V5 не запускаются.

Серверное чтение страницы «Рынок» включается только в V5-worktree локальной переменной `VITE_V5_MARKET_BACKEND_ENABLED=true`. Без неё страница сохраняет V4-поведение; в production V4 флаг не действует даже при случайном наличии переменной.

Admin-only публикация bootstrap-манифеста справочника дополнительно закрыта переменной `VITE_V5_DIRECTORY_BOOTSTRAP_ENABLED=false`. Её нельзя включать до успешного тестового восстановления V5 и разрешения владельца на первую постоянную загрузку; V4 этот флаг не использует.

Серверное чтение справочника отдельно закрыто переменной `VITE_V5_DIRECTORY_BACKEND_ENABLED=false`. Адаптер можно подключать к странице только в V5 и только после постоянной загрузки и контрольной сверки справочных данных; выключенный флаг сохраняет local-first поведение V4.

Серверное чтение страницы «Конкуренты» подготовлено отдельно и закрыто `VITE_V5_COMPETITORS_BACKEND_ENABLED=false`. Адаптер проверяет bounded-параметры и структуру ответов всех RPC, но страница не переключается до постоянного справочника и importer-приёмки.

## Публикация и безопасность

Обычный GitHub Actions workflow публикует `main` в корень `/Analytics/`, то есть V4, и сохраняет отдельный подкаталог V5. Из V5-worktree используется только `npm run deploy:v5`: guard проверяет ветку, worktree, отдельный Supabase project ref и public env, затем сборка публикуется в `/Analytics/v5/` с включёнными принятыми V5-сценариями. Bootstrap и серверное чтение справочника остаются выключены. Команда не удаляет V4-файлы в корне Pages.

- Не коммитьте `.env.local`, исходные рабочие выгрузки, пароли и service-role ключи.
- Не связывайте Supabase CLI в V5 worktree с проектом V4.
- Публичный frontend не должен обходить RLS/RPC или загружать полные большие наборы данных.
