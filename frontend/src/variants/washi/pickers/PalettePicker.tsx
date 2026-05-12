/**
 * PalettePicker — 4 round colour swatches inside a pill. The active swatch
 * shows a paper-coloured halo + ink-coloured ring (1:1 with washi.jsx).
 */
import { PALETTE_DOT_COLORS, PALETTE_OPTIONS, type WashiColors, type WashiPaletteName } from '../palettes';

export interface PalettePickerProps {
  c: WashiColors;
  palette: WashiPaletteName;
  setPalette: (p: WashiPaletteName) => void;
}

export function PalettePicker({ c, palette, setPalette }: PalettePickerProps) {
  return (
    <div
      style={{
        display: 'flex',
        gap: 6,
        padding: '5px 8px',
        border: `1px solid ${c.soft}`,
        borderRadius: 999,
        background: `${c.paper}cc`,
      }}
    >
      {PALETTE_OPTIONS.map((o) => (
        <button
          key={o}
          onClick={() => setPalette(o)}
          title={o}
          aria-label={o}
          style={{
            width: 16,
            height: 16,
            borderRadius: '50%',
            background: PALETTE_DOT_COLORS[o],
            border: 'none',
            padding: 0,
            cursor: 'pointer',
            boxShadow: palette === o ? `0 0 0 2px ${c.paper}, 0 0 0 3.5px ${c.ink}` : 'none',
          }}
        />
      ))}
    </div>
  );
}

export default PalettePicker;
