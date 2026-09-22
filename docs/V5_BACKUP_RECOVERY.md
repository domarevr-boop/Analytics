# Резервное копирование и восстановление V5

Проверено: **22 сентября 2026**. Статус: **backup/recovery доказан в изолированном локальном контуре**.

Этот документ относится только к отдельному проекту Supabase V5. V4 и production процедура не изменяет. Полный пакет хранится вне Git в закрытом каталоге `Analytics-v5-recovery-backups/<UTC timestamp>` и содержит реальные бизнес-данные.

## Результат контрольного восстановления

- Источник: Supabase V5 `diczcetpjmvdyuqygnsy`.
- Инструменты: portable PostgreSQL 17.11 (`pg_dump`, `psql`) и авторизованная сессия Supabase Dashboard для private Storage.
- Цель: отдельный локальный PostgreSQL 17.11 на порту `55432`; рабочая V5 не изменялась.
- Схемы `app`, `ingest`, `core`, `analytics` восстановлены из `schema.sql` и `data.sql`.
- Отдельный `auth-mapping.csv` содержит одну действующую связь. Исходный UUID был воссоздан в recovery-only `auth.users` до загрузки данных, поэтому все внешние ключи проверены без изменения дампа.
- `30/30` прикладных таблиц совпали с источником по количеству строк; невалидированных ограничений — `0`.
- Private bucket `v5-import-sources` выгружен через Dashboard целой пользовательской папкой: `14/14` объектов, `6 035 942` байта после распаковки.
- Финальный пакет содержит `23` файла на `47 796 181` байт; `SHA256SUMS` покрывает `22/22` содержательных файла и проходит повторную проверку.

Free-организация уже содержит два проекта, поэтому третий hosted recovery-проект создать нельзя без изменения тарифа или удаления существующего проекта. Проверка выполнена в изолированном локальном контуре. Она доказывает пригодность SQL-дампа, зависимость от Auth UUID и сохранность Storage-байтов, но не выдаётся за проверку hosted Auth identity, OAuth-провайдеров или загрузки bucket в новый Supabase-проект.

## Состав пакета

1. `schema.sql` — схема `app,ingest,core,analytics`.
2. `data.sql` — данные этих схем в формате COPY.
3. `auth-mapping.csv` — source UUID, email и назначенный доступ.
4. `source-table-counts.csv` — контрольные количества строк источника.
5. `source-storage-summary.csv` — число и общий размер объектов источника.
6. `storage/v5-import-sources.zip` — исходный экспорт Dashboard.
7. `storage/v5-import-sources/` — распакованные private-исходники с исходными object paths.
8. `manifest.json` — project ref, время, версия PostgreSQL и итоги восстановления.
9. `RESTORE_NOTES.md` — границы доказательства и результат последней проверки.
10. `SHA256SUMS` — контрольные суммы всех файлов пакета, кроме самого списка.

Секреты, access token, пароль БД, JWT и содержимое `.env.local` в пакет не включаются.

## Повторяемая процедура

1. Выполнить `npm run db:v5:guard` и `npm run db:v5:backup:check`.
2. Получить пароль действующей V5 только в `SecureString` текущего PowerShell-процесса.
3. Запустить локальный игнорируемый Git сценарий `.tools/recovery-secrets/run-v5-source-backup.ps1`; он проверяет соединение, выгружает четыре прикладные схемы, Auth mapping, source counts и Storage summary.
4. Через Supabase Dashboard → Storage скачать папку пользователя bucket `v5-import-sources` одним ZIP.
5. Поднять новый локальный кластер PostgreSQL 17.11 на отдельном порту; создать только минимальные recovery-заглушки `auth.users`, `auth.uid()`, роль `authenticated` и `extensions.pgcrypto`.
6. Загрузить `schema.sql`, затем Auth UUID из mapping, затем `data.sql`.
7. Сравнить все таблицы с `source-table-counts.csv` и проверить ограничения.
8. Распаковать Storage ZIP, сравнить число и сумму байтов с `source-storage-summary.csv`, затем пересчитать `SHA256SUMS`.
9. Зафиксировать результат и ограничения в `RESTORE_NOTES.md`.

Локальные служебные сценарии и кластер находятся в игнорируемом `.tools`; backup-пакет — рядом с репозиторием, но не внутри него.

## Что остаётся операционным ограничением

- Перед production-переключением нужно проверить тариф, retention и доступность платформенных backup/PITR в Dashboard.
- При появлении свободного hosted recovery-проекта следует дополнительно повторить hosted Auth recreation, загрузку bucket и browser smoke уже на новом project ref.
- В инциденте сначала возвращается вход на V4 и блокируются импорты V5; восстановленный проект не становится рабочим без отдельной замены V5 environment configuration.

Основание по возможностям платформы: [Supabase Database Backups](https://supabase.com/docs/guides/platform/backups), [Supabase CLI db dump](https://supabase.com/docs/reference/cli/v1/supabase-db-dump), [Supabase Storage download](https://supabase.com/docs/guides/storage/management/download-objects), [restore into a new project](https://supabase.com/docs/guides/self-hosting/restore-from-platform).
