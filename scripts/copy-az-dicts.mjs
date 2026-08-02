import { cp, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';

const source = resolve('node_modules/az/dicts');
const target = resolve('public/az-dicts');
await mkdir(target, { recursive: true });
await cp(source, target, { recursive: true, force: true });
console.log(`[az] dictionaries copied to ${target}`);
