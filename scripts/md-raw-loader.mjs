import { readFile } from 'node:fs/promises';

const rawQuery = '?raw';

export async function resolve(specifier, context, nextResolve) {
  if (specifier.endsWith(rawQuery)) {
    const resolved = await nextResolve(specifier.slice(0, -rawQuery.length), context);
    return {
      url: `${resolved.url}${rawQuery}`,
      shortCircuit: true,
    };
  }

  return nextResolve(specifier, context);
}

export async function load(url, context, nextLoad) {
  if (url.endsWith(rawQuery)) {
    const source = await readFile(new URL(url.slice(0, -rawQuery.length)), 'utf8');
    return {
      format: 'module',
      source: `export default ${JSON.stringify(source)};`,
      shortCircuit: true,
    };
  }

  return nextLoad(url, context);
}
