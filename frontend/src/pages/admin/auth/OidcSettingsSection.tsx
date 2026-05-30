/**
 * OIDC settings card.
 *
 * Surfaces the same shape as ``GET /api/admin/oidc/config`` — enable toggle,
 * issuer / client_id / client_secret (masked) / scopes / provider label /
 * redirect URI — plus a bound-identities list with a "bind new" affordance
 * and per-row unbind.
 *
 * Binding flow: clicking "Bind new identity" navigates the current window to
 * ``/api/admin/oidc/login?bind=1``. The backend stashes the IdP-validated
 * identity in a short-lived cookie and redirects to ``/admin/oidc/bound``;
 * that route should call ``createOidcBinding()`` to persist it. The page
 * refresh after navigation will re-fetch the list so newly-bound rows
 * appear without an explicit invalidate.
 */
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError } from '@/lib/api';
import {
  deleteOidcBinding,
  getOidcConfig,
  listOidcBindings,
  putOidcConfig,
  type OidcBindingItem,
  type OidcConfigResponse,
  type OidcConfigUpdateRequest,
} from '@/lib/api/admin';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Spinner } from '@/components/ui/Spinner';
import { toast } from '@/components/ui/Toast';

interface FormState {
  enabled: boolean;
  issuer: string;
  client_id: string;
  client_secret: string;
  scopes: string;
  redirect_uri: string;
  provider_label: string;
  /** Has the user opened the secret field to type a new value? */
  secretEdited: boolean;
  /** Was a masked secret present on initial load? */
  hadExistingSecret: boolean;
}

const EMPTY: FormState = {
  enabled: false,
  issuer: '',
  client_id: '',
  client_secret: '',
  scopes: 'openid profile email',
  redirect_uri: '',
  provider_label: 'oidc',
  secretEdited: false,
  hadExistingSecret: false,
};

export default function OidcSettingsSection() {
  const { t } = useTranslation();
  const qc = useQueryClient();

  const cfgQuery = useQuery({
    queryKey: ['admin', 'oidc', 'config'],
    queryFn: getOidcConfig,
  });
  const bindingsQuery = useQuery({
    queryKey: ['admin', 'oidc', 'bindings'],
    queryFn: listOidcBindings,
  });

  const [form, setForm] = useState<FormState>(EMPTY);

  useEffect(() => {
    if (!cfgQuery.data) return;
    const d = cfgQuery.data;
    const masked = d.client_secret === '****';
    setForm({
      enabled: d.enabled,
      issuer: d.issuer ?? '',
      client_id: d.client_id ?? '',
      client_secret: masked ? '****' : '',
      scopes: d.scopes || 'openid profile email',
      redirect_uri: d.redirect_uri ?? '',
      provider_label: d.provider_label || 'oidc',
      secretEdited: false,
      hadExistingSecret: masked,
    });
  }, [cfgQuery.data]);

  const save = useMutation({
    mutationFn: (body: OidcConfigUpdateRequest) => putOidcConfig(body),
    onSuccess: (next: OidcConfigResponse) => {
      qc.setQueryData(['admin', 'oidc', 'config'], next);
      toast.success(t('admin.settings.saved'));
      setForm((f) => ({
        ...f,
        client_secret: next.client_secret === '****' ? '****' : '',
        secretEdited: false,
        hadExistingSecret: next.client_secret === '****',
      }));
    },
    onError: (e: unknown) => {
      const msg = e instanceof ApiError ? e.message : (e as Error)?.message ?? '—';
      toast.error(msg);
    },
  });

  const unbind = useMutation({
    mutationFn: (id: number) => deleteOidcBinding(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin', 'oidc', 'bindings'] });
      toast.success(t('admin.oidc.unbound'));
    },
    onError: (e: unknown) => {
      const msg = e instanceof ApiError ? e.message : (e as Error)?.message ?? '—';
      toast.error(msg);
    },
  });

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!cfgQuery.data) return;
    // Only send the secret when the user opened the field to change it.
    const client_secret = form.secretEdited
      ? form.client_secret
      : form.hadExistingSecret
      ? '****'
      : form.client_secret;
    save.mutate({
      enabled: form.enabled,
      issuer: form.issuer.trim(),
      client_id: form.client_id.trim(),
      client_secret,
      scopes: form.scopes.trim() || 'openid profile email',
      redirect_uri: form.redirect_uri.trim(),
      provider_label: form.provider_label.trim() || 'oidc',
    });
  }

  if (cfgQuery.isLoading || !cfgQuery.data) {
    return (
      <Card>
        <div className="flex items-center justify-center py-6">
          <Spinner />
        </div>
      </Card>
    );
  }

  const effectiveRedirect = cfgQuery.data.effective_redirect_uri;
  const bindings = bindingsQuery.data?.items ?? [];

  return (
    <form onSubmit={onSubmit}>
      <Card>
        <div className="mb-3 text-xs uppercase tracking-wider text-[--text-2]">
          {t('admin.oidc.title')}
        </div>

        {/* Enable toggle */}
        <label className="mb-4 flex items-center justify-between gap-3">
          <div>
            <div className="text-sm text-[--text-1]">
              {t('admin.oidc.enabled')}
            </div>
            <div className="text-xs text-[--text-muted]">
              {t('admin.oidc.enabledDesc')}
            </div>
          </div>
          <input
            type="checkbox"
            checked={form.enabled}
            onChange={(e) => setForm({ ...form, enabled: e.target.checked })}
          />
        </label>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-1 text-sm sm:col-span-2">
            <span className="text-[--text-2]">{t('admin.oidc.issuer')}</span>
            <Input
              inputSize="sm"
              value={form.issuer}
              onChange={(e) => setForm({ ...form, issuer: e.target.value })}
              placeholder="https://idp.example.com"
              autoComplete="off"
            />
          </label>

          <label className="flex flex-col gap-1 text-sm">
            <span className="text-[--text-2]">{t('admin.oidc.clientId')}</span>
            <Input
              inputSize="sm"
              value={form.client_id}
              onChange={(e) => setForm({ ...form, client_id: e.target.value })}
              autoComplete="off"
            />
          </label>

          <label className="flex flex-col gap-1 text-sm">
            <span className="text-[--text-2]">{t('admin.oidc.clientSecret')}</span>
            {!form.secretEdited && form.hadExistingSecret ? (
              <div className="flex items-center gap-2">
                <Input
                  inputSize="sm"
                  value="****"
                  disabled
                  readOnly
                  className="flex-1"
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    setForm({ ...form, secretEdited: true, client_secret: '' })
                  }
                >
                  {t('admin.settings.storage.change')}
                </Button>
              </div>
            ) : (
              <Input
                type="password"
                inputSize="sm"
                value={form.client_secret}
                onChange={(e) =>
                  setForm({
                    ...form,
                    client_secret: e.target.value,
                    secretEdited: true,
                  })
                }
                autoComplete="new-password"
              />
            )}
          </label>

          <label className="flex flex-col gap-1 text-sm">
            <span className="text-[--text-2]">{t('admin.oidc.scopes')}</span>
            <Input
              inputSize="sm"
              value={form.scopes}
              onChange={(e) => setForm({ ...form, scopes: e.target.value })}
              autoComplete="off"
            />
          </label>

          <label className="flex flex-col gap-1 text-sm">
            <span className="text-[--text-2]">
              {t('admin.oidc.providerLabel')}
            </span>
            <Input
              inputSize="sm"
              value={form.provider_label}
              onChange={(e) =>
                setForm({ ...form, provider_label: e.target.value })
              }
              autoComplete="off"
            />
          </label>

          <label className="flex flex-col gap-1 text-sm sm:col-span-2">
            <span className="text-[--text-2]">
              {t('admin.oidc.redirectUri')}
            </span>
            <Input
              inputSize="sm"
              value={form.redirect_uri}
              onChange={(e) =>
                setForm({ ...form, redirect_uri: e.target.value })
              }
              placeholder={effectiveRedirect}
              autoComplete="off"
            />
            <span className="text-xs text-[--text-muted]">
              {t('admin.oidc.redirectUriHint', { effective: effectiveRedirect })}
            </span>
          </label>
        </div>

        <div className="mt-4 flex items-center justify-end">
          <Button type="submit" variant="primary" loading={save.isPending}>
            {t('admin.settings.save')}
          </Button>
        </div>

        {/* ── Bound identities ───────────────────────────────────── */}
        <div className="mt-6 border-t border-[--border] pt-4">
          <div className="mb-2 flex items-center justify-between">
            <div className="text-xs uppercase tracking-wider text-[--text-2]">
              {t('admin.oidc.bindings.title')}
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                window.location.href = '/api/admin/oidc/login?bind=1';
              }}
            >
              {t('admin.oidc.bindings.bindNew')}
            </Button>
          </div>
          {bindingsQuery.isLoading ? (
            <Spinner />
          ) : bindings.length === 0 ? (
            <div className="text-sm text-[--text-muted]">
              {t('admin.oidc.bindings.empty')}
            </div>
          ) : (
            <ul className="flex flex-col gap-2">
              {bindings.map((b: OidcBindingItem) => (
                <li
                  key={b.id}
                  className="flex items-center justify-between gap-3 rounded border border-[--border] px-3 py-2 text-sm"
                >
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[--text-1]">
                      {b.display_name || b.email || b.subject}
                    </div>
                    <div className="truncate text-xs text-[--text-muted]">
                      {b.provider} · {b.subject}
                      {b.last_login_at &&
                        ` · ${t('admin.oidc.bindings.lastLogin')}: ${new Date(
                          b.last_login_at,
                        ).toLocaleString()}`}
                    </div>
                  </div>
                  <Button
                    type="button"
                    variant="danger"
                    size="sm"
                    loading={unbind.isPending && unbind.variables === b.id}
                    onClick={() => {
                      if (window.confirm(t('admin.oidc.bindings.unbindConfirm'))) {
                        unbind.mutate(b.id);
                      }
                    }}
                  >
                    {t('admin.oidc.bindings.unbind')}
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </Card>
    </form>
  );
}
