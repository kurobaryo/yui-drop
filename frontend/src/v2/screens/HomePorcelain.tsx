/**
 * Home for the porcelain theme — a single centred column.
 *
 *   h1 site name + one-line intro
 *   segmented control: 取件 | 寄出
 *     取件 → six code cells + hint, then a quiet recent list
 *     寄出 → SendComposer (text and files in one card)
 *   收集箱 (opened from the header) replaces the panel, with a way back
 *
 * Pickup submission, recent-list actions and the pickup sheet are owned by
 * V2App exactly as for the default Home; this screen only lays them out.
 * Both panels stay mounted while hidden so a half-written message or picked
 * files survive switching tabs.
 */
import { useCallback, useState, type CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';

import type { RecentEntry } from '@/lib/recent';
import { CodeCells } from '../components/CodeCells';
import { CollectionJoinPanel } from '../components/CollectionJoinPanel';
import { RecentList } from '../components/RecentList';
import { SendComposer } from '../components/SendComposer';
import { haptic } from '../haptics';

type Tab = 'pickup' | 'send';

export interface HomePorcelainProps {
  /** Admin site name; the page title. */
  brandName?: string;
  /** Admin subtitle; falls back to the built-in one-line intro. */
  heroSubtitle?: string;
  /** Show the collection-box panel instead of pickup / send. */
  collectionOpen: boolean;
  onCloseCollection: () => void;
  onSubmitCode: (code: string) => void;
  onOpenRecent: (entry: RecentEntry) => void;
  onCopyCode: (entry: RecentEntry) => void;
  onCopyLink: (entry: RecentEntry) => void;
}

export function HomePorcelain({
  brandName,
  heroSubtitle,
  collectionOpen,
  onCloseCollection,
  onSubmitCode,
  onOpenRecent,
  onCopyCode,
  onCopyLink,
}: HomePorcelainProps) {
  const { t } = useTranslation();
  const [tab, setTab] = useState<Tab>('pickup');
  const [code, setCode] = useState('');

  const pasteCode = useCallback(async () => {
    try {
      const text = await navigator.clipboard.readText();
      const cleaned = text.toUpperCase().replace(/[^0-9C]/g, '').slice(0, 6);
      if (cleaned) setCode(cleaned);
    } catch {
      /* clipboard permission denied — the user can still type or ⌘V */
    }
  }, []);

  const showPickup = !collectionOpen && tab === 'pickup';
  const showSend = !collectionOpen && tab === 'send';

  return (
    <main
      data-p="main"
      style={{
        flex: 1,
        width: '100%',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        padding: '8vh 20px 40px',
      }}
    >
      <h1
        data-p="title"
        style={{
          fontSize: 34,
          fontWeight: 650,
          lineHeight: 1.2,
          letterSpacing: '-0.03em',
          textAlign: 'center',
          textWrap: 'balance',
          color: 'var(--tx)',
        }}
      >
        {brandName || 'Yui Drop'}
      </h1>
      <p
        data-p="sub"
        style={{
          margin: '10px 0 0',
          maxWidth: 520,
          fontSize: 15,
          textAlign: 'center',
          textWrap: 'balance',
          color: 'var(--tx2)',
        }}
      >
        {heroSubtitle || t('v2.porcelain.intro')}
      </p>

      {collectionOpen ? (
        <section data-p="panel" style={{ ...panel, marginTop: 32 }}>
          <button type="button" data-yd="link" onClick={onCloseCollection} style={backLink}>
            ← {t('v2.porcelain.back')}
          </button>
          <div style={{ ...card, marginTop: 10 }}>
            <CollectionJoinPanel />
          </div>
        </section>
      ) : (
        <div role="tablist" aria-label={t('v2.porcelain.modeLabel')} data-p="seg" style={seg}>
          {(['pickup', 'send'] as const).map((id) => {
            const on = tab === id;
            return (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={on}
                onClick={() => {
                  if (on) return;
                  haptic();
                  setTab(id);
                }}
                style={{
                  ...segButton,
                  // --p2: white in light, a step above the panel in dark, so
                  // the active pill reads as raised against the track.
                  background: on ? 'var(--p2)' : 'transparent',
                  color: on ? 'var(--tx)' : 'var(--tx2)',
                  fontWeight: on ? 600 : 500,
                  boxShadow: on ? '0 1px 3px rgba(0, 0, 0, 0.08)' : 'none',
                }}
              >
                {t(`v2.porcelain.${id}`)}
              </button>
            );
          })}
        </div>
      )}

      <section data-p="panel" role="tabpanel" style={{ ...panel, display: showPickup ? undefined : 'none' }}>
        <CodeCells value={code} onChange={setCode} onComplete={onSubmitCode} autoFocus={showPickup} />
        <p style={{ margin: '14px 0 0', textAlign: 'center', fontSize: 13, color: 'var(--tx3)' }}>
          {t('v2.porcelain.pickupHint')}
          {' · '}
          <button type="button" data-yd="link" onClick={() => void pasteCode()} style={inlineLink}>
            {t('v2.porcelain.paste')}
          </button>
        </p>
        <RecentList
          variant="quiet"
          onOpen={onOpenRecent}
          onCopyCode={onCopyCode}
          onCopyLink={onCopyLink}
        />
      </section>

      <section data-p="panel" role="tabpanel" style={{ ...panel, display: showSend ? undefined : 'none' }}>
        <SendComposer active={showSend} />
      </section>
    </main>
  );
}

const panel: CSSProperties = {
  width: 'min(560px, 100%)',
  marginTop: 28,
};

const card: CSSProperties = {
  background: 'var(--pn)',
  borderRadius: 'var(--rc)',
  boxShadow: 'var(--sh), inset 0 0 0 1px var(--ln)',
};

const seg: CSSProperties = {
  display: 'inline-flex',
  marginTop: 36,
  padding: 4,
  borderRadius: 999,
  background: 'var(--fill)',
};

const segButton: CSSProperties = {
  padding: '8px 26px',
  border: 0,
  borderRadius: 999,
  fontFamily: 'inherit',
  fontSize: 14,
  cursor: 'pointer',
  transition: 'background .15s, color .15s',
};

const inlineLink: CSSProperties = {
  padding: 0,
  border: 0,
  background: 'transparent',
  color: 'inherit',
  fontFamily: 'inherit',
  fontSize: 'inherit',
  textDecoration: 'underline',
  textDecorationColor: 'var(--ln2)',
  textUnderlineOffset: 3,
  cursor: 'pointer',
};

const backLink: CSSProperties = {
  padding: '4px 0',
  border: 0,
  background: 'transparent',
  color: 'var(--tx3)',
  fontFamily: 'inherit',
  fontSize: 13,
  cursor: 'pointer',
};

export default HomePorcelain;
