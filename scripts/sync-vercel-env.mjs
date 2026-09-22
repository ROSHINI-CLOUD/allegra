#!/usr/bin/env node
/**
 * Sync apps/api/.env → Vercel (production, preview, development).
 * Never prints secret values — only key names and outcomes.
 *
 * Usage: node scripts/sync-vercel-env.mjs
 */
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const envPath = resolve(root, 'apps/api/.env');

const SKIP = new Set(['NODE_ENV', 'PORT']);
/** Same-origin serverless SPA — blank base uses /api via vercel.json rewrite. */
const FORCE = {
  ALLEGRA_ORIGIN: 'https://allegravibe.vercel.app',
  NEXT_PUBLIC_API_BASE_URL: ''
};

const TARGETS = ['production', 'preview', 'development'];

/** Local-only values that must never ship to Vercel production. */
function isLocalOnly(key, value, map) {
  if (key === 'CONVEX_URL' && /^https?:\/\/(127\.0\.0\.1|localhost)\b/i.test(value)) {
    return true;
  }
  if (key === 'CONVEX_SERVER_SECRET') {
    const url = map.get('CONVEX_URL') ?? '';
    if (!url || /^https?:\/\/(127\.0\.0\.1|localhost)\b/i.test(url)) return true;
  }
  return false;
}

function parseEnv(text) {
  const out = new Map();
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    out.set(key, value);
  }
  return out;
}

function upsert(name, value, target) {
  // --sensitive is only valid for Production/Preview on this plan.
  const args = ['env', 'add', name, target, '--force', '--yes'];
  if (target !== 'development') args.push('--sensitive');
  const result = spawnSync('vercel', args, {
      input: value,
      encoding: 'utf8',
      cwd: root,
      shell: true
    }
  );
  const ok = result.status === 0;
  const err = (result.stderr || result.stdout || '').split(/\r?\n/).filter(Boolean).slice(-2).join(' | ');
  return { ok, err: ok ? '' : err.replace(value, '[redacted]') };
}

const local = parseEnv(readFileSync(envPath, 'utf8'));
for (const [k, v] of Object.entries(FORCE)) {
  local.set(k, v);
}

const keys = [...local.entries()]
  .filter(([k, v]) => !SKIP.has(k) && (Object.hasOwn(FORCE, k) || v !== '') && !isLocalOnly(k, v, local))
  .map(([k]) => k)
  .sort();

console.log(`Syncing ${keys.length} keys to Vercel (${TARGETS.join(', ')})`);
console.log(`Keys: ${keys.join(', ')}`);

let failed = 0;
for (const key of keys) {
  const value = local.get(key) ?? '';
  for (const target of TARGETS) {
    const { ok, err } = upsert(key, value, target);
    if (ok) {
      console.log(`  ok  ${key} → ${target}`);
    } else {
      failed += 1;
      console.log(`  FAIL ${key} → ${target}: ${err}`);
    }
  }
}

if (failed > 0) {
  console.error(`Done with ${failed} failure(s).`);
  process.exit(1);
}
console.log('Done. All keys upserted.');
