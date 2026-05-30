/**
 * Passkey / WebAuthn settings card.
 *
 * Surfaces the registered credential list, a "register new passkey" button,
 * inline label edit + delete, and the "disable password login" toggle.
 *
 * The disable-password toggle goes through ``PATCH /api/admin/settings`` with
 * ``{password_login_enabled: false}``. We refuse to disable it client-side
 * when there are zero credentials so the admin can't lock themselves out
 * of the panel.
 */
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError } from '@/lib/api';
import {
  deleteWebauthnCredential,
  getAuthMethods,
  listWebauthnCredentials,
  patchAdminSettings,
  patchWebauthnCredential,
  webauthnRegisterBegin,
  webauthnRegisterComplete,
  type WebauthnCredentialOut,
} from '@/lib/api/admin';
import { register, isSupported } from '@/lib/webauthn';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Spinner } from '@/components/ui/Spinner';
import { toast } from '@/components/ui/Toast';

export default function WebAuthnSettingsSection() {
  const { t } = useTranslation();
  const qc = useQueryClient();

  const credsQuery = useQuery({
    queryKey: ['admin', 'webauthn', 'credentials'],
    queryFn: listWebauthnCredentials,
  });
  // Read auth methods to know the current ``password_enabled`` state. We
  // could also derive this from the settings KV, but the methods probe is
  // the authoritative source the login page also consumes.
  const methodsQuery = useQuery({
    queryKey: ['admin', 'auth', 'methods'],
    queryFn: getAuthMethods,
  });

  const [editingId, setEditingId] = useState<number | null>(null);
  const [editLabel, setEditLabel] = useState('');

  const credentials = credsQuery.data?.items ?? [];
  const hasCredentials = credentials.length > 0;
  const passwordEnabled = methodsQuery.data?.password_enabled ?? true;

  const registerMut = useMutation({
    mutationFn: async (label: string | null) => {
      if (!isSupported()) throw new Error(t('admin.passkey.unsupported'));
      const { options } = await webauthnRegisterBegin();
      const credential = await register(options);
      return webauthnRegisterComplete(credential, label);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin', 'webauthn', 'credentials'] });
      qc.invalidateQueries({ queryKey: ['admin', 'auth', 'methods'] });
      toast.success(t('admin.passkey.registered'));
    },
    onError: (e: unknown) => {
      if (e instanceof DOMException && e.name === 'NotAllowedError') {
        toast.error(t('admin.passkey.cancelled'));
        return;
      }
      const msg = e instanceof ApiError ? e.message : (e as Error)?.message ?? '—';
      toast.error(msg);
    },
  });

  const patchMut = useMutation({
    mutationFn: (vars: { id: number; label: string | null }) =>
      patchWebauthnCredential(vars.id, vars.label),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin', 'webauthn', 'credentials'] });
      setEditingId(null);
      toast.success(t('admin.settings.saved'));
    },
    onError: (e: unknown) => {
      const msg = e instanceof ApiError ? e.message : (e as Error)?.message ?? '—';
      toast.error(msg);
    },
  });

  const deleteMut = useMutation({
    mutationFn: (id: number) => deleteWebauthnCredential(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin', 'webauthn', 'credentials'] });
      qc.invalidateQueries({ queryKey: ['admin', 'auth', 'methods'] });
      toast.success(t('admin.passkey.deleted'));
    },
    onError: (e: unknown) => {
      const msg = e instanceof ApiError ? e.message : (e as Error)?.message ?? '—';
      toast.error(msg);
    },
  });

  const passwordToggle = useMutation({
    mutationFn: (next: boolean) =>
      patchAdminSettings({ password_login_enabled: next }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin', 'settings'] });
      qc.invalidateQueries({ queryKey: ['admin', 'auth', 'methods'] });
      toast.success(t('admin.settings.saved'));
    },
    onError: (e: unknown) => {
      const msg = e instanceof ApiError ? e.message : (e as Error)?.message ?? '—';
      toast.error(msg);
    },
  });

  function onRegisterClick() {
    const label = window.prompt(t('admin.passkey.labelPrompt')) ?? null;
    if (label === null) return;
    registerMut.mutate(label.trim() || null);
  }

  function onPasswordToggle(checked: boolean) {
    // checkbox semantics: checked = "disable password login"
    const wantsDisable = checked;
    if (wantsDisable && !hasCredentials) {
      // Guard rail — the methods probe would also forbid this server-side
      // but the friendly client-side message is clearer than a 4xx.
      toast.error(t('admin.passkey.disablePasswordNeedsCred'));
      return;
    }
    if (wantsDisable) {
      const ok = window.confirm(t('admin.passkey.disablePasswordConfirm'));
      if (!ok) return;
    }
    passwordToggle.mutate(!wantsDisable);
  }

  if (credsQuery.isLoading) {
    return (
      <Card>
        <div className="flex items-center justify-center py-6">
          <Spinner />
        </div>
      </Card>
    );
  }

  return (
    <Card>
      <div className="mb-3 text-xs uppercase tracking-wider text-[--text-2]">
        {t('admin.webauthn.title')}
      </div>

      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="text-sm text-[--text-2]">
          {t('admin.webauthn.subtitle')}
        </div>
        <Button
          type="button"
          variant="primary"
          size="sm"
          loading={registerMut.isPending}
          onClick={onRegisterClick}
        >
          {t('admin.passkey.registerNew')}
        </Button>
      </div>

      {credentials.length === 0 ? (
        <div className="text-sm text-[--text-muted]">
          {t('admin.webauthn.empty')}
        </div>
      ) : (
        <ul className="flex flex-col gap-2">
          {credentials.map((c: WebauthnCredentialOut) => (
            <li
              key={c.id}
              className="flex items-center justify-between gap-3 rounded border border-[--border] px-3 py-2 text-sm"
            >
              <div className="min-w-0 flex-1">
                {editingId === c.id ? (
                  <div className="flex items-center gap-2">
                    <Input
                      inputSize="sm"
                      value={editLabel}
                      onChange={(e) => setEditLabel(e.target.value)}
                      autoFocus
                    />
                    <Button
                      type="button"
                      variant="primary"
                      size="sm"
                      loading={patchMut.isPending}
                      onClick={() =>
                        patchMut.mutate({
                          id: c.id,
                          label: editLabel.trim() || null,
                        })
                      }
                    >
                      {t('admin.settings.save')}
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => setEditingId(null)}
                    >
                      {t('admin.files.cancel')}
                    </Button>
                  </div>
                ) : (
                  <>
                    <div className="truncate text-[--text-1]">
                      {c.label || t('admin.webauthn.unlabelled')}
                    </div>
                    <div className="truncate text-xs text-[--text-muted]">
                      {t('admin.webauthn.created')}:{' '}
                      {new Date(c.created_at).toLocaleString()}
                      {c.last_used_at &&
                        ` · ${t('admin.webauthn.lastUsed')}: ${new Date(
                          c.last_used_at,
                        ).toLocaleString()}`}
                      {c.transports.length > 0 &&
                        ` · ${c.transports.join(', ')}`}
                    </div>
                  </>
                )}
              </div>
              {editingId !== c.id && (
                <div className="flex items-center gap-2">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setEditingId(c.id);
                      setEditLabel(c.label ?? '');
                    }}
                  >
                    {t('admin.files.action.edit')}
                  </Button>
                  <Button
                    type="button"
                    variant="danger"
                    size="sm"
                    loading={deleteMut.isPending && deleteMut.variables === c.id}
                    onClick={() => {
                      if (window.confirm(t('admin.passkey.deleteConfirm'))) {
                        deleteMut.mutate(c.id);
                      }
                    }}
                  >
                    {t('admin.files.action.softDelete')}
                  </Button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      {/* ── Disable password login ─────────────────────────────────── */}
      <div className="mt-6 border-t border-[--border] pt-4">
        <label className="flex items-start justify-between gap-3">
          <div className="flex-1">
            <div className="text-sm text-[--text-1]">
              {t('admin.passkey.disablePassword')}
            </div>
            <div className="mt-1 text-xs text-[--text-muted]">
              {t('admin.passkey.disablePasswordDesc')}
            </div>
            {!hasCredentials && (
              <div className="mt-1 text-xs text-amber-400">
                {t('admin.passkey.disablePasswordNeedsCred')}
              </div>
            )}
          </div>
          <input
            type="checkbox"
            className="mt-1"
            checked={!passwordEnabled}
            disabled={!hasCredentials || passwordToggle.isPending}
            onChange={(e) => onPasswordToggle(e.target.checked)}
          />
        </label>
      </div>
    </Card>
  );
}
