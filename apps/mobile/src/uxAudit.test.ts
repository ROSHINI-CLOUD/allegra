import * as fs from 'fs';
import * as path from 'path';

/**
 * Guards from the 2026-11-15 UX audit. Each one is a defect a listener saw, kept out by reading the source the
 * way `designGuards.test.ts` does.
 */
const SRC = __dirname;

const sources = (dir: string): string[] => fs.readdirSync(dir).flatMap(name => {
  const p = path.join(dir, name);
  if (fs.statSync(p).isDirectory()) return name === '__tests__' ? [] : sources(p);
  return /\.tsx?$/.test(p) && !p.includes('.test.') ? [p] : [];
});

const rel = (file: string): string => path.relative(SRC, file).split(path.sep).join('/');

// Owned by another change; move it onto countOf there and delete this line.
const PLURAL_ALLOWED = new Set(['screens/StreamScreen.tsx']);

it('counts come from countOf, so one song never reads "1 songs"', () => {
  const hardcoded = /(\$\{[^}]*(length|count)\}|\{[\w.]*(length|count)\})\s+(songs|playlists|tracks|artists|albums)\b/;
  const found = [...sources(path.join(SRC, 'screens')), ...sources(path.join(SRC, 'components'))].flatMap(file => fs.readFileSync(file, 'utf8').split('\n')
    .map((text, i) => ({ text, at: `${rel(file)}:${i + 1}` }))
    .filter(({ text, at }) => hardcoded.test(text) && !text.includes('=== 1') && !PLURAL_ALLOWED.has(at.split(':')[0]))
    .map(({ at }) => at));
  expect(found).toEqual([]);
});

it('a selected style never changes the font weight, which would re-flow its neighbours', () => {
  const found = sources(SRC).filter(file => /\bselected\w*\s*:\s*\{[^}]*fontWeight/.test(fs.readFileSync(file, 'utf8'))).map(rel);
  expect(found).toEqual([]);
});

it('the Library tabs keep their underline space, so picking a tab moves nothing', () => {
  const library = fs.readFileSync(path.join(SRC, 'screens', 'LibraryScreen.tsx'), 'utf8');
  expect(library).toMatch(/\btab:\s*\{[^}]*borderBottomWidth: 2[^}]*borderColor: 'transparent'/);
  expect(library).toMatch(/\bselected:\s*\{\s*borderColor: Signal\.wave\s*\}/);
});
