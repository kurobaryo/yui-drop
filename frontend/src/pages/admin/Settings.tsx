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
  getAdminStorage,
  postAdminStorage,
  getAdminTurnstile,
  putAdminTurnstile,
  getAdminUploads,
  putAdminUploads,
  type AdminSettingsResponse,
  type StorageConfigResponse,
  type StorageConfigRequest,
  type TurnstileConfigResponse,
  type UploadLimitsResponse,
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

      {/* ── Storage backend (H.6) — submits independently from the form above. */}
      <StorageCard />

      {/* ── Turnstile keys (#6) — independent card, own save button. */}
      <TurnstileCard />

      {/* ── Upload limits + chunk toggle (#7/#8) — independent card. */}
      <UploadLimitsCard />
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

// ─── Storage backend card (H.6) ──────────────────────────────────────────
//
// Renders a Local/S3 radio. When S3 is selected we expose six inputs; the
// secret_access_key has a masked pattern — initially shown as "****" with a
// "Change" button, and only sent on the wire when the user explicitly chose
// to replace it. `null` on submit means "keep existing encrypted value".

interface StorageFormState {
  backend: 'local' | 's3';
  endpoint_url: string;
  bucket_name: string;
  access_key_id: string;
  secret_access_key: string;
  region: string;
  public_hostname: string;
  prefix: string;
  /** Has the user opened the secret field to type a new value? */
  secretEdited: boolean;
  /** Was a masked secret present on initial load? */
  hadExistingSecret: boolean;
}

const EMPTY_STORAGE: StorageFormState = {
  backend: 'local',
  endpoint_url: '',
  bucket_name: '',
  access_key_id: '',
  secret_access_key: '',
  region: 'auto',
  public_hostname: '',
  prefix: '',
  secretEdited: false,
  hadExistingSecret: false,
};

function StorageCard() {
  const { t } = useTranslation();
  const qc = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ['admin', 'storage'],
    queryFn: getAdminStorage,
  });

  const [form, setForm] = useState<StorageFormState>(EMPTY_STORAGE);

  // Sync form when server data first arrives / changes.
  useEffect(() => {
    if (!data) return;
    const s3 = data.s3 ?? {
      endpoint_url: '',
      bucket_name: '',
      access_key_id: '',
      secret_access_key: '',
      region: 'auto',
      public_hostname: '',
      prefix: '',
    };
    const masked = s3.secret_access_key === '****';
    setForm({
      backend: (data.backend ?? 'local') as 'local' | 's3',
      endpoint_url: s3.endpoint_url ?? '',
      bucket_name: s3.bucket_name ?? '',
      access_key_id: s3.access_key_id ?? '',
      secret_access_key: masked ? '****' : '',
      region: s3.region || 'auto',
      public_hostname: s3.public_hostname ?? '',
      prefix: s3.prefix ?? '',
      secretEdited: false,
      hadExistingSecret: masked,
    });
  }, [data]);

  const save = useMutation({
    mutationFn: (body: StorageConfigRequest) => postAdminStorage(body),
    onSuccess: (next: StorageConfigResponse) => {
      qc.setQueryData(['admin', 'storage'], next);
      toast.success(t('admin.settings.storage.savedNoMigrate'));
      // Reset secret-edit state after a successful save: the server now has
      // the new (or unchanged) value, so the field goes back to masked.
      setForm((f) => ({
        ...f,
        secret_access_key: next.s3?.secret_access_key === '****' ? '****' : '',
        secretEdited: false,
        hadExistingSecret: next.s3?.secret_access_key === '****',
      }));
    },
    onError: (e: unknown) => {
      const msg = e instanceof ApiError ? e.message : (e as Error)?.message ?? '—';
      toast.error(msg);
    },
  });

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (form.backend === 'local') {
      save.mutate({ backend: 'local' });
      return;
    }
    // When backend = s3, send the secret only if the user opened the field
    // to change it; otherwise null = keep existing.
    const secret_access_key = form.secretEdited
      ? form.secret_access_key
      : null;
    save.mutate({
      backend: 's3',
      s3: {
        endpoint_url: form.endpoint_url.trim(),
        bucket_name: form.bucket_name.trim(),
        access_key_id: form.access_key_id.trim(),
        secret_access_key,
        region: form.region.trim() || 'auto',
        public_hostname: form.public_hostname.trim() || null,
        prefix: form.prefix.trim(),
      },
    });
  }

  if (isLoading || !data) {
    return (
      <Card>
        <div className="flex items-center justify-center py-6">
          <Spinner />
        </div>
      </Card>
    );
  }

  const isS3 = form.backend === 's3';

  return (
    <form onSubmit={onSubmit}>
      <Card>
        <div className="mb-3 text-xs uppercase tracking-wider text-[--text-2]">
          {t('admin.settings.storage.title')}
        </div>

        {/* Backend radio */}
        <div
          role="radiogroup"
          aria-label="storage-backend"
          className="mb-4 flex flex-wrap items-center gap-4 text-sm"
        >
          {(['local', 's3'] as const).map((b) => (
            <label key={b} className="inline-flex items-center gap-2">
              <input
                type="radio"
                name="storage-backend"
                value={b}
                checked={form.backend === b}
                onChange={() => setForm({ ...form, backend: b })}
              />
              <span className="text-[--text-1]">
                {t(`admin.settings.storage.${b}`)}
              </span>
            </label>
          ))}
        </div>

        {/* S3 fields */}
        {isS3 && (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-[--text-2]">
                {t('admin.settings.storage.endpoint')}
              </span>
              <Input
                inputSize="sm"
                value={form.endpoint_url}
                onChange={(e) =>
                  setForm({ ...form, endpoint_url: e.target.value })
                }
                placeholder="https://<accountid>.r2.cloudflarestorage.com"
                autoComplete="off"
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-[--text-2]">
                {t('admin.settings.storage.bucket')}
              </span>
              <Input
                inputSize="sm"
                value={form.bucket_name}
                onChange={(e) =>
                  setForm({ ...form, bucket_name: e.target.value })
                }
                autoComplete="off"
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-[--text-2]">
                {t('admin.settings.storage.accessKey')}
              </span>
              <Input
                inputSize="sm"
                value={form.access_key_id}
                onChange={(e) =>
                  setForm({ ...form, access_key_id: e.target.value })
                }
                autoComplete="off"
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-[--text-2]">
                {t('admin.settings.storage.secretKey')}
              </span>
              {!form.secretEdited && form.hadExistingSecret ? (
                <div className="flex items-center gap-2">
                  <Input
                    inputSize="sm"
                    value="****"
                    disabled
                    className="flex-1"
                    readOnly
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      setForm({
                        ...form,
                        secret_access_key: '',
                        secretEdited: true,
                      })
                    }
                  >
                    {t('admin.settings.storage.change')}
                  </Button>
                </div>
              ) : (
                <Input
                  inputSize="sm"
                  type="password"
                  value={form.secret_access_key}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      secret_access_key: e.target.value,
                      secretEdited: true,
                    })
                  }
                  autoComplete="new-password"
                  placeholder="••••••••"
                />
              )}
            </label>
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-[--text-2]">
                {t('admin.settings.storage.region')}
              </span>
              <Input
                inputSize="sm"
                value={form.region}
                onChange={(e) => setForm({ ...form, region: e.target.value })}
                placeholder="auto"
                autoComplete="off"
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-[--text-2]">
                {t('admin.settings.storage.publicHostname')}
              </span>
              <Input
                inputSize="sm"
                value={form.public_hostname}
                onChange={(e) =>
                  setForm({ ...form, public_hostname: e.target.value })
                }
                placeholder="cdn.example.com"
                autoComplete="off"
              />
            </label>
            <label className="flex flex-col gap-1 text-sm sm:col-span-2">
              <span className="text-[--text-2]">
                {t('admin.settings.storage.prefix')}
              </span>
              <Input
                inputSize="sm"
                value={form.prefix}
                onChange={(e) => setForm({ ...form, prefix: e.target.value })}
                placeholder="yui-drop/uploads"
                autoComplete="off"
              />
              <span className="text-xs text-[--text-3]">
                {t('admin.settings.storage.prefixHint')}
              </span>
            </label>
          </div>
        )}

        <div className="mt-4 flex items-center justify-end">
          <Button type="submit" variant="primary" loading={save.isPending}>
            {t('admin.settings.storage.save')}
          </Button>
        </div>
      </Card>
    </form>
  );
}

// ─── Turnstile keys card (#6) ────────────────────────────────────────────
//
// Reads /admin/turnstile and exposes:
//   - enabled toggle (mirrors the toggle in the main form for visibility)
//   - site_key input
//   - secret_key input with the same readOnly + "Change" pattern as the
//     storage secret. Empty string on submit means "keep existing".

interface TurnstileFormState {
  enabled: boolean;
  site_key: string;
  secret_key: string;
  secretEdited: boolean;
  hadExistingSecret: boolean;
}

const EMPTY_TURNSTILE: TurnstileFormState = {
  enabled: false,
  site_key: '',
  secret_key: '',
  secretEdited: false,
  hadExistingSecret: false,
};

function TurnstileCard() {
  const { t } = useTranslation();
  const qc = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ['admin', 'turnstile'],
    queryFn: getAdminTurnstile,
  });

  const [form, setForm] = useState<TurnstileFormState>(EMPTY_TURNSTILE);

  useEffect(() => {
    if (!data) return;
    setForm({
      enabled: data.enabled,
      site_key: data.site_key ?? '',
      secret_key: data.secret_key_set ? '••••••••' : '',
      secretEdited: false,
      hadExistingSecret: data.secret_key_set,
    });
  }, [data]);

  const save = useMutation({
    mutationFn: () =>
      putAdminTurnstile({
        enabled: form.enabled,
        site_key: form.site_key,
        // Only send a new secret if the user explicitly opened the field.
        secret_key: form.secretEdited ? form.secret_key : '',
      }),
    onSuccess: (next: TurnstileConfigResponse) => {
      qc.setQueryData(['admin', 'turnstile'], next);
      toast.success(t('admin.settings.saved'));
      setForm({
        enabled: next.enabled,
        site_key: next.site_key ?? '',
        secret_key: next.secret_key_set ? '••••••••' : '',
        secretEdited: false,
        hadExistingSecret: next.secret_key_set,
      });
    },
    onError: (e: unknown) => {
      const msg = e instanceof ApiError ? e.message : (e as Error)?.message ?? '—';
      toast.error(msg);
    },
  });

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    save.mutate();
  }

  if (isLoading || !data) {
    return (
      <Card>
        <div className="flex items-center justify-center py-6">
          <Spinner />
        </div>
      </Card>
    );
  }

  return (
    <form onSubmit={onSubmit}>
      <Card>
        <div className="mb-3 text-xs uppercase tracking-wider text-[--text-2]">
          Turnstile
        </div>

        <label className="mb-4 flex items-center justify-between gap-3">
          <span className="text-sm text-[--text-1]">Enabled</span>
          <input
            type="checkbox"
            checked={form.enabled}
            onChange={(e) => setForm({ ...form, enabled: e.target.checked })}
          />
        </label>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-[--text-2]">Site key</span>
            <Input
              inputSize="sm"
              value={form.site_key}
              onChange={(e) => setForm({ ...form, site_key: e.target.value })}
              placeholder="0x4AAAAAAA…"
              autoComplete="off"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-[--text-2]">Secret key</span>
            {!form.secretEdited && form.hadExistingSecret ? (
              <div className="flex items-center gap-2">
                <Input
                  type="password"
                  inputSize="sm"
                  value="••••••••"
                  className="flex-1"
                  readOnly
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    setForm({
                      ...form,
                      secret_key: '',
                      secretEdited: true,
                    })
                  }
                >
                  Change
                </Button>
              </div>
            ) : form.secretEdited ? (
              <div className="flex items-center gap-2">
                <Input
                  type="password"
                  inputSize="sm"
                  value={form.secret_key}
                  onChange={(e) =>
                    setForm({ ...form, secret_key: e.target.value })
                  }
                  autoComplete="new-password"
                  placeholder="0x4AAAAAAA…"
                  className="flex-1"
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    setForm({
                      ...form,
                      secret_key: form.hadExistingSecret ? '••••••••' : '',
                      secretEdited: false,
                    })
                  }
                >
                  Cancel
                </Button>
              </div>
            ) : (
              <Input
                type="password"
                inputSize="sm"
                value={form.secret_key}
                onChange={(e) =>
                  setForm({
                    ...form,
                    secret_key: e.target.value,
                    secretEdited: true,
                  })
                }
                autoComplete="new-password"
                placeholder="0x4AAAAAAA…"
              />
            )}
          </label>
        </div>

        <div className="mt-4 flex items-center justify-end">
          <Button type="submit" variant="primary" loading={save.isPending}>
            {t('admin.settings.save')}
          </Button>
        </div>
      </Card>
    </form>
  );
}

// ─── Upload limits card (#7 / #8) ────────────────────────────────────────

interface UploadLimitsFormState {
  simple_upload_max_bytes: number;
  chunk_upload_max_bytes: number;
  multi_total_max_bytes: number;
  chunk_upload_enabled: boolean;
}

function bytesToReadable(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '0';
  if (n >= 1024 * 1024 * 1024) {
    return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  }
  if (n >= 1024 * 1024) {
    return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  }
  if (n >= 1024) {
    return `${(n / 1024).toFixed(1)} KB`;
  }
  return `${n} B`;
}

function UploadLimitsCard() {
  const { t } = useTranslation();
  const qc = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ['admin', 'uploads'],
    queryFn: getAdminUploads,
  });

  const [form, setForm] = useState<UploadLimitsFormState>({
    simple_upload_max_bytes: 0,
    chunk_upload_max_bytes: 0,
    multi_total_max_bytes: 0,
    chunk_upload_enabled: true,
  });

  useEffect(() => {
    if (!data) return;
    setForm({
      simple_upload_max_bytes: data.simple_upload_max_bytes,
      chunk_upload_max_bytes: data.chunk_upload_max_bytes,
      multi_total_max_bytes: data.multi_total_max_bytes,
      chunk_upload_enabled: data.chunk_upload_enabled,
    });
  }, [data]);

  const save = useMutation({
    mutationFn: () => putAdminUploads(form),
    onSuccess: (next: UploadLimitsResponse) => {
      qc.setQueryData(['admin', 'uploads'], next);
      toast.success(t('admin.settings.saved'));
    },
    onError: (e: unknown) => {
      const msg = e instanceof ApiError ? e.message : (e as Error)?.message ?? '—';
      toast.error(msg);
    },
  });

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    save.mutate();
  }

  if (isLoading || !data) {
    return (
      <Card>
        <div className="flex items-center justify-center py-6">
          <Spinner />
        </div>
      </Card>
    );
  }

  const numberRow = (
    label: string,
    key: keyof Omit<UploadLimitsFormState, 'chunk_upload_enabled'>,
  ) => (
    <label className="flex flex-col gap-1 text-sm">
      <span className="text-[--text-2]">{label}</span>
      <div className="flex items-center gap-2">
        <Input
          type="number"
          inputSize="sm"
          min={1}
          value={String(form[key])}
          onChange={(e) =>
            setForm({ ...form, [key]: Number(e.target.value) || 0 })
          }
          className="flex-1 max-w-[240px]"
        />
        <span className="text-xs text-[--text-3]">
          ≈ {bytesToReadable(form[key])}
        </span>
      </div>
    </label>
  );

  return (
    <form onSubmit={onSubmit}>
      <Card>
        <div className="mb-3 text-xs uppercase tracking-wider text-[--text-2]">
          Upload limits
        </div>

        <div className="grid grid-cols-1 gap-3">
          {numberRow('simple_upload_max_bytes', 'simple_upload_max_bytes')}
          {numberRow('chunk_upload_max_bytes', 'chunk_upload_max_bytes')}
          {numberRow('multi_total_max_bytes', 'multi_total_max_bytes')}
        </div>

        <label className="mt-4 flex items-start justify-between gap-3">
          <div className="flex-1">
            <div className="text-sm text-[--text-1]">
              Enable chunked upload (≥ 5MB files)
            </div>
            <div className="mt-1 text-xs text-[--text-muted]">
              When off, the server rejects chunked init and the browser
              refuses files at or above the simple upload limit.
            </div>
          </div>
          <input
            type="checkbox"
            className="mt-1"
            checked={form.chunk_upload_enabled}
            onChange={(e) =>
              setForm({ ...form, chunk_upload_enabled: e.target.checked })
            }
          />
        </label>

        <div className="mt-4 flex items-center justify-end">
          <Button type="submit" variant="primary" loading={save.isPending}>
            {t('admin.settings.save')}
          </Button>
        </div>
      </Card>
    </form>
  );
}
