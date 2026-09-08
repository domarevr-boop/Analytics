import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { validateDirectoryBootstrap } from './v5-directory-bootstrap-core.mjs';

const inputPath = resolve(process.argv[2] || '.v5-local/directory-bootstrap.json');

try {
  const bootstrap = JSON.parse(await readFile(inputPath, 'utf8'));
  const errors = validateDirectoryBootstrap(bootstrap);
  if (errors.length > 0) {
    console.error(JSON.stringify({ valid: false, errors }, null, 2));
    process.exitCode = 1;
  } else {
    console.log(JSON.stringify({ valid: true, source: bootstrap.source, summary: bootstrap.summary }, null, 2));
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
