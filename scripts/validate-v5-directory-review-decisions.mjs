import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { summarizeDirectoryDecisionErrors, validateDirectoryReviewDecisions } from './v5-directory-review-decisions-core.mjs';

const manifestPath = resolve(process.argv[2] || '.v5-local/directory-bootstrap.json');
const decisionsPath = resolve(process.argv[3] || '.v5-local/directory-review-decisions.json');

try {
  const [manifest, decisions] = await Promise.all([
    readFile(manifestPath, 'utf8').then(JSON.parse),
    readFile(decisionsPath, 'utf8').then(JSON.parse),
  ]);
  const errors = validateDirectoryReviewDecisions(manifest, decisions);
  if (errors.length) throw new Error(`Directory decisions are not ready: ${JSON.stringify(summarizeDirectoryDecisionErrors(errors))}`);
  console.log(JSON.stringify({ valid: true, decisionCount: decisions.decisions.length }, null, 2));
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
