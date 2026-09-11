import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { V5_ROADMAP_DONE, V5_ROADMAP_PERCENT, V5_ROADMAP_TOTAL, V5_STAGING_PATH } from './v5Release.ts';

test('V5 release metadata matches the checked roadmap', () => {
  const lines = readFileSync(new URL('../../docs/ROADMAP.md', import.meta.url), 'utf8').split(/\r?\n/);
  let inV5 = false;
  let done = 0;
  let total = 0;
  for (const line of lines) {
    if (line.startsWith('## V5')) inV5 = true;
    else if (line.startsWith('## ')) inV5 = false;
    if (!inV5 || !/^- \[[ x]\]/u.test(line)) continue;
    total += 1;
    if (line.startsWith('- [x]')) done += 1;
  }

  assert.equal(V5_ROADMAP_DONE, done);
  assert.equal(V5_ROADMAP_TOTAL, total);
  assert.equal(V5_ROADMAP_PERCENT, Math.round(done / total * 100));
  assert.equal(V5_STAGING_PATH, '/Analytics/v5/');
});

test('V5 geography route uses the isolated server page without a local data fallback', () => {
  const route = readFileSync(new URL('../pages/analytics/GeographyPage.tsx', import.meta.url), 'utf8');
  const serverPage = readFileSync(new URL('../pages/analytics/GeographyServerPage.tsx', import.meta.url), 'utf8');

  assert.match(route, /isV5GeographyBackendEnabled \? <GeographyServerPage \/> : <LocalGeographyPage \/>/u);
  assert.doesNotMatch(serverPage, /data\/store/u);
  for (const loader of ['loadGeographyFilterOptions', 'loadGeographySummary', 'loadGeographySeries', 'loadGeographyLocations', 'loadGeographyProductLeaders']) {
    assert.match(serverPage, new RegExp(`${loader}\\(`, 'u'));
  }
});
