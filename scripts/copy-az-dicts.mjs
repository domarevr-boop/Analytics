import { copyFile, cp, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';

const source = resolve('node_modules/az/dicts');
const target = resolve('public/az-dicts');
const browserSource = resolve('node_modules/az/dist/az.min.js');
const browserTargetDir = resolve('public/az');
const browserTarget = resolve(browserTargetDir, 'az.min.js');
await mkdir(target, { recursive: true });
await cp(source, target, { recursive: true, force: true });
await mkdir(browserTargetDir, { recursive: true });
await copyFile(browserSource, browserTarget);
console.log('[az] browser runtime and dictionaries copied to public assets');
