import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export function commandAvailable(command, platform = process.platform) {
  const locator = platform === 'win32' ? 'where.exe' : 'which';
  const result = spawnSync(locator, [command], {
    encoding: 'utf8',
    shell: false,
    windowsHide: true,
  });

  return result.status === 0;
}

export function summarizeBackupPrerequisites({
  hasSupabaseCli,
  hasDocker,
  hasPgDump,
  hasPgRestore,
  hasPsql,
}) {
  const directPostgresToolsReady = hasPgDump && hasPgRestore && hasPsql;

  return {
    supabaseCli: hasSupabaseCli,
    storageExportReady: hasSupabaseCli,
    supabaseDatabaseDumpReady: hasSupabaseCli && hasDocker,
    directPostgresToolsReady,
    databaseToolingReady: (hasSupabaseCli && hasDocker) || directPostgresToolsReady,
    restoreProven: false,
  };
}

function yesNo(value) {
  return value ? 'готово' : 'нет';
}

function run() {
  const cliEntry = resolve(process.cwd(), 'node_modules', 'supabase', 'dist', 'supabase.js');
  const tools = {
    hasSupabaseCli: existsSync(cliEntry),
    hasDocker: commandAvailable('docker'),
    hasPgDump: commandAvailable('pg_dump'),
    hasPgRestore: commandAvailable('pg_restore'),
    hasPsql: commandAvailable('psql'),
  };
  const readiness = summarizeBackupPrerequisites(tools);

  console.log('Готовность recovery-контура V5:');
  console.log(`- локальный Supabase CLI: ${yesNo(readiness.supabaseCli)}`);
  console.log(`- выгрузка private Storage: ${yesNo(readiness.storageExportReady)} (experimental CLI)`);
  console.log(`- дамп БД через Supabase CLI: ${yesNo(readiness.supabaseDatabaseDumpReady)} (нужен Docker)`);
  console.log(`- прямые PostgreSQL tools: ${yesNo(readiness.directPostgresToolsReady)} (нужны pg_dump, pg_restore и psql)`);
  console.log(`- хотя бы один путь выгрузки БД: ${yesNo(readiness.databaseToolingReady)}`);
  console.log('- восстановление в отдельный проект: не проверено');
  console.log('Безопасность: не запускайте `supabase db dump --dry-run` в общих логах — CLI может вывести временные реквизиты подключения.');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  run();
}
