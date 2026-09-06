import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const EXPECTED_V5_PROJECT_REF = 'diczcetpjmvdyuqygnsy';

export function parseEnv(text) {
  return Object.fromEntries(
    text
      .split(/\r?\n/u)
      .map(line => line.trim())
      .filter(line => line && !line.startsWith('#') && line.includes('='))
      .map(line => {
        const separator = line.indexOf('=');
        return [line.slice(0, separator).trim(), line.slice(separator + 1).trim()];
      }),
  );
}

export function projectRefFromUrl(value = '') {
  try {
    const hostname = new URL(value).hostname;
    const match = hostname.match(/^([a-z0-9]+)\.supabase\.co$/u);
    return match?.[1] ?? null;
  } catch {
    return null;
  }
}

export function validateV5Environment({ env, branch, linkedRef, requireLink = false, directoryName }) {
  const errors = [];
  const envProjectRef = projectRefFromUrl(env.VITE_SUPABASE_URL);

  if (env.VITE_APP_ENV !== 'v5-development') {
    errors.push('VITE_APP_ENV must equal v5-development.');
  }
  if (env.VITE_APP_BASE !== '/Analytics/v5/') {
    errors.push('VITE_APP_BASE must equal /Analytics/v5/.');
  }
  if (envProjectRef !== EXPECTED_V5_PROJECT_REF) {
    errors.push('VITE_SUPABASE_URL does not point to the locked V5 project.');
  }
  if (!env.VITE_SUPABASE_ANON_KEY?.startsWith('sb_publishable_')) {
    errors.push('VITE_SUPABASE_ANON_KEY must contain a publishable key.');
  }
  if (!branch?.startsWith('v5/')) {
    errors.push('Database commands are allowed only from a v5/* branch.');
  }
  if (directoryName !== 'Analytics-v5') {
    errors.push('Database commands are allowed only from the Analytics-v5 worktree.');
  }
  if (requireLink && !linkedRef) {
    errors.push('Supabase CLI is not linked. Run the documented V5 link step first.');
  }
  if (linkedRef && linkedRef !== EXPECTED_V5_PROJECT_REF) {
    errors.push('Supabase CLI is linked to a project other than the locked V5 project.');
  }

  return errors;
}

function run() {
  const workspace = resolve(process.cwd());
  const envPath = resolve(workspace, '.env.local');
  const linkPath = resolve(workspace, 'supabase', '.temp', 'project-ref');
  const requireLink = process.argv.includes('--require-link');

  if (!existsSync(envPath)) {
    console.error('V5 environment guard failed:\n- .env.local is missing.');
    process.exit(1);
  }

  const env = parseEnv(readFileSync(envPath, 'utf8'));
  const branch = execFileSync('git', ['branch', '--show-current'], {
    cwd: workspace,
    encoding: 'utf8',
  }).trim();
  const linkedRef = existsSync(linkPath) ? readFileSync(linkPath, 'utf8').trim() : null;
  const errors = validateV5Environment({
    env,
    branch,
    linkedRef,
    requireLink,
    directoryName: basename(workspace),
  });

  if (errors.length > 0) {
    console.error(`V5 environment guard failed:\n${errors.map(error => `- ${error}`).join('\n')}`);
    process.exit(1);
  }

  console.log('V5 environment guard passed. No credentials were printed.');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  run();
}
