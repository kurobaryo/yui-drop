/**
 * v2 site header — ported from the design prototype.
 *
 * Prototype reference: `v2-spec/linear-screens/00_issite.html`, the sticky
 * top bar. Styling stays inline-with-tokens exactly as the prototype does, so
 * this file can be diffed against the design without translation.
 *
 * The bar is translucent (backdrop blur) per the design README.
 */
import type { CSSProperties } from 'react';
import { Link } from 'react-router-dom';

import { Icon } from './IconSprite';

export interface SiteHeaderProps {
  /** Brand name; falls back to the design default. */
  brandName?: string;
  /** Current resolved appearance, for the sun/moon glyph. */
  dark: boolean;
  onToggleMode: () => void;
  /** Language chip label (e.g. 中 / EN / 日). */
  langLabel: string;
  onCycleLang: () => void;
  githubUrl?: string;
}

const iconBtn: CSSProperties = {
  width: 30,
  height: 30,
  borderRadius: 8,
  border: '1px solid var(--ln)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  color: 'var(--tx2)',
  cursor: 'pointer',
  transition: '.14s',
  background: 'transparent',
  padding: 0,
};

export function SiteHeader({
  brandName,
  dark,
  onToggleMode,
  langLabel,
  onCycleLang,
  githubUrl = 'https://github.com/kurobaryo/yui-drop',
}: SiteHeaderProps) {
  return (
    <div
      data-r="pad"
      style={{
        position: 'sticky',
        top: 0,
        zIndex: 40,
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        padding: '11px 24px',
        borderBottom: '1px solid var(--ln)',
        // Translucent frosted bar (design README: 顶栏为半透明毛玻璃).
        background: 'color-mix(in srgb, var(--bg) 78%, transparent)',
        backdropFilter: 'saturate(180%) blur(14px)',
        WebkitBackdropFilter: 'saturate(180%) blur(14px)',
      }}
    >
      <Link
        to="/"
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          marginRight: 'auto',
          cursor: 'pointer',
          color: 'inherit',
        }}
      >
        <div
          style={{
            width: 28,
            height: 28,
            borderRadius: 9,
            background: 'var(--ac)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            boxShadow: '0 3px 10px var(--acs)',
            flexShrink: 0,
          }}
        >
          <Icon name="i-logo" size={17} style={{ color: '#fff' }} />
        </div>
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <div
            style={{
              fontSize: 14.5,
              fontWeight: 700,
              letterSpacing: '-0.02em',
              lineHeight: 1.2,
              color: 'var(--tx)',
            }}
          >
            {brandName || 'Yui Drop'}
          </div>
          <div
            data-r="hide-sm"
            style={{
              fontSize: 9.5,
              fontWeight: 500,
              letterSpacing: '.16em',
              lineHeight: 1.3,
              color: 'var(--tx3)',
            }}
          >
            文件快递柜
          </div>
        </div>
      </Link>

      <button
        type="button"
        onClick={onCycleLang}
        data-yd="icon-btn"
        title="切换语言"
        style={{
          ...iconBtn,
          width: 'auto',
          padding: '0 9px',
          gap: 6,
          fontSize: 12,
          fontFamily: 'inherit',
        }}
      >
        <Icon name="i-lang" size={14} />
        {langLabel}
      </button>

      <button
        type="button"
        onClick={onToggleMode}
        data-yd="icon-btn"
        title="切换亮暗"
        style={{ ...iconBtn, color: 'var(--act)' }}
      >
        <Icon name={dark ? 'i-moon' : 'i-sun'} size={15} />
      </button>

      <span style={{ width: 1, height: 18, background: 'var(--ln)' }} />

      <a
        href={githubUrl}
        target="_blank"
        rel="noopener noreferrer"
        data-yd="icon-btn"
        title="在 GitHub 查看项目"
        style={iconBtn}
      >
        <Icon name="i-gh" size={15} />
      </a>
    </div>
  );
}

export default SiteHeader;
