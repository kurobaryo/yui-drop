/**
 * CodeBlock — monospace pre/code block with copy-to-clipboard, washi-styled.
 *
 * Uses inline styles only (no Tailwind) to match the surrounding washi look:
 *   - background: c.soft (paper-accent tone)
 *   - text:       c.ink
 *   - border:     1px solid c.soft (subtle)
 *   - corner:     8px rounded
 *
 * A small uppercase language tag sits top-left; the "Copy" button sits
 * top-right and flips to "Copied!" for 2 seconds after a successful write.
 */
import { useState } from 'react';
import type { CSSProperties } from 'react';
import type { WashiColors } from '../../variants/washi/palettes';

export interface CodeBlockProps {
  c: WashiColors;
  code: string;
  language?: string;
}

export function CodeBlock({ c, code, language }: CodeBlockProps) {
  const [copied, setCopied] = useState(false);

  const onCopy = async () => {
    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard) {
        await navigator.clipboard.writeText(code);
      } else {
        // Fallback for very old browsers / non-secure contexts.
        const ta = document.createElement('textarea');
        ta.value = code;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
      }
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      /* ignore — clipboard may be blocked */
    }
  };

  const wrapperStyle: CSSProperties = {
    position: 'relative',
    background: c.soft,
    color: c.ink,
    border: `1px solid ${c.ink}14`,
    borderRadius: 8,
    padding: '12px 14px',
    margin: '8px 0 0',
    fontFamily:
      '"JetBrains Mono", "SF Mono", "Menlo", ui-monospace, monospace',
    fontSize: 12.5,
    lineHeight: 1.55,
    overflow: 'auto',
  };

  const tagStyle: CSSProperties = {
    position: 'absolute',
    top: 8,
    left: 12,
    fontSize: 9.5,
    letterSpacing: '0.18em',
    color: c.sub,
    textTransform: 'uppercase',
    fontFamily: 'inherit',
    userSelect: 'none',
    pointerEvents: 'none',
  };

  const btnStyle: CSSProperties = {
    position: 'absolute',
    top: 6,
    right: 8,
    background: c.paper,
    color: c.sub,
    border: `1px solid ${c.ink}1f`,
    borderRadius: 6,
    padding: '4px 10px',
    fontSize: 11,
    letterSpacing: '0.04em',
    cursor: 'pointer',
    fontFamily:
      '"Noto Sans JP", "Noto Sans SC", -apple-system, BlinkMacSystemFont, sans-serif',
  };

  return (
    <div style={wrapperStyle}>
      {language ? <span style={tagStyle}>{language}</span> : null}
      <button type="button" onClick={onCopy} style={btnStyle}>
        {copied ? 'Copied!' : 'Copy'}
      </button>
      <pre
        style={{
          margin: 0,
          paddingTop: language ? 18 : 4,
          paddingRight: 56,
          whiteSpace: 'pre',
          background: 'transparent',
          color: 'inherit',
          fontFamily: 'inherit',
          fontSize: 'inherit',
          lineHeight: 'inherit',
        }}
      >
        <code style={{ fontFamily: 'inherit' }}>{code}</code>
      </pre>
    </div>
  );
}

export default CodeBlock;
