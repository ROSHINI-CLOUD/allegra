import * as fs from 'fs';
import * as path from 'path';

/**
 * The info card's cross. Its corner placement belongs on the touch target (wrapperStyle), not on the disc inside
 * it: placed on the disc, the target was 0 tall and the cross could not be tapped (the card closed only from outside).
 * The repo has no component renderer in Jest, so this reads the source, as designGuards does.
 */
const source = fs.readFileSync(path.join(__dirname, 'InfoTour.tsx'), 'utf8');

describe('InfoTour close cross', () => {
  it('puts its corner placement on the touch target', () => {
    expect(source).toMatch(/accessibilityLabel="Close"\s+wrapperStyle=\{styles\.closeWrap\}\s+style=\{styles\.close\}/);
    expect(source).toMatch(/closeWrap: \{ position: 'absolute', top: 10, right: 10, zIndex: 5 \}/);
  });

  it('keeps absolute placement out of the disc style', () => {
    const disc = source.match(/\n\s*close: \{([^}]*)\}/)?.[1] ?? '';
    expect(disc).not.toBe('');
    expect(disc).not.toMatch(/position/);
  });
});
