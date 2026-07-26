/**
 * v2 Home — ported from the design prototype's `isHome` screen.
 *
 * Prototype reference: `v2-spec/linear-screens/00_issite.html`.
 *
 * Structure (matching the design exactly):
 *   badge row (lock icon + anonymity badge + capability line)
 *   h1 hero
 *   lede
 *   action card
 *     ├ tab bar (in-card) + ⌘V paste hint on the right
 *     └ active tab panel — pickup is a two-column split:
 *         left: caption + six code cells (+ mobile paste button)
 *         right: supported-content list
 *   最近分享 list
 *
 * The `data-r` attributes are load-bearing: the theme stylesheets use them for
 * the responsive collapse (single column, scrollable tabs, grid code cells).
 */
import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { RecentEntry } from '@/lib/recent';
import { CodeCells } from '../components/CodeCells';
import { Icon } from '../components/IconSprite';
import { RecentList } from '../components/RecentList';
import { SendFilePanel } from '../components/SendFilePanel';
import { SendTextPanel } from '../components/SendTextPanel';
import { CollectionJoinPanel } from '../components/CollectionJoinPanel';

export type HomeTab = 'pickup' | 'file' | 'text' | 'collection';

const TABS: Array<{ id: HomeTab; icon: string }> = [
  { id: 'pickup', icon: 'i-in' },
  { id: 'file', icon: 'i-up' },
  { id: 'text', icon: 'i-pen' },
  { id: 'collection', icon: 'i-inbox' },
];

const SUPPORTED: Array<{ icon: string; key: string }> = [
  { icon: 'i-img', key: 'v2.supportedPreview' },
  { icon: 'i-file', key: 'v2.supportedMarkdown' },
  { icon: 'i-box', key: 'v2.supportedMulti' },
];

export interface HomeProps {
  heroTitle?: string;
  heroSubtitle?: string;
  onSubmitCode: (code: string) => void;
  onOpenRecent: (entry: RecentEntry) => void;
  onCopyCode: (entry: RecentEntry) => void;
  onCopyLink: (entry: RecentEntry) => void;
  /** Show the ⌘V hint (design exposes this as a prop, default on). */
  showKeyHint?: boolean;
}

export function Home({
  heroTitle,
  heroSubtitle,
  onSubmitCode,
  onOpenRecent,
  onCopyCode,
  onCopyLink,
  showKeyHint = true,
}: HomeProps) {
  const { t } = useTranslation();
  const [tab, setTab] = useState<HomeTab>('pickup');
  const [code, setCode] = useState('');

  const handlePaste = useCallback(async () => {
    try {
      const text = await navigator.clipboard.readText();
      const cleaned = text.toUpperCase().replace(/[^0-9C]/g, '').slice(0, 6);
      if (cleaned) setCode(cleaned);
    } catch {
      /* clipboard permission denied — the user can still type */
    }
  }, []);

  return (
    <div
      data-r="pad"
      style={{
        maxWidth: 920,
        width: '100%',
        margin: '0 auto',
        padding: '52px 24px 40px',
        flex: 1,
      }}
    >
      {/* Badge row */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          marginBottom: 16,
          flexWrap: 'wrap',
        }}
      >
        <span
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            fontSize: 12,
            color: 'var(--tx2)',
            background: 'var(--p1)',
            border: '1px solid var(--ln)',
            padding: '4px 10px',
            borderRadius: 999,
          }}
        >
          <Icon name="i-lock" size={12} />
          {t('v2.badge')}
        </span>
        <span style={{ fontSize: 12, color: 'var(--tx3)' }}>
          {t('v2.badgeMeta',{max:'10 GB'})}
        </span>
      </div>

      <h1
        data-r="hero"
        style={{
          fontSize: 44,
          fontWeight: 700,
          lineHeight: 1.1,
          letterSpacing: '-0.03em',
          marginBottom: 10,
          color: 'var(--tx)',
        }}
      >
        {heroTitle || t('v2.heroTitle')}
      </h1>
      <p style={{ fontSize: 15, color: 'var(--tx2)', margin: 0, maxWidth: 520 }}>
        {heroSubtitle || t('v2.heroSubtitle')}
      </p>

      {/* Action card */}
      <div
        style={{
          marginTop: 36,
          background: 'var(--pn)',
          border: '1px solid var(--ln)',
          borderRadius: 14,
          overflow: 'hidden',
          boxShadow: 'var(--sh)',
        }}
      >
        {/* Tab bar lives INSIDE the card (unlike the old UI) */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '10px 12px',
            borderBottom: '1px solid var(--ln)',
          }}
        >
          <div
            data-r="tabs"
            style={{
              display: 'flex',
              gap: 2,
              background: 'var(--p1)',
              border: '1px solid var(--ln)',
              borderRadius: 9,
              padding: 3,
            }}
          >
            {TABS.map((tabDef) => {
              const active = tab === tabDef.id;
              return (
                <button
                  key={tabDef.id}
                  type="button"
                  data-yd="tab"
                  onClick={() => setTab(tabDef.id)}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 6,
                    padding: '6px 13px',
                    borderRadius: 6,
                    fontSize: 13,
                    cursor: 'pointer',
                    whiteSpace: 'nowrap',
                    fontFamily: 'inherit',
                    border: 'none',
                    background: active ? 'var(--pn)' : 'transparent',
                    color: active ? 'var(--tx)' : 'var(--tx2)',
                    fontWeight: active ? 600 : 500,
                    boxShadow: active ? 'var(--sh)' : 'none',
                  }}
                >
                  <Icon name={tabDef.icon} size={14} />
                  {t(`v2.tabs.${tabDef.id}`)}
                </button>
              );
            })}
          </div>

          {showKeyHint && (
            <div
              data-r="hide-sm"
              style={{
                marginLeft: 'auto',
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                fontSize: 12,
                color: 'var(--tx3)',
              }}
            >
              <span style={keycap}>⌘</span>
              <span style={{ ...keycap, fontFamily: "'JetBrains Mono',monospace" }}>
                V
              </span>
              <span>{t('v2.pasteHint')}</span>
            </div>
          )}
        </div>

        {tab === 'pickup' && (
          <div
            data-r="two-col"
            style={{
              padding: '26px 22px 24px',
              display: 'grid',
              gridTemplateColumns: '1fr 280px',
              gap: 30,
              alignItems: 'start',
            }}
          >
            <div>
              <div style={{ fontSize: 12, color: 'var(--tx3)', marginBottom: 10 }}>
                {t('v2.codeLabel')}
              </div>
              <CodeCells
                value={code}
                onChange={setCode}
                onComplete={onSubmitCode}
                autoFocus
              />
              <div data-r="mob-only" style={{ marginTop: 12, alignItems: 'center' }}>
                <button
                  type="button"
                  data-yd="quiet"
                  onClick={handlePaste}
                  style={{
                    flex: 1,
                    justifyContent: 'center',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 6,
                    fontSize: 13,
                    color: 'var(--tx2)',
                    border: '1px solid var(--ln)',
                    borderRadius: 9,
                    padding: '10px 12px',
                    cursor: 'pointer',
                    whiteSpace: 'nowrap',
                    background: 'transparent',
                    fontFamily: 'inherit',
                  }}
                >
                  <Icon name="i-copy" size={14} />
                  {t('v2.pasteHint')}
                </button>
              </div>
            </div>

            <div
              data-r="side"
              style={{ borderLeft: '1px solid var(--ln)', paddingLeft: 24 }}
            >
              <div style={{ fontSize: 12, color: 'var(--tx3)', marginBottom: 12 }}>
                支持的内容
              </div>
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 10,
                  fontSize: 13,
                  color: 'var(--tx2)',
                }}
              >
                {SUPPORTED.map((s) => (
                  <div
                    key={s.key}
                    style={{ display: 'flex', gap: 9, alignItems: 'center' }}
                  >
                    <Icon
                      name={s.icon}
                      size={15}
                      style={{ color: 'var(--act)', flexShrink: 0 }}
                    />
                    {t(s.key)}
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {tab === 'file' && <SendFilePanel />}
        {tab === 'text' && <SendTextPanel />}
        {tab === 'collection' && <CollectionJoinPanel />}
      </div>

      <RecentList
        onOpen={onOpenRecent}
        onCopyCode={onCopyCode}
        onCopyLink={onCopyLink}
      />
    </div>
  );
}

const keycap: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  minWidth: 18,
  height: 18,
  padding: '0 4px',
  borderRadius: 5,
  border: '1px solid var(--ln)',
  background: 'var(--p1)',
  fontSize: 11,
  color: 'var(--tx2)',
};

export default Home;
