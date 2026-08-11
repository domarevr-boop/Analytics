import { loadEnv } from 'vite';

const env = loadEnv('production', process.cwd(), '');
const required = ['VITE_SUPABASE_URL', 'VITE_SUPABASE_ANON_KEY'];
const missing = required.filter(name => !env[name]);

if (missing.length > 0) {
  console.error(`[deploy] Missing production variables: ${missing.join(', ')}`);
  console.error('[deploy] Deployment stopped to prevent publishing a broken frontend.');
  process.exit(1);
}

console.log('[deploy] Supabase public production configuration is present');
