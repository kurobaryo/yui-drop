/**
 * Admin Login — composes one or more auth methods based on the
 * ``GET /api/admin/auth/methods`` probe:
 *   • Passkey button (shown when at least one credential is registered)
 *   • Password form (shown when ``password_enabled`` is true)
 *   • OIDC sign-in button (shown when the admin enabled an IdP)
 *
 * Also handles ``?oidc_error=`` redirects from the IdP callback so the user
 * sees a friendly message instead of being silently bounced back to /login.
 */
import { useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { adminLogin, getAuthMethods } from '@/lib/api/admin';
import { getConfig } from '@/lib/api/public';
import { ApiError } from '@/lib/api';
import { useAdminStore } from '@/stores/admin';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Header } from '@/components/layout/Header';
import { Footer } from '@/components/layout/Footer';
import OidcLoginButton from './auth/OidcLoginButton';
import PasskeyLoginButton from './auth/PasskeyLoginButton';
import {
  TurnstileWidget,
  type TurnstileWidgetHandle,
} from '@/components/TurnstileWidget';

export default function AdminLogin() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const setToken = useAdminStore((s) => s.set);
  const [searchParams, setSearchParams] = useSearchParams();

  const methodsQuery = useQuery({
    queryKey: ['admin', 'auth', 'methods'],
    queryFn: getAuthMethods,
    // Re-fetch on focus so a passkey registered in another tab unlocks the
    // button on this one without a hard refresh.
    refetchOnWindowFocus: true,
  });
  const configQuery = useQuery({
    queryKey: ['public-config'],
    queryFn: getConfig,
    staleTime: 60_000,
  });

  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const turnstileRef = useRef<TurnstileWidgetHandle | null>(null);

  // Surface ``?oidc_error=...`` from the IdP callback and strip it so the
  // message doesn't reappear on every re-render.
  useEffect(() => {
    const reason = searchParams.get('oidc_error');
    if (!reason) return;
    setError(t(`admin.oidc.errors.${reason}`, { defaultValue: reason }));
    const next = new URLSearchParams(searchParams);
    next.delete('oidc_error');
    setSearchParams(next, { replace: true });
  }, [searchParams, setSearchParams, t]);

  async function submit(e?: React.FormEvent) {
    e?.preventDefault();
    if (submitting || !password) return;
    setSubmitting(true);
    setError(null);
    try {
      let turnstileToken: string | null = null;
      if (turnstileGated) {
        try {
          turnstileToken = await turnstileRef.current?.executeAndWaitForToken() ?? null;
        } catch {
          setError(t('admin.login.error'));
          setSubmitting(false);
          return;
        }
      }
      const res = await adminLogin(password, turnstileToken);
      setToken(res.token, res.expires_at);
      navigate('/admin', { replace: true });
    } catch (err) {
      turnstileRef.current?.reset();
      if (err instanceof ApiError) {
        setError(err.message || t('admin.login.error'));
      } else {
        setError(t('admin.login.error'));
      }
    } finally {
      setSubmitting(false);
    }
  }

  const methods = methodsQuery.data;
  const config = configQuery.data;
  const turnstileGated = Boolean(
    config?.turnstileProtectAdminLogin && config?.turnstileSiteKey,
  );
  // Be permissive on the first paint: show the password form while the
  // probe is in flight so the page never looks empty.
  const showPassword = methods ? methods.password_enabled : true;
  const showPasskey = methods?.webauthn_enabled ?? false;
  const showOidc = methods?.oidc_enabled ?? false;
  const providerLabel = methods?.oidc_provider_label ?? '';

  return (
    <>
      <Header />
      <main className="mx-auto flex min-h-[60vh] max-w-sm flex-col justify-center px-4 md:px-6">
        <h1 className="mb-4 text-xl font-semibold text-[--text-1]">
          {t('admin.login.title')}
        </h1>

        {showPasskey && (
          <div className="mb-4 flex flex-col gap-2">
            <PasskeyLoginButton onError={(m) => setError(m)} />
          </div>
        )}

        {showPassword && (
          <form onSubmit={submit} className="flex flex-col gap-3">
            {turnstileGated && config?.turnstileSiteKey && (
              <div className="absolute h-0 w-0 overflow-hidden">
                <TurnstileWidget
                  ref={turnstileRef}
                  mode="invisible-on-submit"
                  siteKey={config.turnstileSiteKey}
                  onVerify={() => undefined}
                />
              </div>
            )}
            <Input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={t('admin.login.password')}
              autoFocus
              hasError={!!error}
              autoComplete="current-password"
            />
            <Button
              type="submit"
              variant="primary"
              loading={submitting}
              disabled={!password}
            >
              {submitting ? t('admin.login.loading') : t('admin.login.submit')}
            </Button>
          </form>
        )}

        {!showPassword && !showPasskey && !showOidc && methods && (
          <p className="text-sm text-[--text-muted]" role="alert">
            {t('admin.auth.allDisabled')}
          </p>
        )}

        {error && (
          <p className="mt-3 text-sm text-red-400" role="alert">
            {error}
          </p>
        )}

        {showOidc && (
          <div className="mt-4 flex flex-col gap-2">
            <OidcLoginButton providerLabel={providerLabel} />
          </div>
        )}
      </main>
      <Footer />
    </>
  );
}
