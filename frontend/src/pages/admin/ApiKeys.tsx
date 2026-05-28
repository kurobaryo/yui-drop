/**
 * AdminApiKeys — list + manage API keys.
 *
 * Columns: key_id, note, scopes, quota summary, status badge, actions.
 *
 * Action icons:
 *   - Edit (Pencil)    → ApiKeyEditModal
 *   - Usage (BarChart3) → ApiKeyUsageModal
 *   - Revoke (Trash2)  → inline confirm modal → DELETE /admin/api-keys/{pk}
 *
 * Status:
 *   - "Active"  (green)  — is_active && !revoked && not expired
 *   - "Revoked" (red)    — revoked_at set
 *   - "Expired" (orange) — expires_at in the past (and not revoked)
 */
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Pencil, BarChart3, Trash2, Plus, KeyRound } from 'lucide-react';

import {
  listApiKeys,
  revokeApiKey,
  type ApiKeyListItem,
} from '@/lib/api/adminApiKeys';
import { ApiError } from '@/lib/api';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { Spinner } from '@/components/ui/Spinner';
import { toast } from '@/components/ui/Toast';
import { humanBytes, isExpired } from '@/lib/format';

import ApiKeyIssueModal from './ApiKeyIssueModal';
import ApiKeyEditModal from './ApiKeyEditModal';
import ApiKeyUsageModal from './ApiKeyUsageModal';

type Status = 'active' | 'revoked' | 'expired';

function statusOf(row: ApiKeyListItem): Status {
  if (row.revoked_at) return 'revoked';
  if (isExpired(row.expires_at)) return 'expired';
  return 'active';
}

function StatusBadge({ status }: { status: Status }) {
  const { t } = useTranslation();
  const styles: Record<Status, string> = {
    active: 'border-emerald-500/40 text-emerald-300 bg-emerald-500/5',
    revoked: 'border-red-500/40 text-red-300 bg-red-500/5',
    expired: 'border-amber-500/40 text-amber-300 bg-amber-500/5',
  };
  const label = t(`admin.apiKeys.statuses.${status}`);
  return (
    <span
      className={
        'inline-block rounded-md border px-2 py-0.5 text-xs ' + styles[status]
      }
    >
      {label}
    </span>
  );
}

export default function AdminApiKeys() {
  const { t } = useTranslation();
  const qc = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ['admin', 'api-keys'],
    queryFn: listApiKeys,
  });

  const [issueOpen, setIssueOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<ApiKeyListItem | null>(null);
  const [usageTarget, setUsageTarget] = useState<number | null>(null);
  const [revokeTarget, setRevokeTarget] = useState<ApiKeyListItem | null>(null);

  const revokeMut = useMutation({
    mutationFn: (pk: number) => revokeApiKey(pk),
    onSuccess: () => {
      toast.success(t('admin.apiKeys.revoked'));
      qc.invalidateQueries({ queryKey: ['admin', 'api-keys'] });
      setRevokeTarget(null);
    },
    onError: (e) =>
      toast.error(e instanceof ApiError ? e.message : String(e)),
  });

  const items = data?.items ?? [];

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <h1 className="text-xl font-semibold text-[--text-1] flex items-center gap-2">
          <KeyRound className="h-5 w-5" />
          {t('admin.apiKeys.title')}
        </h1>
        <Button
          variant="primary"
          leftIcon={<Plus className="h-4 w-4" />}
          onClick={() => setIssueOpen(true)}
        >
          {t('admin.apiKeys.issueNew')}
        </Button>
      </div>

      <Card>
        {isLoading ? (
          <div className="flex justify-center py-8">
            <Spinner />
          </div>
        ) : items.length === 0 ? (
          <div className="py-12 text-center text-sm text-[--text-2]">
            {t('admin.apiKeys.empty')}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-xs uppercase tracking-wider text-[--text-2]">
                <tr className="border-b border-[--border]">
                  <th className="py-2 px-2 text-left font-medium">{t('admin.apiKeys.table.keyId')}</th>
                  <th className="py-2 px-2 text-left font-medium">{t('admin.apiKeys.table.note')}</th>
                  <th className="py-2 px-2 text-left font-medium">{t('admin.apiKeys.table.scopes')}</th>
                  <th className="py-2 px-2 text-left font-medium">{t('admin.apiKeys.table.quota')}</th>
                  <th className="py-2 px-2 text-left font-medium">{t('admin.apiKeys.table.status')}</th>
                  <th className="py-2 px-2 text-right font-medium">{t('admin.apiKeys.table.actions')}</th>
                </tr>
              </thead>
              <tbody>
                {items.map((row) => {
                  const status = statusOf(row);
                  return (
                    <tr
                      key={row.id}
                      className="border-b border-[--border] last:border-b-0 align-top"
                    >
                      <td className="py-2 px-2 font-mono text-[--text-1]">
                        {row.key_id}
                      </td>
                      <td className="py-2 px-2 text-[--text-1] max-w-[16ch] truncate">
                        {row.note || <span className="text-[--text-2]">—</span>}
                      </td>
                      <td className="py-2 px-2 text-[--text-2]">
                        {row.scopes
                          .map((s) => s[0].toUpperCase())
                          .join(' ')}
                      </td>
                      <td className="py-2 px-2 text-[--text-2] whitespace-nowrap">
                        {humanBytes(row.quota_daily_bytes)}/{t('admin.apiKeys.dayUnit')} ·{' '}
                        {humanBytes(row.max_file_size)}/{t('admin.apiKeys.fileUnit')} ·{' '}
                        {row.quota_per_minute}/{t('admin.apiKeys.minUnit')}
                      </td>
                      <td className="py-2 px-2">
                        <StatusBadge status={status} />
                      </td>
                      <td className="py-2 px-2 text-right">
                        <div className="inline-flex items-center gap-1">
                          <button
                            type="button"
                            aria-label={t('admin.apiKeys.actions.edit')}
                            title={t('admin.apiKeys.actions.edit')}
                            onClick={() => setEditTarget(row)}
                            disabled={status === 'revoked'}
                            className="inline-flex h-8 w-8 items-center justify-center rounded-md text-[--text-2] hover:text-[--text-1] hover:bg-[--bg-2] disabled:opacity-40 disabled:cursor-not-allowed"
                          >
                            <Pencil className="h-4 w-4" />
                          </button>
                          <button
                            type="button"
                            aria-label={t('admin.apiKeys.actions.usage')}
                            title={t('admin.apiKeys.actions.usage')}
                            onClick={() => setUsageTarget(row.id)}
                            className="inline-flex h-8 w-8 items-center justify-center rounded-md text-[--text-2] hover:text-[--text-1] hover:bg-[--bg-2]"
                          >
                            <BarChart3 className="h-4 w-4" />
                          </button>
                          <button
                            type="button"
                            aria-label={t('admin.apiKeys.actions.revoke')}
                            title={t('admin.apiKeys.actions.revoke')}
                            onClick={() => setRevokeTarget(row)}
                            disabled={status === 'revoked'}
                            className="inline-flex h-8 w-8 items-center justify-center rounded-md text-red-300 hover:text-red-200 hover:bg-red-500/10 disabled:opacity-40 disabled:cursor-not-allowed"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* Modals */}
      <ApiKeyIssueModal
        open={issueOpen}
        onClose={() => setIssueOpen(false)}
      />
      <ApiKeyEditModal
        open={editTarget != null}
        onClose={() => setEditTarget(null)}
        initial={editTarget}
      />
      <ApiKeyUsageModal
        open={usageTarget != null}
        onClose={() => setUsageTarget(null)}
        keyPk={usageTarget}
      />

      {/* Revoke confirm */}
      <Modal
        open={revokeTarget != null}
        onClose={() => setRevokeTarget(null)}
        title={t('admin.apiKeys.revokeConfirm.title')}
        widthClassName="w-[90vw] max-w-md"
      >
        <div className="p-4 space-y-4">
          <p className="text-sm text-[--text-1]">
            {t('admin.apiKeys.revokeConfirm.bodyPrefix')}{' '}
            <span className="font-mono">{revokeTarget?.key_id}</span>
            {t('admin.apiKeys.revokeConfirm.bodySuffix')}
          </p>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setRevokeTarget(null)}>
              {t('admin.apiKeys.revokeConfirm.cancel')}
            </Button>
            <Button
              variant="danger"
              loading={revokeMut.isPending}
              onClick={() => {
                if (revokeTarget) revokeMut.mutate(revokeTarget.id);
              }}
            >
              {t('admin.apiKeys.revokeConfirm.confirm')}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
