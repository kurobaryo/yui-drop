/**
 * Shared layout constants for the home-screen send panels.
 *
 * 寄文件 / 寄文字 sit behind sibling tabs, so their main column must be the
 * same height — otherwise the card visibly jumps when the user switches tabs.
 * Both panels apply `panelMain` to their left column and `submitButton` to
 * their action button.
 */
import type { CSSProperties } from 'react';

/** Minimum height of a send panel's main column, in px. */
export const PANEL_MIN_HEIGHT = 264;

/** Left column of a send panel: fixed minimum height, contents stretch.
 *
 * `minWidth: 0` is load-bearing. A grid item defaults to `min-width: auto`,
 * which refuses to shrink below its content's intrinsic width — on a 390px
 * phone that let the textarea and the expiry card push the track to 446px and
 * spill past the right edge. */
export const panelMain: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  minHeight: PANEL_MIN_HEIGHT,
  minWidth: 0,
};

/** Primary submit button shared by both send panels. */
export const submitButton: CSSProperties = {
  width: '100%',
  height: 48,
  marginTop: 14,
  border: 'none',
  borderRadius: 10,
  background: 'var(--ac)',
  color: '#fff',
  fontFamily: 'inherit',
  fontSize: 15,
  fontWeight: 600,
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 8,
};

/** Wrapper shared by both panels' two-column grid. */
export const panelGrid: CSSProperties = {
  padding: '26px 22px 24px',
  display: 'grid',
  gridTemplateColumns: '1fr 300px',
  gap: 30,
  alignItems: 'start',
};
