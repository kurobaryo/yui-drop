/**
 * Pickup tab — 6-cell code input that, on completion, resolves the code via
 * `shareSelect` and opens a `<PickupModal>` with whatever the server hands
 * back. Deep links (`/s/:code`, `/v/:code`) get routed here with a
 * `prefillCode` from `WashiApp`, which auto-fires the resolve.
 */
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { shareSelect, type ShareSelectResponse } from '@/lib/api/share';
import { ApiError } from '@/lib/api';
import { pushRecent } from '@/lib/recent';
import type { WashiColors } from '../palettes';
import { useCodeInput } from '../utils';
import { PickupModal } from './PickupModal';

export interface PickupProps {
  c: WashiColors;
  prefillCode?: string | null;
  /** When true, auto-fire the resolve once the cells are filled by prefill.
   * Set false for ?code= query-string prefills (IDOR-style guard: the user
   * must explicitly click "Pick up" to confirm intent). */
  autoSubmitOnPrefill?: boolean;
  /** Called after the modal opens so the parent can clear the deep-link query. */
  onPrefillConsumed?: () => void;
}

type PickupState = 'idle' | 'loading' | 'error' | 'success';

export function Pickup({
  c,
  prefillCode,
  autoSubmitOnPrefill = true,
  onPrefillConsumed,
}: PickupProps) {
  const { t } = useTranslation();
  const [state, setState] = useState<PickupState>('idle');
  const [item, setItem] = useState<ShareSelectResponse | null>(null);
  const [errMsg, setErrMsg] = useState<string | null>(null);
  const lastSubmitted = useRef<string>('');

  const submit = async (code: string) => {
    if (code.length !== 6) return;
    if (lastSubmitted.current === code && state === 'loading') return;
    lastSubmitted.current = code;
    setState('loading');
    setErrMsg(null);
    try {
      const res = await shareSelect(code);
      pushRecent({
        code: res.code,
        kind: res.kind,
        name: res.name,
        size: res.size,
        type: res.content_type,
        fileCount: res.file_count,
        totalSize: res.total_size,
        created_at: new Date().toISOString(),
        expires_at: res.expired_at,
      });
      setItem(res);
      setState('success');
    } catch (e) {
      if (e instanceof ApiError) {
        if (e.httpStatus === 404 || e.code === 4040) setErrMsg(t('washi.notFound'));
        else setErrMsg(e.message || t('washi.notFound'));
      } else {
        setErrMsg(t('washi.notFound'));
      }
      setState('error');
    }
  };

  const cin = useCodeInput(6, submit);

  // Deep-link prefill: when /s/:code or /v/:code lands here, fill cells and
  // (depending on the source) auto-submit. For ?code= query-string prefills
  // we skip the auto-submit so the user must explicitly tap "Pick up".
  useEffect(() => {
    if (!prefillCode) return;
    const clean = prefillCode.replace(/[^0-9]/g, '').slice(0, 6);
    if (clean.length !== 6) return;
    cin.setValue(clean);
    if (autoSubmitOnPrefill) {
      void submit(clean);
    }
    onPrefillConsumed?.();
    // submit is stable enough — eslint deps disabled here on purpose.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefillCode]);

  return (
    <div>
      <div
        style={{
          fontSize: 13,
          color: c.sub,
          marginBottom: 14,
          letterSpacing: '0.08em',
        }}
      >
        {t('washi.enterCode').toUpperCase()}
      </div>
      <div
        data-yui="code-row"
        style={{
          display: 'flex',
          gap: 10,
          alignItems: 'stretch',
          flexWrap: 'wrap',
        }}
        onPaste={cin.handlePaste}
      >
        <div
          data-yui="code-cells"
          style={{ display: 'flex', gap: 10, flex: '0 0 auto', minWidth: 0 }}
        >
          {cin.digits.map((d, i) => (
            <input
              key={i}
              ref={(el) => {
                cin.refs.current[i] = el;
              }}
              value={d}
              onChange={(e) => cin.setDigit(i, e.target.value)}
              onKeyDown={(e) => cin.handleKey(i, e)}
              disabled={state === 'loading'}
              inputMode="numeric"
              data-yui="code-cell"
              style={{
                width: 64,
                height: 64,
                fontSize: 32,
                textAlign: 'center',
                fontFamily: '"Noto Serif JP", "JetBrains Mono", monospace',
                background: 'transparent',
                border: `1px solid ${state === 'error' ? '#c44a3e' : c.soft}`,
                borderBottom: `2px solid ${d ? c.accent : c.soft}`,
                borderRadius: 6,
                color: c.ink,
                outline: 'none',
                padding: 0,
                boxSizing: 'border-box',
                transition: 'border-color .15s, background .15s',
              }}
              onFocus={(e) => {
                e.currentTarget.style.background = `${c.accent}10`;
              }}
              onBlur={(e) => {
                e.currentTarget.style.background = 'transparent';
              }}
            />
          ))}
        </div>
        <button
          onClick={() => void submit(cin.value)}
          disabled={!cin.complete || state === 'loading'}
          data-yui="pickup-btn"
          style={{
            padding: '0 28px',
            height: 64,
            minWidth: 110,
            background: cin.complete && state !== 'loading' ? c.accent : c.soft,
            color: cin.complete && state !== 'loading' ? c.paper : c.sub,
            border: 'none',
            borderRadius: 10,
            cursor: cin.complete && state !== 'loading' ? 'pointer' : 'not-allowed',
            fontFamily: 'inherit',
            fontSize: 15,
            fontWeight: 600,
            boxShadow:
              cin.complete && state !== 'loading' ? `0 8px 20px ${c.accent}33` : 'none',
            transition: 'all .15s',
            whiteSpace: 'nowrap',
          }}
        >
          {state === 'loading' ? '…' : `${t('washi.pickupBtn')}  →`}
        </button>
      </div>
      <div
        style={{
          marginTop: 12,
          fontSize: 12,
          color: state === 'error' ? '#c44a3e' : c.sub,
        }}
      >
        {state === 'error'
          ? errMsg ?? t('washi.notFound')
          : state === 'loading'
            ? t('washi.pickingUp')
            : t('washi.pasteHint')}
      </div>

      {state === 'success' && item && (
        <PickupModal
          c={c}
          item={item}
          onClose={() => {
            setState('idle');
            setItem(null);
            cin.reset();
            lastSubmitted.current = '';
          }}
        />
      )}
    </div>
  );
}

export default Pickup;
