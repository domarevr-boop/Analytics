# Резервное копирование и восстановление V5

Проверено: **21 сентября 2026**. Статус: **tooling готов, восстановление ещё не доказано**.

Этот документ относится только к отдельному проекту Supabase V5. Он не разрешает операции с V4, production или текущим V5 без прохождения защитной команды. Резервная копия считается рабочей только после восстановления в ещё один изолированный проект и сверки результата.

## Подтверждённое состояние

- V5 CLI связан с отдельным project ref и защищён проверкой worktree, ветки, env и link.
- Private bucket `v5-import-sources` доступен CLI только после явного `--experimental`; read-only listing выполнен. После принятой постоянной партии «Конкурентов» в bucket хранится её исходный XLSX, поэтому backup-пакет обязан включать байты Storage, а не только БД.
- Docker недоступен из-за выключенной аппаратной виртуализации. Официальный portable PostgreSQL 17.11 archive распакован в игнорируемый `.tools/postgresql17-portable`; `pg_dump`, `pg_restore` и `psql` запущены и проверены. `npm run db:v5:backup:check` учитывает этот локальный набор.
- Для фактического дампа ещё нужны source DB connection string, авторизация Supabase CLI для Storage и отдельный recovery-проект с собственным connection string. Эти секреты не добавляются в `.env.local`, Git или общие логи.
- Тариф проекта и наличие платформенных ежедневных backup/PITR из репозитория установить нельзя.
- Backup БД Supabase не восстанавливает байты Storage: объекты bucket нужно выгружать и восстанавливать отдельно.
- CLI dump исключает внутренние схемы Supabase. Следовательно, один дамп прикладных схем не переносит Auth-пользователей; UUID пользователей и связанные строки `app.user_access` требуют отдельного проверенного сценария.

Проверить локальные prerequisites без вывода секретов:

```powershell
cd "C:\Users\vipdo\Documents\test\Analytics-v5"
npm run db:v5:backup:check
```

Команда только диагностирует окружение. Значение `restoreProven` намеренно остаётся отрицательным до реального теста восстановления.

## Что должно входить в backup-пакет

Пакет хранится **вне Git-репозитория** в каталоге с UTC-временем создания и содержит:

1. `schema.sql` — схема `app,ingest,core,analytics`.
2. `data.sql` — данные этих схем в формате COPY.
3. `auth-mapping.csv` — source UUID, email и назначенная роль для явного сопоставления с новыми recovery Auth UUID.
4. `storage/v5-import-sources/` — отдельная выгрузка всех сохранённых исходников.
5. `manifest.json` — project ref V5, время, версии локальной и удалённой миграций, количество строк ключевых таблиц, число и размер Storage-объектов.
6. `SHA256SUMS` — контрольные суммы каждого файла пакета.
7. `RESTORE_NOTES.md` — известные ограничения, способ воссоздания/сопоставления Auth-пользователей и результат последней проверки восстановления.

Секреты, access token, пароль БД, JWT и содержимое `.env.local` в пакет не включаются. Пакет содержит реальные бизнес-данные и должен храниться в закрытом хранилище с ограниченным доступом.

## Подготовленные команды выгрузки

Эти команды пока **не запускались**, потому что отсутствуют авторизованные source/recovery connection strings и recovery-проект. PostgreSQL URL задаётся только в переменной текущего процесса, а backup-каталог создаётся вне репозитория:

```powershell
npm run db:v5:guard
$pgBin = ".\.tools\postgresql17-portable\pgsql\bin"
& "$pgBin\pg_dump.exe" --dbname $env:V5_SOURCE_DB_URL --schema-only --no-owner --no-acl --schema app --schema ingest --schema core --schema analytics --file "C:\путь-вне-репозитория\schema.sql"
& "$pgBin\pg_dump.exe" --dbname $env:V5_SOURCE_DB_URL --data-only --no-owner --no-acl --schema app --schema ingest --schema core --schema analytics --exclude-table-data app.user_access --exclude-table-data app.access_audit --file "C:\путь-вне-репозитория\data.sql"
& "$pgBin\psql.exe" --dbname $env:V5_SOURCE_DB_URL --csv --command "select users.id as source_user_id, users.email, access.access_role, access.all_cabinets, access.is_active from auth.users users join app.user_access access on access.user_id = users.id" --output "C:\путь-вне-репозитория\auth-mapping.csv"
node scripts/run-supabase.mjs --experimental storage cp --linked --recursive ss:///v5-import-sources "C:\путь-вне-репозитория\storage\v5-import-sources"
```

Нельзя запускать `supabase db dump --dry-run` в общих логах: установленная версия CLI может вывести временные реквизиты подключения. Для проверки цели используется `npm run db:v5:guard`, а не dry-run дампа.

## Обязательная проверка восстановления

Восстановление проводится не в V4 и не поверх действующей V5, а в новом временном Supabase-проекте:

1. Создать отдельный recovery-проект и отдельный локальный env/link; project ref не добавлять в основной guard.
2. Применить к чистому проекту зафиксированную цепочку миграций V5.
3. Воссоздать тестовые Auth-учётные записи, получить их recovery UUID и документированно сопоставить с `source_user_id` из `auth-mapping.csv`. Создать `data-remapped.sql` заменой только точных UUID; исходный `data.sql` не изменять. После загрузки назначить роли recovery UUID через admin RPC и сохранить сверку в `RESTORE_NOTES.md`.
4. Загрузить `data-remapped.sql`, затем отдельно вернуть объекты `v5-import-sources`.
5. Сверить миграции, manifest, количества строк, хеши исходников, статусы партий и активные версии источников.
6. Выполнить foundation/access/market smoke и открыть серверный сценарий «Рынок» под viewer, importer и admin.
7. Зафиксировать дату, длительность, отклонения и точные команды в `RESTORE_NOTES.md`. Только после этого release gate backup/restore можно закрыть.

Если проверка не проходит, действующая V5 не изменяется: исправляется процедура или создаётся новая копия recovery-проекта. Переключение frontend на восстановленный проект допускается только отдельным решением владельца и заменой V5 environment configuration.

## Следующие действия

1. В Supabase Dashboard проверить тариф, расписание, retention и доступность восстановления/PITR.
2. Авторизовать Supabase CLI без передачи access token в чат и получить source/recovery connection strings через Dashboard.
3. Создать отдельный recovery-проект, backup-пакет вне репозитория и доказать восстановление.
4. После появления нескольких пользователей отдельно автоматизировать экспорт/воссоздание Auth identity mapping.

Основание по возможностям платформы: [Supabase Database Backups](https://supabase.com/docs/guides/platform/backups), [Supabase CLI db dump](https://supabase.com/docs/reference/cli/v1/supabase-db-dump), [Supabase Storage download](https://supabase.com/docs/guides/storage/management/download-objects), [restore into a new project](https://supabase.com/docs/guides/self-hosting/restore-from-platform).
