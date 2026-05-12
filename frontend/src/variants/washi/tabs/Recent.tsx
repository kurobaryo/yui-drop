/**
 * Recent — local-storage-backed list of pickup codes minted on this device.
 *
 * Reads via `loadRecent()`. Clearing nukes the localStorage key. Copy button
 * writes the code to the clipboard. Renders nothing when the list is empty,
 * matching the existing app's no-empty-state policy.
 */
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { loadRecent, clearRecent, type RecentEntry } from '@/lib/recent';
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
    const id = window.setTimeout(refresh, 300);
    return () => {
      window.removeEventListener('storage', onStorage);
      window.clearTimeout(id);
    };
  }, []);

  if (items.length === 0) return null;

  const onClear = () => {
    clearRecent();
    setItems([]);
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
      typeof window !== 'undefined' && window.location
        ? window.location.origin
        : '';
    void navigator.clipboard?.writeText(`${origin}/s/${code}`);
    setCopiedLink(code);
    window.setTimeout(() => {
      setCopiedLink((cur) => (cur === code ? null : cur));
    }, 1500);
  };

  return (
    <div style={{ marginTop: 48 }}>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'baseline',
          marginBottom: 12,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
          <span style={{ fontSize: 13, color: c.sub, letterSpacing: '0.08em' }}>
            ◷  {t('washi.recent').toUpperCase()}
          </span>
          <span style={{ fontSize: 11, color: c.sub, opacity: 0.7 }}>
            · {t('washi.onlyDevice')}
          </span>
        </div>
        <button
          onClick={onClear}
          style={{
            background: 'transparent',
            border: 'none',
            color: c.sub,
            cursor: 'pointer',
            fontSize: 12,
          }}
        >
          {t('washi.clear')}
        </button>
      </div>
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
          const sizeBytes =
            item.kind === 'multi' ? item.totalSize ?? 0 : item.size ?? 0;
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
              }}
            >
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
                {item.code}
              </div>
              <div
                data-yui="recent-name"
                style={{ flex: 1, fontSize: 14 }}
              >
                {displayName}
              </div>
              <div
                data-yui="recent-meta"
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
                data-yui="recent-meta"
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
              <button
                data-yui="recent-copy"
                onClick={() => onCopy(item.code)}
                style={{
                  padding: '6px 10px',
                  background: 'transparent',
                  border: `1px solid ${c.soft}`,
                  borderRadius: 4,
                  color: copiedCode === item.code ? c.accent : c.sub,
                  cursor: 'pointer',
                  fontFamily: 'inherit',
                  fontSize: 11,
                  whiteSpace: 'nowrap',
                }}
              >
                {copiedCode === item.code
                  ? '✓ ' + t('washi.copied')
                  : '⎘ ' + t('washi.copy')}
              </button>
              <button
                data-yui="recent-copy"
                onClick={() => onCopyLink(item.code)}
                style={{
                  padding: '6px 10px',
                  background: 'transparent',
                  border: `1px solid ${c.soft}`,
                  borderRadius: 4,
                  color: copiedLink === item.code ? c.accent : c.sub,
                  cursor: 'pointer',
                  fontFamily: 'inherit',
                  fontSize: 11,
                  whiteSpace: 'nowrap',
                }}
              >
                {copiedLink === item.code
                  ? '✓ ' + t('washi.copied')
                  : '⎘ ' + t('washi.copy_link')}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default Recent;
