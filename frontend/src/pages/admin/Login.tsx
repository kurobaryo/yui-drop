/**
 * Admin Login — single password input. Stores the issued Bearer token in
 * the persisted admin store, then navigates to /admin.
 */
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { adminLogin } from '@/lib/api/admin';
import { ApiError } from '@/lib/api';
import { useAdminStore } from '@/stores/admin';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Header } from '@/components/layout/Header';
import { Footer } from '@/components/layout/Footer';

export default function AdminLogin() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const setToken = useAdminStore((s) => s.set);

  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e?: React.FormEvent) {
    e?.preventDefault();
    if (submitting || !password) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await adminLogin(password);
      setToken(res.token, res.expires_at);
      navigate('/admin', { replace: true });
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message || t('admin.login.error'));
      } else {
        setError(t('admin.login.error'));
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <Header />
      <main className="mx-auto flex min-h-[60vh] max-w-sm flex-col justify-center px-4 md:px-6">
        <h1 className="mb-4 text-xl font-semibold text-[--text-1]">
          {t('admin.login.title')}
        </h1>
        <form onSubmit={submit} className="flex flex-col gap-3">
          <Input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder={t('admin.login.password')}
            autoFocus
            hasError={!!error}
            autoComplete="current-password"
          />
          {error && (
            <p className="text-sm text-red-400" role="alert">
              {error}
            </p>
          )}
          <Button
            type="submit"
            variant="primary"
            loading={submitting}
            disabled={!password}
          >
            {submitting ? t('admin.login.loading') : t('admin.login.submit')}
          </Button>
        </form>
      </main>
      <Footer />
    </>
  );
}
