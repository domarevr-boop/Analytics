import { spawnSync } from 'node:child_process';

const run = (args) => {
  const result = spawnSync(process.execPath, args, {
    cwd: process.cwd(),
    env: {
      ...process.env,
      VITE_APP_ENV: 'v5-development',
      VITE_APP_BASE: '/Analytics/v5/',
      VITE_V5_MARKET_BACKEND_ENABLED: 'true',
      VITE_V5_COMPETITORS_IMPORT_ENABLED: 'true',
      VITE_V5_COMPETITORS_BACKEND_ENABLED: 'true',
      VITE_V5_GEOGRAPHY_IMPORT_ENABLED: 'true',
      VITE_V5_GEOGRAPHY_BACKEND_ENABLED: 'false',
      VITE_V5_DIRECTORY_BACKEND_ENABLED: 'false',
      VITE_V5_DIRECTORY_BOOTSTRAP_ENABLED: 'false',
    },
    stdio: 'inherit',
  });

  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
};

run(['scripts/copy-az-dicts.mjs']);
run(['node_modules/vite/bin/vite.js', 'build']);
