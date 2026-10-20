import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
const failures = [];
async function walk(directory) {
  for (const item of await readdir(directory, { withFileTypes: true })) {
    const file = path.join(directory, item.name);
    if (item.isDirectory()) { await walk(file); continue; }
    if (!/\.[jt]sx?$/.test(file)) continue;
    const text = await readFile(file, 'utf8');
    const owner = file.match(/features\/([^/]+)\//)?.[1];
    for (const match of text.matchAll(/(?:from\s*|import\s*\()\s*['"]([^'"]+)['"]/g)) {
      const target = path.normalize(path.join(path.dirname(file), match[1]));
      const feature = target.match(/features\/([^/]+)(.*)/);
      if (feature && feature[1] !== owner && feature[2] && !['/index', '/index.ts'].includes(feature[2])) failures.push(`${file}: deep import ${match[1]}`);
    }
    if (!file.includes('/shared/api/') && /\bfetch\s*\(/.test(text)) failures.push(`${file}: HTTP belongs in shared API client`);
  }
}
await walk('frontend/src');
if (failures.length) { console.error(failures.join('\n')); process.exitCode = 1; }
else console.log('PASS: feature public exports and HTTP boundary');
