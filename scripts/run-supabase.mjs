import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

const cliEntry = resolve(process.cwd(), 'node_modules', 'supabase', 'dist', 'supabase.js');

const result = spawnSync(process.execPath, [cliEntry, ...process.argv.slice(2)], {
  cwd: process.cwd(),
  env: {
    ...process.env,
    SUPABASE_TELEMETRY_DISABLED: '1',
  },
  stdio: 'inherit',
  shell: false,
});

if (result.error) {
  console.error(`Failed to start Supabase CLI: ${result.error.message}`);
  process.exit(1);
}

process.exit(result.status ?? 1);
