/**
 * Header + footer for the porcelain theme.
 *
 * Deliberately sparse (see v2/styles/themes/porcelain.css): the header is an
 * accent dot on the left — the site name is the page title, not repeated
 * here — and three quiet controls on the right; the footer is three muted
 * links. Language / appearance handlers are the same ones V2App passes to
 * SiteHeader.
 */
import type { CSSProperties } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

import { Icon } from './IconSprite';

export interface PorcelainHeaderProps {
  /** Accessible name for the home link (the dot has no visible text). */
  brandName?: string;
  dark: boolean;
  onToggleMode: () => void;
  /** Hide the light/dark toggle when the admin has pinned the appearance. */
  lockMode?: boolean;
  langLabel: string;
  onCycleLang: () => void;
  onOpenCollection: () => void;
}

export function PorcelainHeader({
  brandName,
  dark,
  onToggleMode,
  lockMode,
  langLabel,
  onCycleLang,
  onOpenCollection,
}: PorcelainHeaderProps) {
  const { t } = useTranslation();
  return (
    <header
      data-p="header"
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 12,
        padding: '22px 32px',
      }}
    >
      <Link
        to="/"
        aria-label={brandName || 'Yui Drop'}
        style={{ display: 'inline-flex', padding: 8, margin: -8 }}
      >
        <span style={{ width: 10, height: 10, borderRadius: '50%', background: 'var(--ac)' }} />
      </Link>

      <nav style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
        <button type="button" data-yd="icon-btn" onClick={onOpenCollection} style={control}>
          {t('v2.tabs.collection')}
        </button>
        <button
          type="button"
          data-yd="icon-btn"
          onClick={onCycleLang}
          title={t('v2.header.toggleLang')}
          aria-label={t('v2.header.toggleLang')}
          style={control}
        >
          {langLabel}
        </button>
        {!lockMode && (
          <button
            type="button"
            data-yd="icon-btn"
            onClick={onToggleMode}
            title={t('v2.header.toggleMode')}
            aria-label={t('v2.header.toggleMode')}
            style={control}
          >
            <Icon name={dark ? 'i-moon' : 'i-sun'} size={15} />
          </button>
        )}
      </nav>
    </header>
  );
}

export interface PorcelainFooterProps {
  githubUrl?: string;
}

export function PorcelainFooter({
  githubUrl = 'https://github.com/kurobaryo/yui-drop',
}: PorcelainFooterProps) {
  const { t } = useTranslation();
  return (
    <footer
      data-p="footer"
      style={{
        display: 'flex',
        justifyContent: 'center',
        gap: 22,
        padding: '22px 32px',
        fontSize: 12.5,
      }}
    >
      <Link to="/docs" data-yd="link" style={footerLink}>
        {t('v2.footer.docs')}
      </Link>
      <a href={githubUrl} target="_blank" rel="noopener noreferrer" data-yd="link" style={footerLink}>
        GitHub
      </a>
      <Link to="/admin" data-yd="link" style={footerLink}>
        {t('v2.porcelain.admin')}
      </Link>
    </footer>
  );
}

const control: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  minWidth: 30,
  height: 30,
  padding: '0 6px',
  border: 0,
  borderRadius: 8,
  background: 'transparent',
  color: 'var(--tx3)',
  fontFamily: 'inherit',
  fontSize: 13,
  cursor: 'pointer',
  whiteSpace: 'nowrap',
};

const footerLink: CSSProperties = { color: 'var(--tx3)' };
