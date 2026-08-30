# Analytics MVP

Локальная аналитическая система для отчётов Wildberries: продажи, воронка, реклама, рентабельность, география, точки входа, поисковый спрос, динамика ниши и клиентский опыт.

## Текущий контур

- React + TypeScript + Vite.
- Основные отчёты работают local-first в браузере.
- Отзывы и CX-аналитика используют изолированный контур Supabase.
- Активная версия: **v4.0**.
- Публикация: GitHub Pages.

## Документация

- [Единый индекс документации](docs/INDEX.md)
- [Текущее состояние](PROJECT_STATE.md)
- [Версии](docs/VERSIONS.md)
- [Roadmap](docs/ROADMAP.md)
- [Дизайн-система](docs/DESIGN_SYSTEM.md)
- [UI-компоненты](docs/UI_COMPONENTS.md)
- [Импорт](docs/IMPORTS.md)
- [Клиентский опыт](docs/CLIENT_EXPERIENCE.md)
- [Товарный справочник](docs/PRODUCT_REGISTRY.md)

Перед изменениями прочитайте [AGENTS.md](AGENTS.md) и ближайший локальный `AGENTS.md`.

Источником актуального кода является `origin/main`. Соседние рабочие папки Git и внешний каталог `_archive` могут содержать старые или незавершённые снимки и не используются как документация проекта.

## Команды

```bash
npm install
npm run dev
npm run test:cx
npm run lint
npm run build
npm run deploy
```

Перед `npm run deploy` должен существовать локальный `.env.production.local` с `VITE_SUPABASE_URL` и публичным `VITE_SUPABASE_ANON_KEY`. Проверка останавливает публикацию, если конфигурация отсутствует, чтобы GitHub Pages не получил нерабочую сборку. Service-role ключ в frontend использовать нельзя.

## Безопасность

- Не коммитьте `.env.local`, пароли и service-role ключи.
- Публичный frontend не должен обходить RLS/RPC Supabase.
- Полные наборы отзывов не загружаются во frontend; используйте агрегаты и пагинацию.
