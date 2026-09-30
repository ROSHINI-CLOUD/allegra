#!/usr/bin/env node
/**
 * Copies the shared sync rules into the API: `npm run sync:shared`.
 *
 * The API compiles with rootDir "src" and NodeNext resolution, so it cannot import
 * packages/shared directly (the web, Convex and the phone can). Rather than keep a
 * hand-written mirror that can drift, these files are generated; tests/infra fails
 * when a copy no longer matches its source.
 */
import { readFile, writeFile } from 'node:fs/promises';

export const SHARED_COPIES = ['songRef.ts', 'library.ts'];

const root = new URL('../', import.meta.url);

/** The API's copy of a shared file: a header, and relative imports with the .js NodeNext wants. */
export function apiCopyOf(name, source) {
  const body = source.replace(/from '(\.\/[^'.]+)'/g, "from '$1.js'");
  return `// GENERATED from packages/shared/${name} by \`npm run sync:shared\`. Do not edit here.\n${body}`;
}

async function main() {
  for (const name of SHARED_COPIES) {
    const source = await readFile(new URL(`packages/shared/${name}`, root), 'utf8');
    await writeFile(new URL(`apps/api/src/shared/${name}`, root), apiCopyOf(name, source));
    console.log(`apps/api/src/shared/${name}`);
  }
}

if (import.meta.url === new URL(process.argv[1], 'file:').href || process.argv[1]?.endsWith('sync-shared.mjs')) {
  await main();
}
