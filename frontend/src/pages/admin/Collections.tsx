/**
 * Admin Collections — paginated list of Collection rooms (v0.3.0).
 *
 * Columns: code, name, created, expires, member_count, file_count,
 * message_count, visibility, status (active / closed / expired).
 *
 * Filter: status pill (active / closed / expired / all). Search by code.
 *
 * Per-row actions:
 *   - View   → opens `/c/{code}` in a new tab (the public room page).
 *   - Close  → admin override; soft-disbands the room. Confirms first.
 *   - Delete → hard delete; removes the row and all associated R2 objects.
 *              Irreversible; confirms first.
 *
 * Mirrors the react-query + table pattern used by `AdminFiles` / `AdminApiKeys`.
 */
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';

import {
  listCollections,
  closeCollection,
  deleteCollection,
  type AdminCollectionRow,
  type AdminCollectionStatus,
} from '@/lib/api/admin';
import { ApiError } from '@/lib/api';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import { Spinner } from '@/components/ui/Spinner';
import { toast } from '@/components/ui/Toast';
import { formatTime, isExpired } from '@/lib/format';
import { cn } from '@/lib/cn';

type StatusFilter = AdminCollectionStatus | 'all';

const STATUS_FILTERS: StatusFilter[] = ['active', 'closed', 'expired', 'all'];

function rowStatus(row: AdminCollectionRow): AdminCollectionStatus {
  if (row.closed_at) return 'closed';
  if (isExpired(row.expires_at)) return 'expired';
  return 'active';
}

function StatusBadge({ status }: { status: AdminCollectionStatus }) {
  const { t } = useTranslation();
  const styles: Record<AdminCollectionStatus, string> = {
    active: 'border-emerald-500/40 text-emerald-300 bg-emerald-500/5',
    closed: 'border-zinc-500/40 text-zinc-300 bg-zinc-500/5',
    expired: 'border-amber-500/40 text-amber-300 bg-amber-500/5',
  };
  return (
    <span
      className={
        'inline-block rounded-md border px-2 py-0.5 text-xs ' + styles[status]
      }
    >
      {t(`admin.collections.statuses.${status}`)}
    </span>
  );
}

export default function AdminCollections() {
  const { t } = useTranslation();
  const qc = useQueryClient();

  const [page, setPage] = useState(1);
  const [size] = useState(20);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('active');
  const [keyword, setKeyword] = useState('');
  const [keywordInput, setKeywordInput] = useState('');

  const [closeTarget, setCloseTarget] = useState<AdminCollectionRow | null>(
    null,
  );
  const [deleteTarget, setDeleteTarget] = useState<AdminCollectionRow | null>(
    null,
  );

  const { data, isLoading } = useQuery({
    queryKey: ['admin', 'collections', { page, size, keyword, statusFilter }],
    queryFn: () =>
      listCollections({
        page,
        size,
        keyword,
        status: statusFilter === 'all' ? undefined : statusFilter,
      }),
    placeholderData: (prev) => prev,
  });

  function invalidate() {
    void qc.invalidateQueries({ queryKey: ['admin', 'collections'] });
  }

  function handleError(e: unknown) {
    const msg = e instanceof ApiError ? e.message : (e as Error)?.message ?? '—';
    toast.error(msg);
  }

  const closeMut = useMutation({
    mutationFn: (id: number) => closeCollection(id),
    onSuccess: () => {
      invalidate();
      setCloseTarget(null);
      toast.success(t('admin.collections.toast.closed'));
    },
    onError: handleError,
  });

  const deleteMut = useMutation({
    mutationFn: (id: number) => deleteCollection(id),
    onSuccess: () => {
      invalidate();
      setDeleteTarget(null);
      toast.success(t('admin.collections.toast.deleted'));
    },
    onError: handleError,
  });

  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / size));

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-[--text-1]">
          {t('admin.collections.title')}
        </h1>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <form
          className="flex-1 min-w-[200px]"
          onSubmit={(e) => {
            e.preventDefault();
            setKeyword(keywordInput.trim());
            setPage(1);
          }}
        >
          <Input
            inputSize="sm"
            placeholder={t('admin.collections.search')}
            value={keywordInput}
            onChange={(e) => setKeywordInput(e.target.value)}
          />
        </form>
        <div className="flex flex-wrap items-center gap-1.5">
          {STATUS_FILTERS.map((s) => (
            <Button
              key={s}
              size="sm"
              variant={statusFilter === s ? 'primary' : 'outline'}
              onClick={() => {
                setStatusFilter(s);
                setPage(1);
              }}
            >
              {t(`admin.collections.filter.${s}`)}
            </Button>
          ))}
        </div>
      </div>

      <Card className="!p-0 overflow-hidden">
        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <Spinner />
          </div>
        ) : !data || data.items.length === 0 ? (
          <div className="py-12 text-center text-sm text-[--text-muted]">
            {t('admin.collections.empty')}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-[--bg-2] text-left text-xs text-[--text-2]">
                <tr>
                  <th className="px-3 py-2">
                    {t('admin.collections.columns.code')}
                  </th>
                  <th className="px-3 py-2">
                    {t('admin.collections.columns.name')}
                  </th>
                  <th className="px-3 py-2">
                    {t('admin.collections.columns.created')}
                  </th>
                  <th className="px-3 py-2">
                    {t('admin.collections.columns.expires')}
                  </th>
                  <th className="px-3 py-2">
                    {t('admin.collections.columns.members')}
                  </th>
                  <th className="px-3 py-2">
                    {t('admin.collections.columns.files')}
                  </th>
                  <th className="px-3 py-2">
                    {t('admin.collections.columns.messages')}
                  </th>
                  <th className="px-3 py-2">
                    {t('admin.collections.columns.visibility')}
                  </th>
                  <th className="px-3 py-2">
                    {t('admin.collections.columns.status')}
                  </th>
                  <th className="px-3 py-2">
                    {t('admin.collections.columns.actions')}
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[--border]">
                {data.items.map((row) => {
                  const status = rowStatus(row);
                  const dim = status !== 'active';
                  return (
                    <tr
                      key={row.id}
                      className={cn(
                        'hover:bg-[--bg-2]',
                        dim && 'opacity-60',
                      )}
                    >
                      <td className="px-3 py-2 font-mono">{row.code}</td>
                      <td
                        className="px-3 py-2 max-w-[240px] truncate"
                        title={row.name ?? ''}
                      >
                        {row.name ?? '—'}
                      </td>
                      <td className="px-3 py-2 text-xs text-[--text-2]">
                        {formatTime(row.created_at)}
                      </td>
                      <td className="px-3 py-2 text-xs text-[--text-2]">
                        {row.expires_at ? formatTime(row.expires_at) : '∞'}
                      </td>
                      <td className="px-3 py-2 text-xs text-[--text-2]">
                        {row.member_count}
                      </td>
                      <td className="px-3 py-2 text-xs text-[--text-2]">
                        {row.file_count}
                      </td>
                      <td className="px-3 py-2 text-xs text-[--text-2]">
                        {row.message_count}
                      </td>
                      <td className="px-3 py-2 text-xs text-[--text-2]">
                        {t(
                          `admin.collections.visibilities.${row.visibility}`,
                        )}
                      </td>
                      <td className="px-3 py-2">
                        <StatusBadge status={status} />
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() =>
                              window.open(
                                `/c/${encodeURIComponent(row.code)}`,
                                '_blank',
                                'noopener,noreferrer',
                              )
                            }
                          >
                            {t('admin.collections.action.view')}
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={status !== 'active'}
                            onClick={() => setCloseTarget(row)}
                          >
                            {t('admin.collections.action.close')}
                          </Button>
                          <Button
                            size="sm"
                            variant="danger"
                            onClick={() => setDeleteTarget(row)}
                          >
                            {t('admin.collections.action.delete')}
                          </Button>
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

      <div className="flex items-center justify-between text-xs text-[--text-2]">
        <span>
          {t('admin.collections.page', { page, total: totalPages })}
        </span>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            disabled={page <= 1}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
          >
            ‹
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={page >= totalPages}
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
          >
            ›
          </Button>
        </div>
      </div>

      {/* Close confirm */}
      <Modal
        open={closeTarget != null}
        onClose={() => setCloseTarget(null)}
        title={t('admin.collections.closeConfirm.title')}
        widthClassName="w-[90vw] max-w-md"
      >
        <div className="p-4 space-y-4">
          <p className="text-sm text-[--text-1]">
            {t('admin.collections.closeConfirm.bodyPrefix')}{' '}
            <span className="font-mono">{closeTarget?.code}</span>
            {t('admin.collections.closeConfirm.bodySuffix')}
          </p>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setCloseTarget(null)}>
              {t('admin.collections.closeConfirm.cancel')}
            </Button>
            <Button
              variant="primary"
              loading={closeMut.isPending}
              onClick={() => {
                if (closeTarget) closeMut.mutate(closeTarget.id);
              }}
            >
              {t('admin.collections.closeConfirm.confirm')}
            </Button>
          </div>
        </div>
      </Modal>

      {/* Delete confirm */}
      <Modal
        open={deleteTarget != null}
        onClose={() => setDeleteTarget(null)}
        title={t('admin.collections.deleteConfirm.title')}
        widthClassName="w-[90vw] max-w-md"
      >
        <div className="p-4 space-y-4">
          <p className="text-sm text-[--text-1]">
            {t('admin.collections.deleteConfirm.bodyPrefix')}{' '}
            <span className="font-mono">{deleteTarget?.code}</span>
            {t('admin.collections.deleteConfirm.bodySuffix')}
          </p>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setDeleteTarget(null)}>
              {t('admin.collections.deleteConfirm.cancel')}
            </Button>
            <Button
              variant="danger"
              loading={deleteMut.isPending}
              onClick={() => {
                if (deleteTarget) deleteMut.mutate(deleteTarget.id);
              }}
            >
              {t('admin.collections.deleteConfirm.confirm')}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
