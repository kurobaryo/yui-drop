/**
 * SendComposer — the porcelain home's single "寄出" panel.
 *
 * Merges the SendText and SendFile panels into one card: an auto-growing
 * textarea, file chips (add via button, drag-and-drop or paste), a compact
 * expiry menu and one submit button. It reuses the same API calls, Turnstile
 * gating, recent-list bookkeeping and success screen as those panels; only
 * the routing between them is new:
 *
 *   text only           → POST /share/text              (as SendTextPanel)
 *   one file, no text   → uploadFile                     (as SendFilePanel)
 *   several files       → uploadFiles                    (as SendFilePanel)
 *   files + text        → uploadFiles with the text as the share's note,
 *                         even for a single file
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';

import { errorMessage } from '@/lib/errorMessage';
import { humanBytes } from '@/lib/format';
import { shareText } from '@/lib/api/share';
import { pushRecent } from '@/lib/recent';
import { uploadFile, uploadFiles, type StorageBackend } from '@/lib/uploader';
import { usePublicConfig } from '@/lib/hooks/usePublicConfig';
import { toast } from '@/components/ui/Toast';
import { TurnstileWidget, type TurnstileWidgetHandle } from '@/components/TurnstileWidget';
import { CodeReadyV2 } from './CodeReadyV2';
import { expiryToApi, type ExpiryValue } from './ExpiryControl';
import { ExpiryMenu } from './ExpiryMenu';
import { HapticTap } from './HapticTap';
import { Icon } from './IconSprite';
import { haptic } from '../haptics';

export interface SendComposerProps {
  /** Whether the composer's tab is showing. Page-level drop / paste targets
   *  are only armed while it is, so the pickup tab keeps default behaviour. */
  active: boolean;
}

/** Identity used to skip adding the same file twice. */
function fileKey(f: File): string {
  return `${f.name}:${f.size}:${f.lastModified}`;
}

function hasFiles(e: DragEvent): boolean {
  return Array.from(e.dataTransfer?.types ?? []).includes('Files');
}

export function SendComposer({ active }: SendComposerProps) {
  const { t } = useTranslation();
  const config = usePublicConfig();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const turnstileRef = useRef<TurnstileWidgetHandle | null>(null);
  const abortRef = useRef<(() => void) | null>(null);
  const dragDepth = useRef(0);
  const [text, setText] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [expiry, setExpiry] = useState<ExpiryValue>({ mode: 'date', days: 7, count: 10 });
  const [progress, setProgress] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [code, setCode] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const gated = Boolean(config.turnstileProtectUpload && config.turnstileSiteKey);
  const hasText = text.trim().length > 0;
  const empty = !hasText && files.length === 0;

  useEffect(() => () => abortRef.current?.(), []);

  const addFiles = useCallback((list: FileList | File[] | null | undefined) => {
    const incoming = Array.from(list ?? []);
    if (!incoming.length) return;
    setFiles((prev) => {
      const seen = new Set(prev.map(fileKey));
      const next = [...prev];
      for (const f of incoming) {
        if (seen.has(fileKey(f))) continue;
        seen.add(fileKey(f));
        next.push(f);
      }
      return next;
    });
    setError(null);
  }, []);

  // Auto-grow: reset to `auto` so the box can also shrink, then fit content.
  // CSS max-height takes over (and the textarea scrolls) for long text.
  useLayoutEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [text, code]);

  // Focus the textarea when the tab opens — pointer devices only, so a phone
  // keyboard doesn't slide up over the submit button.
  useEffect(() => {
    if (!active || code) return;
    if (window.matchMedia?.('(pointer: fine)').matches) textareaRef.current?.focus();
  }, [active, code]);

  // While this tab is showing, a file dragged anywhere onto the page lights up
  // the composer and is accepted on drop (instead of the browser navigating
  // to it). Window listeners, because enter/leave fire per child element.
  // They stay armed during an upload — a stray drop must not navigate away
  // mid-transfer — but ignore the files until it finishes.
  const busyRef = useRef(false);
  useEffect(() => {
    busyRef.current = busy;
  }, [busy]);
  useEffect(() => {
    if (!active || code) return;
    const onEnter = (e: DragEvent) => {
      if (!hasFiles(e) || busyRef.current) return;
      dragDepth.current += 1;
      setDragging(true);
    };
    const onLeave = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      dragDepth.current = Math.max(0, dragDepth.current - 1);
      if (dragDepth.current === 0) setDragging(false);
    };
    const onOver = (e: DragEvent) => {
      if (hasFiles(e)) e.preventDefault();
    };
    const onDrop = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      dragDepth.current = 0;
      setDragging(false);
      if (!busyRef.current) addFiles(e.dataTransfer?.files);
    };
    window.addEventListener('dragenter', onEnter);
    window.addEventListener('dragleave', onLeave);
    window.addEventListener('dragover', onOver);
    window.addEventListener('drop', onDrop);
    return () => {
      window.removeEventListener('dragenter', onEnter);
      window.removeEventListener('dragleave', onLeave);
      window.removeEventListener('dragover', onOver);
      window.removeEventListener('drop', onDrop);
      dragDepth.current = 0;
      setDragging(false);
    };
  }, [active, code, addFiles]);

  // Pasted files (screenshots, files copied in a file manager) become chips.
  // Plain-text pastes fall through to the textarea as usual. Ignored when the
  // paste targets some other field on the page.
  useEffect(() => {
    if (!active || code || busy) return;
    const onPaste = (e: ClipboardEvent) => {
      const pasted = Array.from(e.clipboardData?.files ?? []);
      if (!pasted.length) return;
      const el = e.target instanceof HTMLElement ? e.target : null;
      const editable = !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable);
      if (editable && !el?.closest('[data-p="composer"]')) return;
      e.preventDefault();
      addFiles(pasted);
    };
    document.addEventListener('paste', onPaste);
    return () => document.removeEventListener('paste', onPaste);
  }, [active, code, busy, addFiles]);

  const submit = async () => {
    if (empty || busy) return;
    setBusy(true);
    setProgress(files.length ? 0 : null);
    setError(null);
    const fallback = files.length ? t('v2.send.failedUpload') : t('v2.send.failedText');
    try {
      let token: string | undefined;
      if (gated) {
        token = await turnstileRef.current?.executeAndWaitForToken();
        if (!token) throw new Error(t('v2.send.turnstileRequired'));
      }
      const exp = expiryToApi(expiry);
      const storageBackend = (config.storage_backend ?? 'local') as StorageBackend;
      const createdAt = new Date().toISOString();

      if (!files.length) {
        const res = await shareText({ text, ...exp, ...(token ? { turnstile_token: token } : {}) });
        pushRecent({ code: res.code, kind: 'text', name: t('v2.recent.textShare'), size: new Blob([text]).size, type: 'text/plain', created_at: createdAt, expires_at: res.expired_at });
        setCode(res.code);
      } else if (!hasText && files.length === 1) {
        const f = files[0];
        const h = uploadFile({
          file: f, expireValue: exp.expire_value, expireStyle: exp.expire_style,
          storageBackend, turnstileToken: token, onProgress: (v) => setProgress(v * 100),
        });
        abortRef.current = h.abort;
        const res = await h.promise;
        pushRecent({ code: res.code, kind: 'file', name: res.name, size: res.size, type: f.type || null, created_at: createdAt, expires_at: null });
        setCode(res.code);
      } else {
        const h = uploadFiles({
          files, text: hasText ? text : undefined,
          expireValue: exp.expire_value, expireStyle: exp.expire_style,
          storageBackend, turnstileToken: token, onOverallProgress: (v) => setProgress(v * 100),
        });
        abortRef.current = h.abort;
        const res = await h.promise;
        pushRecent({ code: res.code, kind: 'multi', name: files[0]?.name, size: null, type: null, fileCount: res.fileCount, totalSize: res.totalSize, created_at: createdAt, expires_at: null });
        setCode(res.code);
      }
      haptic('success');
      turnstileRef.current?.reset();
    } catch (e) {
      const msg = errorMessage(e, t, fallback);
      haptic('error');
      setError(msg);
      toast.error(msg);
      turnstileRef.current?.reset();
    } finally {
      abortRef.current = null;
      setBusy(false);
    }
  };

  if (code) {
    return (
      <div data-p="composer" style={card}>
        <CodeReadyV2
          code={code}
          onReset={() => {
            setCode(null);
            setText('');
            setFiles([]);
            setProgress(null);
          }}
        />
      </div>
    );
  }

  const disabled = empty || busy;
  const pct = Math.round(progress ?? 0);

  return (
    <div
      data-p="composer"
      style={{
        ...card,
        ...(dragging ? { background: 'var(--acs)', boxShadow: 'inset 0 0 0 2px var(--ac)' } : null),
      }}
    >
      <textarea
        ref={textareaRef}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            void submit();
          }
        }}
        readOnly={busy}
        rows={4}
        placeholder={dragging ? t('v2.porcelain.dropHere') : t('v2.porcelain.placeholder')}
        aria-label={t('v2.porcelain.placeholder')}
        style={textarea}
      />

      {files.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 6 }}>
          {files.map((f, i) => (
            <span key={fileKey(f)} style={chip}>
              <span title={f.name} style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {f.name}
              </span>
              <span style={{ flexShrink: 0, color: 'var(--tx3)', fontVariantNumeric: 'tabular-nums' }}>
                · {humanBytes(f.size, 1)}
              </span>
              {!busy && (
                <button
                  type="button"
                  data-p="chip-x"
                  aria-label={t('v2.porcelain.removeFile', { name: f.name })}
                  onClick={() => setFiles((xs) => xs.filter((_, n) => n !== i))}
                  style={chipRemove}
                >
                  <Icon name="i-x" size={12} />
                </button>
              )}
            </span>
          ))}
        </div>
      )}

      {busy && progress !== null && (
        <div style={{ marginTop: 14 }} role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: 'var(--tx3)', marginBottom: 6 }}>
            <span>{t('v2.send.uploading')}</span>
            <span style={{ fontVariantNumeric: 'tabular-nums' }}>{pct}%</span>
          </div>
          <div style={{ height: 4, borderRadius: 999, background: 'var(--p1)', overflow: 'hidden' }}>
            <div style={{ width: `${pct}%`, height: '100%', background: 'var(--ac)', transition: 'width .2s' }} />
          </div>
        </div>
      )}
      {error && <div style={{ marginTop: 10, fontSize: 12.5, color: 'var(--bad)' }}>{error}</div>}

      <div style={bar}>
        <button
          type="button"
          data-yd="link"
          onClick={() => inputRef.current?.click()}
          disabled={busy}
          aria-label={t('v2.porcelain.addFiles')}
          style={{ ...ghost, opacity: busy ? 0.5 : 1, cursor: busy ? 'default' : 'pointer' }}
        >
          <Icon name="i-plus" size={16} />
          <span data-p="attach-label">{t('v2.porcelain.addFiles')}</span>
        </button>
        <input
          ref={inputRef}
          type="file"
          multiple
          hidden
          onChange={(e) => {
            addFiles(e.target.files);
            // Allow picking the same file again after removing its chip.
            e.target.value = '';
          }}
        />
        <ExpiryMenu value={expiry} onChange={setExpiry} disabled={busy} />
        {gated && config.turnstileSiteKey && (
          <div style={{ position: 'absolute', width: 0, height: 0, overflow: 'hidden' }}>
            <TurnstileWidget ref={turnstileRef} mode="invisible-on-submit" siteKey={config.turnstileSiteKey} onVerify={() => {}} onExpire={() => {}} onError={() => {}} />
          </div>
        )}
        <HapticTap onTap={() => void submit()} radius={10} disabled={disabled} label={t('v2.send.submit')} style={{ flexShrink: 0 }}>
          <span data-yd="btn" style={{ ...go, opacity: disabled ? 0.35 : 1, cursor: disabled ? 'not-allowed' : 'pointer' }}>
            {busy ? (files.length ? t('v2.send.uploading') : t('v2.send.submitting')) : t('v2.send.submit')}
          </span>
        </HapticTap>
      </div>
    </div>
  );
}

const card: CSSProperties = {
  background: 'var(--pn)',
  borderRadius: 'var(--rc)',
  boxShadow: 'var(--sh), inset 0 0 0 1px var(--ln)',
  padding: 18,
  transition: 'background .15s, box-shadow .15s',
};

const textarea: CSSProperties = {
  display: 'block',
  width: '100%',
  minHeight: 120,
  maxHeight: '50vh',
  padding: 0,
  border: 0,
  outline: 'none',
  resize: 'none',
  overflowY: 'auto',
  background: 'transparent',
  color: 'var(--tx)',
  fontFamily: 'inherit',
  fontSize: 15,
  lineHeight: 1.6,
};

const chip: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 4,
  maxWidth: '100%',
  fontSize: 12.5,
  lineHeight: 1.4,
  padding: '5px 6px 5px 10px',
  borderRadius: 8,
  background: 'var(--p1)',
  color: 'var(--tx2)',
};

const chipRemove: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  flexShrink: 0,
  width: 22,
  height: 22,
  marginLeft: 2,
  padding: 0,
  border: 0,
  borderRadius: 6,
  background: 'transparent',
  color: 'var(--tx3)',
  cursor: 'pointer',
};

const bar: CSSProperties = {
  // Positioned so the expiry popover can anchor to the bar's right edge.
  position: 'relative',
  display: 'flex',
  alignItems: 'center',
  flexWrap: 'wrap',
  gap: 10,
  marginTop: 12,
  paddingTop: 12,
  borderTop: '1px solid var(--ln)',
};

const ghost: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  minHeight: 36,
  padding: '6px 8px 6px 2px',
  border: 0,
  background: 'transparent',
  color: 'var(--tx2)',
  fontFamily: 'inherit',
  fontSize: 13.5,
  whiteSpace: 'nowrap',
};

const go: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  height: 40,
  padding: '0 18px',
  border: 0,
  borderRadius: 10,
  background: 'var(--tx)',
  color: 'var(--pn)',
  fontFamily: 'inherit',
  fontSize: 14,
  fontWeight: 600,
  whiteSpace: 'nowrap',
};

export default SendComposer;
