/**
 * TurnstileWidget — thin reusable wrapper around @marsidev/react-turnstile.
 *
 * Two modes:
 *   - mode='managed' (default): visible widget renders inline. User completes
 *     the challenge ahead of time; token is delivered via onVerify and the
 *     parent reads `turnstileToken` from its own state at submit.
 *   - mode='invisible-on-submit': widget mounts at 0×0 (execution='execute').
 *     Parent calls `ref.current.executeAndWaitForToken()` from its submit
 *     handler. Cloudflare runs the challenge there — silent on trusted IPs,
 *     a modal-style popup on suspicious ones.
 *
 * Both modes expose `.reset()` so callers can re-arm after a successful
 * submit (single-use tokens) or after a 4003 verification failure.
 *
 * Language is derived from the current i18n locale: en → 'en', zh-CN → 'zh-cn',
 * ja → 'ja'. Theme is left on 'auto' so it follows the host page / OS.
 */
import { forwardRef, useImperativeHandle, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Turnstile, type TurnstileInstance } from '@marsidev/react-turnstile';

export interface TurnstileWidgetHandle {
  /** Re-arm the widget for another challenge (call after submit). */
  reset: () => void;
  /**
   * Trigger the challenge programmatically and resolve with the token.
   * Only meaningful when mode='invisible-on-submit'; in 'managed' mode it
   * just returns whatever token the widget already produced (or null).
   * Rejects on timeout (default 30s) or widget error.
   */
  executeAndWaitForToken: (timeoutMs?: number) => Promise<string>;
}

export type TurnstileWidgetMode = 'managed' | 'invisible-on-submit';

export interface TurnstileWidgetProps {
  /** Cloudflare Turnstile site key (from /api/config). */
  siteKey: string;
  /**
   * UX mode. 'managed' shows the widget upfront; 'invisible-on-submit'
   * defers the challenge until the parent calls executeAndWaitForToken().
   * Default: 'managed' (back-compat).
   */
  mode?: TurnstileWidgetMode;
  /** Fires when the user completes the challenge — receives the token. */
  onVerify: (token: string) => void;
  /** Fires when the token expires before submit (~5min by default). */
  onExpire?: () => void;
  /** Fires on widget error (network glitch, etc.). */
  onError?: () => void;
}

/** Map our i18n locale codes to the codes the Turnstile widget expects. */
function toWidgetLang(lng: string | undefined): string {
  if (!lng) return 'auto';
  const l = lng.toLowerCase();
  if (l.startsWith('zh')) return 'zh-cn';
  if (l.startsWith('ja')) return 'ja';
  if (l.startsWith('en')) return 'en';
  return 'auto';
}

export const TurnstileWidget = forwardRef<TurnstileWidgetHandle, TurnstileWidgetProps>(
  function TurnstileWidget({ siteKey, mode = 'managed', onVerify, onExpire, onError }, ref) {
    const { i18n } = useTranslation();
    const innerRef = useRef<TurnstileInstance | null>(null);

    useImperativeHandle(
      ref,
      () => ({
        reset: () => {
          try {
            innerRef.current?.reset();
          } catch {
            /* widget may not be mounted yet — ignore */
          }
        },
        executeAndWaitForToken: async (timeoutMs = 30_000) => {
          const inst = innerRef.current;
          if (!inst) throw new Error('turnstile_not_ready');
          if (mode === 'invisible-on-submit') {
            // Fire-and-forget; the SDK will run callback() on success which
            // bubbles up through onVerify in the parent. We then poll for
            // the response via getResponsePromise (handles both already-
            // resolved-trust-IP and pop-the-challenge-modal cases).
            try {
              inst.execute();
            } catch {
              /* execute may no-op if a challenge is already in flight */
            }
          }
          const token = await inst.getResponsePromise(timeoutMs, 100);
          return token;
        },
      }),
      [mode],
    );

    return (
      <Turnstile
        ref={innerRef}
        siteKey={siteKey}
        options={{
          theme: 'auto',
          size: 'normal',
          language: toWidgetLang(i18n.language),
          execution: mode === 'invisible-on-submit' ? 'execute' : 'render',
          appearance: mode === 'invisible-on-submit' ? 'interaction-only' : 'always',
        }}
        onSuccess={onVerify}
        onExpire={onExpire}
        onError={onError}
      />
    );
  },
);

export default TurnstileWidget;
