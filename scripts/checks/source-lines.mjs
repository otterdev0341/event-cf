import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
const ignored = new Set(['.git', '.agents', '.codex', '.aws', 'node_modules', 'target', 'dist', 'coverage', 'test-results', 'playwright-report']);
const code = /\.(?:[cm]?[jt]sx?|css|scss|sql|sh|bash|groovy|gradle|rs|py|html|toml|ya?ml|json)$/;
const failures = [];
let checked = 0;
async function walk(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (ignored.has(entry.name) || entry.isSymbolicLink()) continue;
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) { await walk(file); continue; }
    if ((!code.test(entry.name) && !/^(Dockerfile|Jenkinsfile|Makefile)$/.test(entry.name)) || /(?:package-lock\.json|Cargo\.lock)$/.test(entry.name)) continue;
    const content = await readFile(file, 'utf8');
    const lines = content.split('\n').length - (content.endsWith('\n') ? 1 : 0);
    checked++;
    if (lines > 300) failures.push(`${file}: ${lines} lines`);
  }
}
await walk(process.cwd());
if (failures.length) { console.error(failures.join('\n')); process.exitCode = 1; }
else console.log(`PASS: ${checked} first-party source/config files <=300 physical lines`);
