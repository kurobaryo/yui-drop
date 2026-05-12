/**
 * ModePicker — auto / light / dark, expressed as three glyphs in a pill.
 */
import type { WashiColors, WashiMode } from '../palettes';

export interface ModePickerProps {
  c: WashiColors;
  mode: WashiMode;
  setMode: (m: WashiMode) => void;
}

const OPTIONS: Array<[WashiMode, string]> = [
  ['auto', '○'],
  ['light', '☀'],
  ['dark', '☾'],
];

export function ModePicker({ c, mode, setMode }: ModePickerProps) {
  return (
    <div
      style={{
        display: 'flex',
        border: `1px solid ${c.soft}`,
        borderRadius: 999,
        overflow: 'hidden',
        background: `${c.paper}cc`,
      }}
    >
      {OPTIONS.map(([k, ic]) => (
        <button
          key={k}
          onClick={() => setMode(k)}
          title={k}
          style={{
            padding: '6px 10px',
            border: 'none',
            cursor: 'pointer',
            fontSize: 13,
            background: mode === k ? c.ink : 'transparent',
            color: mode === k ? c.paper : c.sub,
            fontFamily: 'inherit',
          }}
        >
          {ic}
        </button>
      ))}
    </div>
  );
}

export default ModePicker;
