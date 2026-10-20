import { stripTypeScriptTypes } from 'node:module';
import { z } from 'zod';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
const root = path.resolve(import.meta.dirname, '..');
const destination = path.resolve(root, '../contracts/schemas');
const update = process.argv.includes('--write');
const schemas = {
  identity: ['orgSchema', 'sessionSchema', 'memberSchema'],
  events: ['eventInputSchema', 'eventSchema', 'faqInputSchema', 'faqSchema', 'knowledgeSchema', 'eventPatchSchema', 'faqUpdateSchema', 'knowledgeImportSchema'],
  calling: ['outcomeSchema', 'participantSchema', 'queueSchema', 'importRowSchema', 'importPreviewSchema'],
  tickets: ['ticketInputSchema', 'ticketSchema'],
  credentials: ['credentialSchema', 'credentialInputSchema', 'issuedSchema'],
};
{
  await mkdir(destination, { recursive: true });
  for (const [module, exports] of Object.entries(schemas)) {
    const source = await readFile(path.join(root, `src/shared/contracts/${module}.ts`), 'utf8');
    const javascript = stripTypeScriptTypes(source).replaceAll("'zod'", JSON.stringify(import.meta.resolve('zod')));
    const loaded = await import(`data:text/javascript;base64,${Buffer.from(javascript).toString('base64')}`);
    for (const name of exports) {
      const content = JSON.stringify(z.toJSONSchema(loaded[name]), null, 2) + '\n';
      const target = path.join(destination, `${name}.json`);
      if (update) await writeFile(target, content);
      else if (await readFile(target, 'utf8') !== content) throw new Error(`Contract drift: ${name}`);
    }
  }
  console.log(update ? 'Wrote JSON Schema contracts' : 'PASS: DTO/JSON Schema contracts match');
}
