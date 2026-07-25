/**
 * CodeCells — the six-box pickup-code input, ported from the design prototype.
 *
 * Prototype reference: `v2-spec/linear-screens/00_issite.html`, `tabPickup`.
 * The design shows six discrete cells, the active one ringed in the accent
 * colour with a caret. A single hidden input owns the real value so mobile
 * keyboards, paste, and IME all behave; the cells are pure presentation.
 *
 * Behaviour required by the design README:
 *   「取件码输入完自动提交」 — auto-submits on the 6th character.
 *
 * Accepts a 6-digit pickup code or `C` + 5 digits for a collection box.
 */
import { useEffect, useRef, useState, type CSSProperties } from 'react';

const LEN = 6;

export interface CodeCellsProps {
  value: string;
  onChange: (v: string) => void;
  /** Fired when the 6th character lands. */
  onComplete: (v: string) => void;
  autoFocus?: boolean;
  disabled?: boolean;
}

/** Keep only characters the backend accepts, uppercase the leading C. */
function sanitise(raw: string): string {
  const s = raw.toUpperCase().replace(/[^0-9C]/g, '');
  // `C` is only meaningful as the first character (collection code).
  return (s[0] === 'C' ? 'C' + s.slice(1).replace(/C/g, '') : s.replace(/C/g, '')).slice(
    0,
    LEN,
  );
}

const cellBase: CSSProperties = {
  flex: 1,
  maxWidth: 96,
  height: 72,
  borderRadius: 12,
  background: 'var(--p2)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  fontFamily: "'JetBrains Mono',monospace",
  fontSize: 30,
  fontWeight: 500,
  color: 'var(--tx)',
};

export function CodeCells({
  value,
  onChange,
  onComplete,
  autoFocus,
  disabled,
}: CodeCellsProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [focused, setFocused] = useState(false);
  // Guard so a completed code fires onComplete once, not on every re-render.
  const firedFor = useRef<string | null>(null);

  useEffect(() => {
    if (autoFocus) inputRef.current?.focus();
  }, [autoFocus]);

  useEffect(() => {
    if (value.length === LEN) {
      if (firedFor.current !== value) {
        firedFor.current = value;
        onComplete(value);
      }
    } else {
      firedFor.current = null;
    }
  }, [value, onComplete]);

  const chars = value.split('');
  const activeIndex = Math.min(value.length, LEN - 1);

  return (
    <div
      data-r="coderow"
      onClick={() => inputRef.current?.focus()}
      style={{ display: 'flex', gap: 8, alignItems: 'center', cursor: 'text' }}
    >
      <div data-r="cells" style={{ display: 'flex', gap: 8, flex: 1 }}>
        {Array.from({ length: LEN }).map((_, i) => {
          const ch = chars[i];
          const isActive = focused && i === activeIndex && value.length < LEN;
          return (
            <div
              key={i}
              data-r="cell"
              style={{
                ...cellBase,
                border: isActive
                  ? '1px solid var(--ac)'
                  : `1px solid ${ch ? 'var(--ln2)' : 'var(--ln)'}`,
                boxShadow: isActive ? '0 0 0 3px var(--acs)' : undefined,
              }}
            >
              {ch ?? (isActive ? <Caret /> : null)}
            </div>
          );
        })}
      </div>

      {/* The real input: visually hidden but focusable, so paste / IME / mobile
          keyboards work. `inputMode` keeps the numeric pad up on phones. */}
      <input
        ref={inputRef}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(sanitise(e.target.value))}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        inputMode="numeric"
        autoComplete="one-time-code"
        aria-label="取件码"
        maxLength={LEN}
        style={{
          position: 'absolute',
          width: 1,
          height: 1,
          padding: 0,
          margin: -1,
          overflow: 'hidden',
          clip: 'rect(0 0 0 0)',
          whiteSpace: 'nowrap',
          border: 0,
        }}
      />
    </div>
  );
}

/** Blinking caret matching the prototype's 1.5×30px accent bar. */
function Caret() {
  return (
    <span
      style={{
        width: 1.5,
        height: 30,
        background: 'var(--act)',
        animation: 'ydCaret 1s steps(1) infinite',
      }}
    />
  );
}

export default CodeCells;
