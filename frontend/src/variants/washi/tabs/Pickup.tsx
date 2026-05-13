/**
 * Pickup tab — 6-cell code input that, on completion, resolves the code via
 * `shareSelect` and opens a `<PickupModal>` with whatever the server hands
 * back. Deep links (`/s/:code`, `/v/:code`) get routed here with a
 * `prefillCode` from `WashiApp`, which auto-fires the resolve.
 *
 * When the admin enables Turnstile + `protect_pickup`, the widget renders
 * above the pickup button. Auto-submit on prefill is suppressed when a
 * verification is still required — the user must explicitly tap "Pick up"
 * after solving the challenge.
 */
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { shareSelect, type ShareSelectResponse } from '@/lib/api/share';
import { ApiError } from '@/lib/api';
import { pushRecent } from '@/lib/recent';
import { usePublicConfig } from '@/lib/hooks/usePublicConfig';
import { toast } from '@/components/ui/Toast';
import {
  TurnstileWidget,
  type TurnstileWidgetHandle,
} from '@/components/TurnstileWidget';
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
  const config = usePublicConfig();
  const [state, setState] = useState<PickupState>('idle');
  const [item, setItem] = useState<ShareSelectResponse | null>(null);
  const [errMsg, setErrMsg] = useState<string | null>(null);
  const turnstileRef = useRef<TurnstileWidgetHandle | null>(null);
  const lastSubmitted = useRef<string>('');

  const turnstileGated = Boolean(
          config.turnstileProtectPickup &&
      config.turnstileSiteKey,
  );

  const resetTurnstile = () => {
    turnstileRef.current?.reset();
  };

  const submit = async (code: string) => {
    if (code.length !== 6) return;
    if (lastSubmitted.current === code && state === 'loading') return;
    lastSubmitted.current = code;
    setState('loading');
    setErrMsg(null);

    // Resolve a Turnstile token at submit time (invisible-on-submit mode).
    let resolvedToken: string | undefined;
    if (turnstileGated) {
      try {
        resolvedToken = await turnstileRef.current?.executeAndWaitForToken();
      } catch {
        toast.error(t('turnstile.required'));
        setErrMsg(t('turnstile.required'));
        setState('error');
        return;
      }
      if (!resolvedToken) {
        toast.error(t('turnstile.required'));
        setErrMsg(t('turnstile.required'));
        setState('error');
        return;
      }
    }

    try {
      const res = await shareSelect(code, resolvedToken ?? null);
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
      // Token spent. Re-arm in case the user looks up another code.
      resetTurnstile();
    } catch (e) {
      if (e instanceof ApiError) {
        if (e.code === 4003) {
          toast.error(t('turnstile.failed'));
          resetTurnstile();
          setErrMsg(t('turnstile.failed'));
        } else if (e.httpStatus === 404 || e.code === 4040) {
          setErrMsg(t('washi.notFound'));
        } else {
          setErrMsg(e.message || t('washi.notFound'));
        }
      } else {
        setErrMsg(t('washi.notFound'));
      }
      setState('error');
    }
  };

  const cin = useCodeInput(6, (val) => {
    // Auto-submit when 6th digit is typed. With invisible-on-submit Turnstile
    // the challenge will fire inside submit() and award a token (silently on
    // trusted IPs, with a popup on suspicious ones).
    void submit(val);
  });

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

  const canSubmit = cin.complete && state !== 'loading';

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
          disabled={!canSubmit}
          data-yui="pickup-btn"
          style={{
            padding: '0 28px',
            height: 64,
            minWidth: 110,
            background: canSubmit ? c.accent : c.soft,
            color: canSubmit ? c.paper : c.sub,
            border: 'none',
            borderRadius: 10,
            cursor: canSubmit ? 'pointer' : 'not-allowed',
            fontFamily: 'inherit',
            fontSize: 15,
            fontWeight: 600,
            boxShadow: canSubmit ? `0 8px 20px ${c.accent}33` : 'none',
            transition: 'all .15s',
            whiteSpace: 'nowrap',
          }}
        >
          {state === 'loading' ? '…' : `${t('washi.pickupBtn')}  →`}
        </button>
      </div>
      {turnstileGated && config.turnstileSiteKey && (
        /* Invisible widget; challenge fires on submit, not on mount. */
        <div style={{ position: 'absolute', width: 0, height: 0, overflow: 'hidden' }}>
          <TurnstileWidget
            ref={turnstileRef}
            mode="invisible-on-submit"
            siteKey={config.turnstileSiteKey}
              onVerify={() => {}}
              onExpire={() => {}}
              onError={() => {}}
          />
        </div>
      )}
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
