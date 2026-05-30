/**
 * SPA landing for the OIDC login round-trip.
 *
 * The backend ``GET /api/admin/oidc/callback`` (login flow) verifies the IdP
 * response, mints an admin JWT, and 302s here with ``?token=&expires_at=``.
 * This component:
 *   1. Pulls the two query params out.
 *   2. Stashes them into the zustand admin store.
 *   3. Clears the query from the URL via ``history.replaceState`` so a
 *      hard-refresh doesn't leak the token to browser history.
 *   4. Navigates to ``/admin``.
 *
 * Anything malformed → bounce to ``/admin/login?oidc_error=missing_token``.
 */
import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAdminStore } from '@/stores/admin';
import { Spinner } from '@/components/ui/Spinner';

export default function OidcCallback() {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const setToken = useAdminStore((s) => s.set);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const token = params.get('token');
    const expiresAt = params.get('expires_at');
    if (token && expiresAt) {
      setToken(token, expiresAt);
      // Strip sensitive query params from the URL bar.
      window.history.replaceState({}, '', '/admin/oidc/callback');
      navigate('/admin', { replace: true });
    } else {
      navigate('/admin/login?oidc_error=missing_token', { replace: true });
    }
  }, [navigate, setToken]);

  return (
    <main className="flex min-h-[60vh] flex-col items-center justify-center gap-3">
      <Spinner />
      <p className="text-sm text-[--text-2]">{t('admin.oidc.signingIn')}</p>
    </main>
  );
}
