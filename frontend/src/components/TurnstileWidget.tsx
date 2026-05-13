/**
 * TurnstileWidget — thin reusable wrapper around @marsidev/react-turnstile.
 *
 * Renders the visible (managed) Turnstile widget — NOT the invisible variant.
 * Exposes a `.reset()` method via ref so callers can re-arm the challenge
 * after a successful submit (single-use tokens) or after a 4003 verification
 * failure from the server.
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
}

export interface TurnstileWidgetProps {
  /** Cloudflare Turnstile site key (from /api/config). */
  siteKey: string;
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
  function TurnstileWidget({ siteKey, onVerify, onExpire, onError }, ref) {
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
      }),
      [],
    );

    return (
      <Turnstile
        ref={innerRef}
        siteKey={siteKey}
        options={{
          theme: 'auto',
          size: 'normal',
          language: toWidgetLang(i18n.language),
        }}
        onSuccess={onVerify}
        onExpire={onExpire}
        onError={onError}
      />
    );
  },
);

export default TurnstileWidget;
