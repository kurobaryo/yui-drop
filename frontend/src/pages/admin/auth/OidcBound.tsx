/**
 * SPA landing for the OIDC bind flow.
 *
 * The backend ``GET /api/admin/oidc/callback?bind=1`` stores the validated
 * IdP identity in a short-lived signed cookie and 302s here. This component
 * (which requires an existing admin session) calls
 * ``POST /api/admin/oidc/bindings`` to materialise the binding, then sends
 * the admin back to settings.
 *
 * If the call fails (cookie expired, already bound, …) we surface the error
 * inline rather than auto-redirecting so the admin sees the cause.
 */
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { createOidcBinding } from '@/lib/api/admin';
import { ApiError } from '@/lib/api';
import { useAdminStore } from '@/stores/admin';
import { Spinner } from '@/components/ui/Spinner';
import { Button } from '@/components/ui/Button';

export default function OidcBound() {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const isValid = useAdminStore((s) => s.isValid());
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (!isValid) {
      navigate('/admin/login?oidc_error=bind_requires_session', { replace: true });
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        await createOidcBinding();
        if (cancelled) return;
        setDone(true);
        navigate('/admin/settings?oidc_bound=1', { replace: true });
      } catch (err) {
        if (cancelled) return;
        if (err instanceof ApiError) {
          setError(err.message);
        } else {
          setError((err as Error)?.message ?? 'bind_failed');
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isValid, navigate]);

  if (error) {
    return (
      <main className="mx-auto flex min-h-[60vh] max-w-md flex-col items-center justify-center gap-3 px-4">
        <p className="text-sm text-red-400" role="alert">
          {t('admin.oidc.bindFailed')}: {error}
        </p>
        <Button
          variant="primary"
          onClick={() => navigate('/admin/settings', { replace: true })}
        >
          {t('admin.nav.settings')}
        </Button>
      </main>
    );
  }

  return (
    <main className="flex min-h-[60vh] flex-col items-center justify-center gap-3">
      <Spinner />
      <p className="text-sm text-[--text-2]">
        {done ? t('admin.oidc.bindOk') : t('admin.oidc.binding')}
      </p>
    </main>
  );
}
