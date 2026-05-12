/**
 * Admin Settings — read /admin/settings, surface env (read-only) and a
 * couple of editable knobs:
 *   - rotate admin password (with confirm-match check)
 *   - turnstile_enabled toggle (only togglable when site-key is configured)
 *
 * "Save" PATCHes only the touched keys so we don't accidentally wipe
 * unknown KV entries.
 */
import { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  getAdminSettings,
  patchAdminSettings,
  type AdminSettingsResponse,
} from '@/lib/api/admin';
import { ApiError } from '@/lib/api';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Spinner } from '@/components/ui/Spinner';
import { toast } from '@/components/ui/Toast';
import { humanBytes } from '@/lib/format';

interface FormState {
  newPassword: string;
  confirmPassword: string;
  turnstileEnabled: boolean;
  auditLogAccessIp: boolean;
}

const EMPTY: FormState = {
  newPassword: '',
  confirmPassword: '',
  turnstileEnabled: false,
  auditLogAccessIp: true,
};

export default function AdminSettings() {
  const { t } = useTranslation();
  const qc = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ['admin', 'settings'],
    queryFn: getAdminSettings,
  });

  const [form, setForm] = useState<FormState>(EMPTY);
  const [passwordError, setPasswordError] = useState<string | null>(null);

  // Sync form when the server data first arrives / changes.
  useEffect(() => {
    if (!data) return;
    setForm({
      newPassword: '',
      confirmPassword: '',
      turnstileEnabled: data.env.turnstile_enabled,
      auditLogAccessIp: data.env.audit_log_access_ip ?? true,
    });
  }, [data]);

  const save = useMutation({
    mutationFn: (updates: Record<string, unknown>) =>
      patchAdminSettings(updates),
    onSuccess: (next: AdminSettingsResponse) => {
      qc.setQueryData(['admin', 'settings'], next);
      toast.success(t('admin.settings.saved'));
      setForm((f) => ({ ...f, newPassword: '', confirmPassword: '' }));
    },
    onError: (e: unknown) => {
      const msg = e instanceof ApiError ? e.message : (e as Error)?.message ?? '—';
      toast.error(msg);
    },
  });

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!data) return;

    const updates: Record<string, unknown> = {};

    if (form.newPassword || form.confirmPassword) {
      if (form.newPassword !== form.confirmPassword) {
        setPasswordError(t('admin.settings.passwordMismatch'));
        return;
      }
      setPasswordError(null);
      updates.admin_password = form.newPassword;
    }

    if (form.turnstileEnabled !== data.env.turnstile_enabled) {
      updates.turnstile_enabled = form.turnstileEnabled;
    }

    if (form.auditLogAccessIp !== (data.env.audit_log_access_ip ?? true)) {
      updates.audit_log_access_ip = form.auditLogAccessIp;
    }

    if (Object.keys(updates).length === 0) {
      toast.info(t('admin.settings.saved'));
      return;
    }
    save.mutate(updates);
  }

  if (isLoading || !data) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center">
        <Spinner />
      </div>
    );
  }

  const canEnableTurnstile = data.env.turnstile_site_key_present;

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold text-[--text-1]">
        {t('admin.settings.title')}
      </h1>

      {/* ── Environment (read-only) ──────────────────────────────────── */}
      <Card>
        <div className="mb-2 text-xs uppercase tracking-wider text-[--text-2]">
          {t('admin.settings.env')}
        </div>
        <dl className="grid grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
          <Row label={t('admin.settings.appName')} value={data.env.app_name} />
          <Row
            label={t('admin.settings.storageBackend')}
            value={data.env.storage_backend}
          />
          <Row
            label={t('admin.settings.maxUpload')}
            value={humanBytes(data.env.max_upload_bytes)}
          />
          <Row
            label={t('admin.settings.turnstile')}
            value={
              data.env.turnstile_enabled
                ? 'enabled'
                : data.env.turnstile_site_key_present
                ? 'configured · disabled'
                : 'not configured'
            }
          />
        </dl>
      </Card>

      <form onSubmit={onSubmit} className="flex flex-col gap-6">
        {/* ── Rotate password ──────────────────────────────────────── */}
        <Card>
          <div className="mb-3 text-xs uppercase tracking-wider text-[--text-2]">
            {t('admin.settings.rotatePassword')}
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-[--text-2]">
                {t('admin.settings.newPassword')}
              </span>
              <Input
                type="password"
                inputSize="sm"
                value={form.newPassword}
                onChange={(e) =>
                  setForm({ ...form, newPassword: e.target.value })
                }
                autoComplete="new-password"
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-[--text-2]">
                {t('admin.settings.confirmPassword')}
              </span>
              <Input
                type="password"
                inputSize="sm"
                value={form.confirmPassword}
                onChange={(e) =>
                  setForm({ ...form, confirmPassword: e.target.value })
                }
                autoComplete="new-password"
                hasError={!!passwordError}
              />
            </label>
          </div>
          {passwordError && (
            <p className="mt-2 text-sm text-red-400">{passwordError}</p>
          )}
        </Card>

        {/* ── Turnstile toggle ─────────────────────────────────────── */}
        <Card>
          <label className="flex items-center justify-between gap-3">
            <div>
              <div className="text-sm text-[--text-1]">
                {t('admin.settings.turnstile')}
              </div>
              {!canEnableTurnstile && (
                <div className="text-xs text-[--text-muted]">
                  Site key not configured.
                </div>
              )}
            </div>
            <input
              type="checkbox"
              checked={form.turnstileEnabled}
              disabled={!canEnableTurnstile}
              onChange={(e) =>
                setForm({ ...form, turnstileEnabled: e.target.checked })
              }
            />
          </label>
        </Card>

        {/* ── Audit logging (G.3) ──────────────────────────────────── */}
        <Card>
          <div className="mb-2 text-xs uppercase tracking-wider text-[--text-2]">
            {t('admin.settings.audit.title')}
          </div>
          <label className="flex items-start justify-between gap-3">
            <div className="flex-1">
              <div className="text-sm text-[--text-1]">
                {t('admin.settings.audit.logAccessIp.label')}
              </div>
              <div className="mt-1 text-xs text-[--text-muted]">
                {t('admin.settings.audit.logAccessIp.desc')}
              </div>
            </div>
            <input
              type="checkbox"
              className="mt-1"
              checked={form.auditLogAccessIp}
              onChange={(e) =>
                setForm({ ...form, auditLogAccessIp: e.target.checked })
              }
            />
          </label>
        </Card>

        <div className="flex items-center justify-end">
          <Button type="submit" variant="primary" loading={save.isPending}>
            {t('admin.settings.save')}
          </Button>
        </div>
      </form>
    </div>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="text-[--text-2]">{label}</dt>
      <dd className="text-[--text-1] font-mono text-xs">{value}</dd>
    </div>
  );
}
