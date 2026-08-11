import assert from 'node:assert/strict';
import test from 'node:test';
import { getRussiaRegionCode, getRussiaRegionName } from './russiaRegions.ts';

test('maps official WB area names to SVG region codes', () => {
  assert.equal(getRussiaRegionCode('Московская область'), 'Moskva');
  assert.equal(getRussiaRegionCode('Москва'), 'Moscow City');
  assert.equal(getRussiaRegionCode('Республика Саха (Якутия)'), 'Sakha');
});

test('supports common aliases and dash variants', () => {
  assert.equal(getRussiaRegionCode('ХМАО - Югра'), 'Khanty-Mansiy');
  assert.equal(getRussiaRegionCode('Кемеровская область — Кузбасс'), 'Kemerovo');
  assert.equal(getRussiaRegionName('Tatarstan'), 'Республика Татарстан');
});

test('returns null for territories absent from the SVG map', () => {
  assert.equal(getRussiaRegionCode('Беларусь'), null);
});
