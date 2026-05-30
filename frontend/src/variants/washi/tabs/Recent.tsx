/**
 * Recent — local-storage-backed list of items minted on this device.
 *
 * Reads via `loadRecent()`. Two sections rendered separately:
 *   1. 最近分享 (kind: 'file' | 'text' | 'multi') — pickup codes
 *   2. 最近收集箱 (kind: 'collection') — rooms we created or joined
 *
 * Each section has its own header + clear button. Each row in the
 * collection section deep-links to /c/{code} for one-tap re-entry.
 *
 * Renders nothing when both sections are empty.
 */
import { useEffect, useState, type CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { Inbox } from 'lucide-react';
import {
  loadRecent,
  saveRecent,
  clearRecent,
  RECENT_CHANGED_EVENT,
  type RecentEntry,
} from '@/lib/recent';
import type { WashiColors } from '../palettes';
import { fmtSize, expiryShort } from '../utils';

export function Recent({ c }: { c: WashiColors }) {
  const { t } = useTranslation();
  const [items, setItems] = useState<RecentEntry[]>([]);
  const [copiedCode, setCopiedCode] = useState<string | null>(null);
  const [copiedLink, setCopiedLink] = useState<string | null>(null);

  useEffect(() => {
    const refresh = () => setItems(loadRecent());
    refresh();
    const onStorage = (e: StorageEvent) => {
      if (e.key === 'yui-drop:recent') refresh();
    };
    window.addEventListener('storage', onStorage);
    window.addEventListener(RECENT_CHANGED_EVENT, refresh);
    const id = window.setTimeout(refresh, 300);
    return () => {
      window.removeEventListener('storage', onStorage);
      window.removeEventListener(RECENT_CHANGED_EVENT, refresh);
      window.clearTimeout(id);
    };
  }, []);

  const shares = items.filter((it) => it.kind !== 'collection');
  const collections = items.filter((it) => it.kind === 'collection');
  if (shares.length === 0 && collections.length === 0) return null;

  const onClearAll = () => {
    clearRecent();
    setItems([]);
  };

  const onClearShares = () => {
    const next = items.filter((it) => it.kind === 'collection');
    saveRecent(next);
    setItems(next);
  };

  const onClearCollections = () => {
    const next = items.filter((it) => it.kind !== 'collection');
    saveRecent(next);
    setItems(next);
  };

  const onCopy = (code: string) => {
    void navigator.clipboard?.writeText(code);
    setCopiedCode(code);
    window.setTimeout(() => {
      setCopiedCode((cur) => (cur === code ? null : cur));
    }, 1500);
  };

  const onCopyLink = (code: string) => {
    const origin =
      typeof window !== 'undefined' && window.location ? window.location.origin : '';
    const path = code.startsWith('C') ? `/c/${code}` : `/s/${code}`;
    void navigator.clipboard?.writeText(`${origin}${path}`);
    setCopiedLink(code);
    window.setTimeout(() => {
      setCopiedLink((cur) => (cur === code ? null : cur));
    }, 1500);
  };

  return (
    <div style={{ marginTop: 48 }}>
      {/* If both sections exist, allow clearing everything in one go. */}
      {shares.length > 0 && collections.length > 0 && (
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 8 }}>
          <button
            onClick={onClearAll}
            style={{
              background: 'transparent',
              border: 'none',
              color: c.sub,
              cursor: 'pointer',
              fontSize: 11,
              opacity: 0.7,
              transition: 'opacity .15s',
            }}
            onMouseEnter={(e) => (e.currentTarget.style.opacity = '1')}
            onMouseLeave={(e) => (e.currentTarget.style.opacity = '0.7')}
          >
            {t('washi.clearAll')}
          </button>
        </div>
      )}

      {shares.length > 0 && (
        <SharesSection
          c={c}
          items={shares}
          onClear={onClearShares}
          copiedCode={copiedCode}
          copiedLink={copiedLink}
          onCopy={onCopy}
          onCopyLink={onCopyLink}
        />
      )}

      {collections.length > 0 && (
        <CollectionsSection
          c={c}
          items={collections}
          onClear={onClearCollections}
          copiedLink={copiedLink}
          onCopyLink={onCopyLink}
          marginTop={shares.length > 0 ? 28 : 0}
        />
      )}
    </div>
  );
}

// ─── Sub-section: pickup-code shares ───────────────────────────────────────

interface SharesProps {
  c: WashiColors;
  items: RecentEntry[];
  onClear: () => void;
  copiedCode: string | null;
  copiedLink: string | null;
  onCopy: (code: string) => void;
  onCopyLink: (code: string) => void;
}

function SharesSection({
  c,
  items,
  onClear,
  copiedCode,
  copiedLink,
  onCopy,
  onCopyLink,
}: SharesProps) {
  const { t } = useTranslation();
  return (
    <section>
      <SectionHeader
        c={c}
        glyph="◷"
        label={t('washi.recent')}
        hint={t('washi.onlyDevice')}
        onClear={onClear}
      />
      <div
        style={{
          border: `1px solid ${c.soft}`,
          borderRadius: 10,
          overflow: 'hidden',
        }}
      >
        {items.map((item, i) => {
          const displayName = item.name
            ? item.name
            : item.kind === 'text'
              ? `text · ${item.code}`
              : item.kind === 'multi'
                ? `${item.fileCount ?? 0} ${t('washi.files')}`
                : item.code;
          const sizeBytes = item.kind === 'multi' ? item.totalSize ?? 0 : item.size ?? 0;
          return (
            <div
              key={item.code + item.created_at}
              data-yui="recent-row"
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 14,
                padding: '12px 16px',
                borderTop: i > 0 ? `1px solid ${c.soft}` : 'none',
                transition: 'background .15s',
              }}
            >
              <CodeChip code={item.code} c={c} />
              <div style={{ flex: 1, fontSize: 14 }}>{displayName}</div>
              <div
                style={{
                  fontFamily: '"JetBrains Mono", monospace',
                  fontSize: 12,
                  color: c.sub,
                  whiteSpace: 'nowrap',
                }}
              >
                {sizeBytes > 0 ? fmtSize(sizeBytes) : ''}
              </div>
              <div
                style={{
                  fontSize: 12,
                  color: c.sub,
                  minWidth: 60,
                  textAlign: 'right',
                  whiteSpace: 'nowrap',
                }}
              >
                {expiryShort(item.expires_at)} {t('washi.remaining')}
              </div>
              <SmallBtn
                c={c}
                active={copiedCode === item.code}
                onClick={() => onCopy(item.code)}
                label={
                  copiedCode === item.code
                    ? '✓ ' + t('washi.copied')
                    : '⎘ ' + t('washi.copy')
                }
              />
              <SmallBtn
                c={c}
                active={copiedLink === item.code}
                onClick={() => onCopyLink(item.code)}
                label={
                  copiedLink === item.code
                    ? '✓ ' + t('washi.copied')
                    : '⎘ ' + t('washi.copy_link')
                }
              />
            </div>
          );
        })}
      </div>
    </section>
  );
}

// ─── Sub-section: collection rooms ─────────────────────────────────────────

interface CollectionsProps {
  c: WashiColors;
  items: RecentEntry[];
  onClear: () => void;
  copiedLink: string | null;
  onCopyLink: (code: string) => void;
  marginTop: number;
}

function CollectionsSection({
  c,
  items,
  onClear,
  copiedLink,
  onCopyLink,
  marginTop,
}: CollectionsProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();

  return (
    <section style={{ marginTop }}>
      <SectionHeader
        c={c}
        glyph={<Inbox size={13} strokeWidth={2.2} />}
        label={t('washi.recentCollections')}
        hint={t('washi.onlyDevice')}
        onClear={onClear}
      />
      <div
        style={{
          border: `1px solid ${c.soft}`,
          borderRadius: 10,
          overflow: 'hidden',
        }}
      >
        {items.map((item, i) => (
          <div
            key={item.code + item.created_at}
            data-yui="recent-collection-row"
            onClick={() => navigate(`/c/${item.code}`)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 14,
              padding: '12px 16px',
              borderTop: i > 0 ? `1px solid ${c.soft}` : 'none',
              cursor: 'pointer',
              transition: 'background .15s',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = `${c.accent}08`;
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'transparent';
            }}
          >
            <CodeChip code={item.code} c={c} />
            <div style={{ flex: 1, fontSize: 14 }}>
              {item.name || t('washi.collectionUnnamed')}
            </div>
            <div
              style={{
                fontSize: 11,
                color: c.sub,
                whiteSpace: 'nowrap',
                opacity: 0.85,
              }}
            >
              {item.isCreator ? t('washi.collectionCreator') : t('washi.collectionMember')}
            </div>
            <SmallBtn
              c={c}
              active={copiedLink === item.code}
              onClick={(e) => {
                e?.stopPropagation();
                onCopyLink(item.code);
              }}
              label={
                copiedLink === item.code
                  ? '✓ ' + t('washi.copied')
                  : '⎘ ' + t('washi.copy_link')
              }
            />
          </div>
        ))}
      </div>
    </section>
  );
}

// ─── Shared bits ───────────────────────────────────────────────────────────

interface SectionHeaderProps {
  c: WashiColors;
  glyph: React.ReactNode;
  label: string;
  hint: string;
  onClear: () => void;
}

function SectionHeader({ c, glyph, label, hint, onClear }: SectionHeaderProps) {
  const { t } = useTranslation();
  return (
    <div
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'baseline',
        marginBottom: 12,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
        <span
          style={{
            fontSize: 13,
            color: c.sub,
            letterSpacing: '0.08em',
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
          }}
        >
          <span style={{ color: c.accent, display: 'inline-flex', alignItems: 'center' }}>
            {glyph}
          </span>
          {label.toUpperCase()}
        </span>
        <span style={{ fontSize: 11, color: c.sub, opacity: 0.7 }}>· {hint}</span>
      </div>
      <button
        onClick={onClear}
        style={{
          background: 'transparent',
          border: 'none',
          color: c.sub,
          cursor: 'pointer',
          fontSize: 12,
          transition: 'opacity .15s',
        }}
      >
        {t('washi.clear')}
      </button>
    </div>
  );
}

function CodeChip({ code, c }: { code: string; c: WashiColors }) {
  return (
    <div
      style={{
        fontFamily: '"JetBrains Mono", monospace',
        padding: '4px 8px',
        background: `${c.accent}15`,
        color: c.accent,
        borderRadius: 4,
        fontSize: 12,
        fontWeight: 600,
        letterSpacing: '0.1em',
      }}
    >
      {code}
    </div>
  );
}

interface SmallBtnProps {
  c: WashiColors;
  active: boolean;
  onClick: (e?: React.MouseEvent) => void;
  label: string;
}

function SmallBtn({ c, active, onClick, label }: SmallBtnProps) {
  const style: CSSProperties = {
    padding: '6px 10px',
    background: 'transparent',
    border: `1px solid ${c.soft}`,
    borderRadius: 4,
    color: active ? c.accent : c.sub,
    cursor: 'pointer',
    fontFamily: 'inherit',
    fontSize: 11,
    whiteSpace: 'nowrap',
    transition: 'transform .15s, color .15s, border-color .15s',
  };
  return (
    <button
      data-yui="recent-copy"
      onClick={onClick}
      style={style}
      onMouseDown={(e) => (e.currentTarget.style.transform = 'scale(0.96)')}
      onMouseUp={(e) => (e.currentTarget.style.transform = '')}
      onMouseLeave={(e) => (e.currentTarget.style.transform = '')}
    >
      {label}
    </button>
  );
}

export default Recent;
