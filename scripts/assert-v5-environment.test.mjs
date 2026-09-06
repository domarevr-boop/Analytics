import assert from 'node:assert/strict';
import test from 'node:test';

import {
  EXPECTED_V5_PROJECT_REF,
  parseEnv,
  projectRefFromUrl,
  validateV5Environment,
} from './assert-v5-environment.mjs';

const validEnv = {
  VITE_APP_ENV: 'v5-development',
  VITE_APP_BASE: '/Analytics/v5/',
  VITE_SUPABASE_URL: `https://${EXPECTED_V5_PROJECT_REF}.supabase.co`,
  VITE_SUPABASE_ANON_KEY: 'sb_publishable_test-only',
};

test('parses env values without exposing or interpreting comments', () => {
  assert.deepEqual(parseEnv('# comment\nA=one\nB=two=three\n'), { A: 'one', B: 'two=three' });
});

test('extracts only a valid Supabase project reference', () => {
  assert.equal(projectRefFromUrl(validEnv.VITE_SUPABASE_URL), EXPECTED_V5_PROJECT_REF);
  assert.equal(projectRefFromUrl('https://example.com'), null);
});

test('accepts only the locked project, V5 branch and V5 worktree', () => {
  assert.deepEqual(validateV5Environment({
    env: validEnv,
    branch: 'v5/backend-foundation',
    linkedRef: EXPECTED_V5_PROJECT_REF,
    requireLink: true,
    directoryName: 'Analytics-v5',
  }), []);
});

test('rejects a wrong project even when all other markers look valid', () => {
  const errors = validateV5Environment({
    env: { ...validEnv, VITE_SUPABASE_URL: 'https://wrongproject.supabase.co' },
    branch: 'v5/backend-foundation',
    linkedRef: 'wrongproject',
    requireLink: true,
    directoryName: 'Analytics-v5',
  });
  assert.ok(errors.some(error => error.includes('locked V5 project')));
  assert.ok(errors.some(error => error.includes('CLI is linked')));
});

test('rejects main, a wrong worktree, a secret key and a missing CLI link', () => {
  const errors = validateV5Environment({
    env: { ...validEnv, VITE_SUPABASE_ANON_KEY: 'sb_secret_forbidden' },
    branch: 'main',
    linkedRef: null,
    requireLink: true,
    directoryName: 'Analytics',
  });
  assert.equal(errors.length, 4);
});
