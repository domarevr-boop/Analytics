# Analytics MVP

Аналитическая система для отчётов Wildberries: продажи, воронка, реклама, рентабельность, география, точки входа, поисковый спрос, рынок, конкуренты и клиентский опыт.

## Контуры проекта

- **V4 production** — ветка `main`, local-first хранение основных отчётов в браузере и отдельный серверный CX-контур Supabase. Рабочая папка владельца: `C:\Users\vipdo\Documents\test\Analytics`.
- **V5 development** — ветка `v5/backend-foundation` в отдельном worktree `C:\Users\vipdo\Documents\test\Analytics-v5`. Цель — отдельный Supabase/PostgreSQL, серверный импорт и воспроизводимые расчёты. V5 не публикуется и не должна использовать БД/Storage V4.

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

## Публикация и безопасность

Текущий GitHub Actions workflow публикует только `main`, то есть V4. `npm run deploy` требует `.env.production.local` и предназначен для принятого production-контура; из V5 worktree его не запускают. Параллельный URL V5 будет добавлен отдельным release-этапом без перезаписи V4.

- Не коммитьте `.env.local`, исходные рабочие выгрузки, пароли и service-role ключи.
- Не связывайте Supabase CLI в V5 worktree с проектом V4.
- Публичный frontend не должен обходить RLS/RPC или загружать полные большие наборы данных.
