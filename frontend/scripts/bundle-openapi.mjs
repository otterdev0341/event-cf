import { readFile } from 'node:fs/promises';
import path from 'node:path';
// Publish one self-contained JSON document. Source contracts stay modular and checked.
export async function bundleOpenApi(root) {
  const directory = path.resolve(root);
  const cache = new Map();
  async function load(file) {
    if (!cache.has(file)) cache.set(file, JSON.parse(await readFile(file, 'utf8')));
    return cache.get(file);
  }
  async function resolve(value, file, trail = []) {
    if (Array.isArray(value)) return Promise.all(value.map(item => resolve(item, file, trail)));
    if (!value || typeof value !== 'object') return value;
    if (value.$ref) {
      const [relative, fragment] = value.$ref.split('#');
      const target = relative ? path.resolve(path.dirname(file), relative) : file;
      if (!target.startsWith(`${directory}${path.sep}`)) throw new Error('Contract reference leaves source directory');
      const identity = `${target}#${fragment ?? ''}`;
      if (trail.includes(identity)) throw new Error(`Circular contract reference: ${identity}`);
      let document = await load(target);
      if (fragment) for (const part of fragment.replace(/^\//, '').split('/')) {
        document = document[part.replaceAll('~1', '/').replaceAll('~0', '~')];
      }
      if (document === undefined) throw new Error(`Unresolved contract reference: ${identity}`);
      const { $ref, ...siblings } = value;
      return { ...await resolve(document, target, [...trail, identity]), ...await resolve(siblings, file, trail) };
    }
    return Object.fromEntries(await Promise.all(Object.entries(value).map(async ([key, item]) => [key, await resolve(item, file, trail)])));
  }
  const file = path.join(directory, 'openapi.json');
  return resolve(await load(file), file);
}
