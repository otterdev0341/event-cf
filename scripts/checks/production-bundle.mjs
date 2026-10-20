import { readFile, readdir } from 'node:fs/promises';
const files = await readdir('frontend/dist/assets');
for (const file of files.filter(name => name.endsWith('.js'))) {
  const contents = await readFile(`frontend/dist/assets/${file}`, 'utf8');
  for (const marker of ['admin@otterheaven.com', 'passwordpassword', 'demo_only_not_a_real_key_', 'Designing what comes next']) {
    if (contents.includes(marker)) throw new Error(`Development fixture leaked to production: ${file}`);
  }
}
console.log('PASS: production bundle excludes mock credentials and fixtures');
