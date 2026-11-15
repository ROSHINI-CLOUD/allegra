import { Radius, Space } from '../constants/allegraTheme';

/**
 * The collapsed mini player's outline, shared with the player sheet's resting edge.
 *
 * The player sheet (NowPlayingScreen, ConnectRemotePlayer) closes onto the mini player's top edge as one full-width
 * surface with `SHEET_TOP_RADIUS` corners, cut square at the nav bar, and draws a mini-player surface while it lands.
 * RootNavigator renders the mini player after the stack, so the pill fades in on top of that stub. When the pill was
 * inset `Space.sm` with its own 16pt corners, the stub's edges and corners showed around it: two mini players at the
 * end of every close, until the route popped and the stub vanished in one frame. The pill now takes the stub's exact
 * outline, so the close settles on one shape and nothing pops when the route goes.
 */
export const SHEET_TOP_RADIUS = Radius.panel;

/** The pill reaches both screen edges, as the sheet does. */
export const MINI_SHELL_SIDE_INSET = 0;

/**
 * The inset the shell used to have outside it, moved inside, so the cover, title and play button stay exactly where
 * they were while the surface widens.
 */
export const MINI_CONTENT_SIDE_INSET = Space.sm;

/** The row's own right padding and the play button's offset from it (PillPlayer styles.row / playButtonOffset). */
export const MINI_ROW_PADDING_RIGHT = Space.xxs;
export const MINI_PLAY_OFFSET = Space.xxs;

/** Where the play button's right edge sits from the screen's right edge: 20, as when the shell was inset (Space.sm + 4 + 4). */
export const miniPlayButtonRightGap = (): number =>
  MINI_SHELL_SIDE_INSET + MINI_CONTENT_SIDE_INSET + MINI_ROW_PADDING_RIGHT + MINI_PLAY_OFFSET;

/** The pill shell's outline: the sheet's resting edge, full width, rounded on top, square on the nav bar. */
export const miniShellOutline = {
  left: MINI_SHELL_SIDE_INSET,
  right: MINI_SHELL_SIDE_INSET,
  borderTopLeftRadius: SHEET_TOP_RADIUS,
  borderTopRightRadius: SHEET_TOP_RADIUS,
  borderBottomLeftRadius: 0,
  borderBottomRightRadius: 0,
} as const;
