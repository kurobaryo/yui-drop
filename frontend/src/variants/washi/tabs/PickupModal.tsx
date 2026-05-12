/**
 * PickupModal — full-screen modal that displays whatever the server returned
 * for a successful pickup.
 *
 * Rendering rules (kept close to washi.jsx but driven by real data):
 *   - `kind === 'text'`           → render `res.text` inside a <pre>
 *   - `kind === 'file'` + image MIME → render <img src={res.url}>
 *   - `kind === 'file'` + pdf       → render <iframe src={res.url}>
 *   - `kind === 'file'` + text/*    → fetch `res.url` body, render in <pre>
 *   - `kind === 'multi'`            → render the file list
 *   - otherwise                     → "no preview, please download" card
 */
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ShareSelectResponse } from '@/lib/api/share';
import type { WashiColors } from '../palettes';
import { fmtSize } from '../utils';

export interface PickupModalProps {
  c: WashiColors;
  item: ShareSelectResponse;
  onClose: () => void;
}

type Classified = 'image' | 'pdf' | 'video' | 'audio' | 'text' | 'other';

// MIME types we treat as text even though their primary type isn't ``text/``.
// Keeps the in-modal <pre> preview working for the common code/config formats
// that servers usually label as ``application/*``.
const TEXT_LIKE_MIMES = new Set<string>([
  'application/json',
  'application/yaml',
  'application/x-yaml',
  'application/xml',
  'text/xml',
  'application/javascript',
  'text/javascript',
  'application/typescript',
  'text/csv',
]);

function classify(ct: string | null | undefined): Classified {
  if (!ct) return 'other';
  const lc = ct.split(';')[0]!.trim().toLowerCase();
  if (lc.startsWith('image/')) return 'image';
  if (lc === 'application/pdf') return 'pdf';
  if (lc.startsWith('video/')) return 'video';
  if (lc.startsWith('audio/')) return 'audio';
  if (lc.startsWith('text/')) return 'text';
  if (TEXT_LIKE_MIMES.has(lc)) return 'text';
  return 'other';
}

function extOf(name: string | null | undefined): string {
  if (!name) return '';
  return (name.split('.').pop() ?? '').toLowerCase();
}

function expiresLabel(expiredAt: string | null | undefined): string {
  if (!expiredAt) return '∞';
  const ms = new Date(expiredAt).getTime() - Date.now();
  if (Number.isNaN(ms)) return '—';
  if (ms <= 0) return '0';
  const sec = Math.floor(ms / 1000);
  const days = Math.floor(sec / 86400);
  if (days >= 1) return `${days}d`;
  const hours = Math.floor(sec / 3600);
  if (hours >= 1) return `${hours}h`;
  return `${Math.floor(sec / 60)}m`;
}

export function PickupModal({ c, item, onClose }: PickupModalProps) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  const [linkCopied, setLinkCopied] = useState(false);
  const [imageLoaded, setImageLoaded] = useState(false);
  const [pdfLoaded, setPdfLoaded] = useState(false);
  const [textLoading, setTextLoading] = useState(false);
  const [textBody, setTextBody] = useState<string | null>(
    item.kind === 'text' ? item.text ?? '' : null,
  );

  // Lock background scroll + bind escape.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [onClose]);

  // Lazy-fetch body of text/* files served via res.url.
  useEffect(() => {
    if (item.kind !== 'file') return;
    if (!item.url) return;
    if (classify(item.content_type) !== 'text') return;
    let cancelled = false;
    setTextLoading(true);
    fetch(item.url)
      .then((r) => r.text())
      .then((body) => {
        if (!cancelled) setTextBody(body);
      })
      .catch(() => {
        if (!cancelled) setTextBody(null);
      })
      .finally(() => {
        if (!cancelled) setTextLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [item]);

  const name = item.name ?? (item.kind === 'text' ? 'text.txt' : item.kind === 'multi' ? 'multi' : '—');
  const ext = extOf(item.name);
  const cls = item.kind === 'file' ? classify(item.content_type) : item.kind === 'text' ? 'text' : 'other';
  const isImage = cls === 'image';
  const isText = item.kind === 'text' || cls === 'text';
  const isPdf = cls === 'pdf';
  const isVideo = cls === 'video';
  const isAudio = cls === 'audio';
  const isMulti = item.kind === 'multi';

  const copyText = async () => {
    if (textBody == null) return;
    try {
      await navigator.clipboard?.writeText(textBody);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      /* ignore */
    }
  };

  const copyShareLink = async () => {
    try {
      const origin =
        typeof window !== 'undefined' && window.location
          ? window.location.origin
          : '';
      await navigator.clipboard?.writeText(`${origin}/s/${item.code}`);
      setLinkCopied(true);
      window.setTimeout(() => setLinkCopied(false), 1500);
    } catch {
      /* ignore */
    }
  };

  const skeletonStyle = {
    background: c.soft,
    borderRadius: 8,
    animation: 'pulse 1.4s ease-in-out infinite',
  } as const;

  const totalSize =
    item.kind === 'multi'
      ? item.total_size ?? 0
      : item.size ?? (item.kind === 'text' ? new Blob([item.text ?? '']).size : 0);

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 100,
        background: 'rgba(0,0,0,0.55)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 32,
        backdropFilter: 'blur(6px)',
        WebkitBackdropFilter: 'blur(6px)',
      }}
      onClick={onClose}
      data-yui="modal-shell"
    >
      <style>{`@keyframes yui-pop{from{opacity:0;transform:translateY(8px) scale(.97)}to{opacity:1;transform:none}} @keyframes pulse{0%,100%{opacity:.5}50%{opacity:.9}}`}</style>
      <div
        onClick={(e) => e.stopPropagation()}
        data-yui="modal-card"
        style={{
          background: c.paper,
          color: c.ink,
          borderRadius: 16,
          maxWidth: 720,
          width: '100%',
          maxHeight: '85vh',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          border: `1px solid ${c.soft}`,
          boxShadow: '0 30px 80px rgba(0,0,0,0.5)',
          animation: 'yui-pop .22s cubic-bezier(.2,.7,.3,1)',
        }}
      >
        {/* Header */}
        <div
          style={{
            padding: '16px 20px',
            borderBottom: `1px solid ${c.soft}`,
            display: 'flex',
            alignItems: 'center',
            gap: 14,
            background: `${c.accent}0a`,
          }}
        >
          <div
            style={{
              width: 40,
              height: 40,
              borderRadius: 8,
              background: `${c.accent}22`,
              color: c.accent,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 10,
              fontWeight: 700,
              letterSpacing: '0.05em',
            }}
          >
            {isMulti ? 'MULTI' : item.kind === 'text' ? 'TEXT' : (ext.slice(0, 4).toUpperCase() || 'FILE')}
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div
              style={{
                fontFamily: '"JetBrains Mono", monospace',
                fontSize: 11,
                color: c.sub,
                letterSpacing: '0.1em',
                display: 'flex',
                gap: 10,
              }}
            >
              <span>#{item.code}</span>
              <span style={{ color: c.accent }}>● {t('washi.pickupSuccess')}</span>
            </div>
            <div
              style={{
                fontFamily: '"Noto Serif JP", serif',
                fontSize: 18,
                marginTop: 2,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {isMulti
                ? `${item.file_count ?? item.files?.length ?? 0} ${t('washi.files')}`
                : name}
            </div>
          </div>
          <button
            onClick={onClose}
            style={{
              background: 'transparent',
              border: 'none',
              cursor: 'pointer',
              color: c.sub,
              fontSize: 22,
              padding: 4,
              lineHeight: 1,
            }}
          >
            ×
          </button>
        </div>

        {/* Body */}
        <div style={{ flex: 1, overflow: 'auto', background: `${c.ink}03`, minHeight: 220 }}>
          {isImage && item.url ? (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                padding: 32,
                background: `repeating-conic-gradient(${c.ink}08 0% 25%, transparent 0% 50%) 50%/16px 16px`,
              }}
            >
              <div style={{ position: 'relative', width: '100%', maxWidth: 560 }}>
                {!imageLoaded && (
                  <div style={{ ...skeletonStyle, width: '100%', height: 240 }} />
                )}
                <img
                  src={item.url}
                  alt={name}
                  onLoad={() => setImageLoaded(true)}
                  style={{
                    display: imageLoaded ? 'block' : 'none',
                    margin: '0 auto',
                    maxWidth: '100%',
                    maxHeight: 380,
                    borderRadius: 8,
                    boxShadow: '0 12px 32px rgba(0,0,0,0.25)',
                  }}
                />
              </div>
            </div>
          ) : isText ? (
            textLoading && textBody == null ? (
              <div
                style={{
                  padding: '20px 24px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 8,
                }}
              >
                {[95, 80, 90, 70, 85, 60, 75].map((w, i) => (
                  <div
                    key={i}
                    style={{ ...skeletonStyle, height: 14, width: `${w}%` }}
                  />
                ))}
              </div>
            ) : (
              <pre
                style={{
                  margin: 0,
                  padding: '20px 24px',
                  fontFamily: '"JetBrains Mono", monospace',
                  fontSize: 12.5,
                  lineHeight: 1.7,
                  color: c.ink,
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word',
                  maxHeight: 380,
                  overflow: 'auto',
                }}
              >
                {textBody ?? ''}
              </pre>
            )
          ) : isPdf && item.url ? (
            <div style={{ position: 'relative', width: '100%' }}>
              {!pdfLoaded && (
                <div
                  style={{
                    ...skeletonStyle,
                    width: '100%',
                    height: 'min(80vh, 800px)',
                    borderRadius: 12,
                  }}
                />
              )}
              <iframe
                src={item.url}
                title={name || t('washi.preview_pdf')}
                onLoad={() => setPdfLoaded(true)}
                style={{
                  display: pdfLoaded ? 'block' : 'none',
                  width: '100%',
                  height: 'min(80vh, 800px)',
                  border: `1px solid ${c.soft}`,
                  borderRadius: 12,
                  background: c.paper,
                }}
              />
            </div>
          ) : isVideo && item.url ? (
            <video src={item.url} controls style={{ width: '100%', maxHeight: 480, background: 'black' }} />
          ) : isAudio && item.url ? (
            <div style={{ padding: 32 }}>
              <audio src={item.url} controls style={{ width: '100%' }} />
            </div>
          ) : isMulti ? (
            <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 6 }}>
              {(item.files ?? []).map((f) => (
                <div
                  key={f.file_id}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 12,
                    padding: '10px 14px',
                    border: `1px solid ${c.soft}`,
                    borderRadius: 8,
                  }}
                >
                  <div
                    style={{
                      width: 28,
                      height: 28,
                      borderRadius: 4,
                      background: `${c.accent}20`,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      color: c.accent,
                      fontSize: 12,
                      fontWeight: 600,
                    }}
                  >
                    {(f.name.split('.').pop() ?? '').slice(0, 3).toUpperCase()}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div
                      style={{
                        fontSize: 14,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {f.name}
                    </div>
                    <div style={{ fontSize: 11, color: c.sub }}>{fmtSize(f.size)}</div>
                  </div>
                  {f.url && (
                    <a
                      href={f.url}
                      download={f.name}
                      style={{
                        padding: '6px 10px',
                        background: 'transparent',
                        border: `1px solid ${c.soft}`,
                        borderRadius: 4,
                        color: c.sub,
                        fontFamily: 'inherit',
                        fontSize: 11,
                        textDecoration: 'none',
                      }}
                    >
                      ↓
                    </a>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <div
              style={{
                padding: 48,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: 12,
                color: c.sub,
              }}
            >
              <div
                style={{
                  width: 72,
                  height: 72,
                  borderRadius: 12,
                  background: `${c.accent}18`,
                  color: c.accent,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 26,
                  fontFamily: '"Noto Serif JP", serif',
                }}
              >
                包
              </div>
              <div style={{ fontSize: 14 }}>{(ext || 'BIN').toUpperCase()} · —</div>
              <div style={{ fontSize: 12 }}>{t('washi.codeShare')}</div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div
          style={{
            padding: '14px 20px',
            borderTop: `1px solid ${c.soft}`,
            display: 'flex',
            alignItems: 'center',
            gap: 10,
          }}
        >
          <div style={{ flex: 1, fontSize: 12, color: c.sub }}>
            {fmtSize(totalSize)} · {expiresLabel(item.expired_at)} {t('washi.remaining')}
          </div>
          {isText ? (
            <>
              <button
                onClick={copyText}
                style={{
                  padding: '10px 18px',
                  background: c.accent,
                  color: c.paper,
                  border: 'none',
                  borderRadius: 999,
                  cursor: 'pointer',
                  fontFamily: 'inherit',
                  fontWeight: 600,
                  fontSize: 14,
                  boxShadow: `0 6px 16px ${c.accent}40`,
                }}
              >
                {copied ? '✓ ' + t('washi.copied') : '⎘  ' + t('washi.copy')}
              </button>
              {textBody != null && (
                <a
                  href={`data:text/plain;charset=utf-8,${encodeURIComponent(textBody)}`}
                  download={`${item.code}.txt`}
                  style={{
                    padding: '10px 16px',
                    background: 'transparent',
                    color: c.ink,
                    border: `1px solid ${c.soft}`,
                    borderRadius: 999,
                    cursor: 'pointer',
                    fontFamily: 'inherit',
                    fontSize: 14,
                    textDecoration: 'none',
                  }}
                >
                  ↓  .txt
                </a>
              )}
            </>
          ) : item.kind === 'file' && item.url ? (
            <>
              <button
                type="button"
                onClick={copyShareLink}
                style={{
                  padding: '10px 16px',
                  background: 'transparent',
                  color: c.ink,
                  border: `1px solid ${c.soft}`,
                  borderRadius: 999,
                  cursor: 'pointer',
                  fontFamily: 'inherit',
                  fontSize: 13,
                }}
              >
                {linkCopied ? '✓ ' + t('washi.copied') : '⎘  ' + t('washi.copy_link')}
              </button>
              <a
                href={item.url}
                download={item.name ?? undefined}
                style={{
                  padding: '10px 22px',
                  background: c.accent,
                  color: c.paper,
                  border: 'none',
                  borderRadius: 999,
                  cursor: 'pointer',
                  fontFamily: 'inherit',
                  fontWeight: 600,
                  fontSize: 14,
                  boxShadow: `0 6px 16px ${c.accent}40`,
                  textDecoration: 'none',
                }}
              >
                ↓  {t('washi.tabPickup')}
              </a>
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}

export default PickupModal;
