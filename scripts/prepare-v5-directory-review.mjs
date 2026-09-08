import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { buildDirectoryReviewArtifacts } from './v5-directory-review-core.mjs';

const manifestPath = resolve(process.argv[2] || '.v5-local/directory-bootstrap.json');
const reportPath = resolve(process.argv[3] || '.v5-local/directory-review.md');
const decisionsPath = resolve(process.argv[4] || '.v5-local/directory-review-decisions.json');

async function assertMissing(path) {
  try {
    await access(path);
    throw new Error(`Refusing to overwrite existing review artifact: ${path}`);
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
}

try {
  await Promise.all([assertMissing(reportPath), assertMissing(decisionsPath)]);
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  const artifacts = buildDirectoryReviewArtifacts(manifest);
  await Promise.all([mkdir(dirname(reportPath), { recursive: true }), mkdir(dirname(decisionsPath), { recursive: true })]);
  await writeFile(reportPath, artifacts.report, { flag: 'wx' });
  await writeFile(decisionsPath, `${JSON.stringify(artifacts.decisions, null, 2)}\n`, { flag: 'wx' });
  console.log(JSON.stringify({ reportPath, decisionsPath, reviewCount: artifacts.decisions.decisions.length }, null, 2));
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
