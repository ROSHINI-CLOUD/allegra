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

// Text-scale audit (TEXT-SCALE-FINDINGS.md): these boxes grow with their text. `minHeight` keeps the number they had,
// so nothing moves at 100% text, and a larger system text opens the box instead of clipping the words.
it('the Search header grows with its title at larger text', () => {
  const search = fs.readFileSync(path.join(SRC, 'screens', 'SearchScreen.tsx'), 'utf8');
  expect(search).toMatch(/\bheader:\s*\{[^}]*minHeight: 52\b/);
  expect(search).not.toMatch(/\bheader:\s*\{[^}]*\bheight: 52\b/);
});

it('the Now Playing chips grow with their label at larger text', () => {
  const header = fs.readFileSync(path.join(SRC, 'components', 'NowPlayingHeader.tsx'), 'utf8');
  expect(header).toMatch(/\bchip:\s*\{[^}]*minHeight: 30\b/);
  expect(header).not.toMatch(/\bchip:\s*\{[^}]*\bheight: 30\b/);
});

it('the lyrics match badge grows with its label at larger text', () => {
  const picker = fs.readFileSync(path.join(SRC, 'components', 'player', 'LyricsPicker.tsx'), 'utf8');
  expect(picker).toMatch(/\bbadge:\s*\{[^}]*minHeight: 22\b/);
  expect(picker).not.toMatch(/\bbadge:\s*\{[^}]*\bheight: 22\b/);
});

it('the Now Playing control strip grows with its timer label at larger text', () => {
  const controls = fs.readFileSync(path.join(SRC, 'components', 'NowPlayingControls.tsx'), 'utf8');
  expect(controls).toMatch(/\bsegment:\s*\{[^}]*minHeight: 44\b/);
  expect(controls).not.toMatch(/\bsegment:\s*\{[^}]*\bheight: 44\b/);
});

it('the Now Playing timer cell grows with its label at larger text', () => {
  const controls = fs.readFileSync(path.join(SRC, 'components', 'NowPlayingControls.tsx'), 'utf8');
  expect(controls).toMatch(/\bsegmentHalf:\s*\{[^}]*minHeight: 44\b/);
  expect(controls).not.toMatch(/\bsegmentHalf:\s*\{[^}]*\bheight: 44\b/);
});

it('the player action buttons grow with their label at larger text', () => {
  const extras = fs.readFileSync(path.join(SRC, 'components', 'player', 'PlayerExtras.tsx'), 'utf8');
  expect(extras).toMatch(/\baction:\s*\{[^}]*minHeight: 48\b/);
  expect(extras).not.toMatch(/\baction:\s*\{[^}]*\bheight: 48\b/);
});
