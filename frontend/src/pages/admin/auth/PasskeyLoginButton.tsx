/**
 * Passkey sign-in button shown on the login page when ``webauthn_enabled``
 * is true (at least one credential is registered on the server).
 *
 * Flow:
 *   1. ``POST /api/admin/webauthn/login/begin`` — the server stores a signed
 *      challenge cookie and returns assertion options.
 *   2. ``navigator.credentials.get()`` — the browser prompts the user.
 *   3. ``POST /api/admin/webauthn/login/complete`` with the assertion JSON.
 *      On success the server returns the same ``{token, expires_at}`` shape
 *      as the password login, which we drop into the zustand admin store.
 */
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { ApiError } from '@/lib/api';
import { useAdminStore } from '@/stores/admin';
import {
  webauthnLoginBegin,
  webauthnLoginComplete,
} from '@/lib/api/admin';
import { authenticate, isSupported } from '@/lib/webauthn';

interface Props {
  onError?: (msg: string) => void;
}

export default function PasskeyLoginButton({ onError }: Props) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const setToken = useAdminStore((s) => s.set);
  const [busy, setBusy] = useState(false);

  async function onClick() {
    if (busy) return;
    if (!isSupported()) {
      onError?.(t('admin.passkey.unsupported'));
      return;
    }
    setBusy(true);
    try {
      const { options } = await webauthnLoginBegin();
      const credential = await authenticate(options);
      const res = await webauthnLoginComplete(credential);
      setToken(res.token, res.expires_at);
      navigate('/admin', { replace: true });
    } catch (err) {
      if (err instanceof DOMException && err.name === 'NotAllowedError') {
        onError?.(t('admin.passkey.cancelled'));
      } else if (err instanceof ApiError) {
        onError?.(err.message || t('admin.passkey.error'));
      } else {
        onError?.(t('admin.passkey.error'));
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <Button
      type="button"
      variant="primary"
      loading={busy}
      onClick={onClick}
    >
      {busy ? t('admin.passkey.signingIn') : t('admin.passkey.signInWith')}
    </Button>
  );
}
