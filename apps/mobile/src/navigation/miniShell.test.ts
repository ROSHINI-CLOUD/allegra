import { readFileSync } from 'fs';
import { join } from 'path';
import { Radius, Space } from '../constants/allegraTheme';
import { MINI_SHELL_SIDE_INSET, SHEET_TOP_RADIUS, miniPlayButtonRightGap, miniShellOutline } from './miniShell';

// The theme builds its curves with Reanimated's Easing, which Jest cannot load here; only the numbers matter.
jest.mock('react-native-reanimated', () => {
  const curve = (): unknown => curve;
  return { Easing: new Proxy({}, { get: () => curve }) };
});

const source =(path: string) => readFileSync(join(__dirname, '..', path), 'utf8');

// Regression: the player sheet closed onto a full-width stub while the pill above it was inset with its own corners,
// so the end of every close showed two mini players until the route popped.
describe('mini player outline', () => {
  it('fills the width the sheet lands on', () => {
    expect(MINI_SHELL_SIDE_INSET).toBe(0);
    expect(miniShellOutline.left).toBe(0);
    expect(miniShellOutline.right).toBe(0);
  });

  it('has the sheet’s top corners and a square edge on the nav bar, where the sheet is clipped', () => {
    expect(miniShellOutline.borderTopLeftRadius).toBe(SHEET_TOP_RADIUS);
    expect(miniShellOutline.borderTopRightRadius).toBe(SHEET_TOP_RADIUS);
    expect(miniShellOutline.borderBottomLeftRadius).toBe(0);
    expect(miniShellOutline.borderBottomRightRadius).toBe(0);
    expect(SHEET_TOP_RADIUS).toBe(Radius.panel);
  });

  it('keeps the play button where it was while the surface widens', () => {
    // The old shell: inset Space.sm, row padding 4, button offset 4.
    expect(miniPlayButtonRightGap()).toBe(Space.sm + Space.xxs + Space.xxs);
  });

  it('is the outline the pill and both player sheets draw', () => {
    const pill = source('components/PillPlayer.tsx');
    expect(pill).toMatch(/shell: \{[^}]*\.\.\.miniShellOutline/);
    expect(pill).not.toMatch(/shell: \{[^}]*left: Space\.sm/);
    expect(pill).not.toMatch(/shell: \{[^}]*borderRadius:/);
    for (const sheet of ['screens/NowPlayingScreen.tsx', 'components/connect/ConnectRemotePlayer.tsx']) {
      const text = source(sheet);
      expect(text).toMatch(/borderTopLeftRadius: SHEET_TOP_RADIUS/);
      expect(text).toMatch(/borderTopRightRadius: SHEET_TOP_RADIUS/);
      expect(text).not.toMatch(/borderTopLeftRadius: Radius\.panel/);
    }
  });
});
