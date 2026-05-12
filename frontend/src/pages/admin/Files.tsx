/**
 * Admin Files — paginated table with search, include-deleted toggle,
 * empty-recycle-bin action, and per-row edit / soft-delete / restore /
 * hard-delete.
 */
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  listFiles,
  patchFile,
  deleteFile,
  restoreFile,
  emptyRecycleBin,
  type AdminFileRow,
} from '@/lib/api/admin';
import { ApiError } from '@/lib/api';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Spinner } from '@/components/ui/Spinner';
import { toast } from '@/components/ui/Toast';
import { humanBytes, formatTime, isExpired } from '@/lib/format';
import { cn } from '@/lib/cn';

export default function AdminFiles() {
  const { t } = useTranslation();
  const qc = useQueryClient();

  const [page, setPage] = useState(1);
  const [size] = useState(20);
  const [keyword, setKeyword] = useState('');
  const [keywordInput, setKeywordInput] = useState('');
  const [includeDeleted, setIncludeDeleted] = useState(false);
  const [editing, setEditing] = useState<AdminFileRow | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['admin', 'files', { page, size, keyword, includeDeleted }],
    queryFn: () =>
      listFiles({ page, size, keyword, include_deleted: includeDeleted }),
    placeholderData: (prev) => prev,
  });

  function invalidate() {
    void qc.invalidateQueries({ queryKey: ['admin', 'files'] });
  }

  function handleError(e: unknown) {
    const msg = e instanceof ApiError ? e.message : (e as Error)?.message ?? '—';
    toast.error(msg);
  }

  const softDel = useMutation({
    mutationFn: (id: number) => deleteFile(id, false),
    onSuccess: () => {
      invalidate();
      toast.success('Deleted');
    },
    onError: handleError,
  });

  const hardDel = useMutation({
    mutationFn: (id: number) => deleteFile(id, true),
    onSuccess: () => {
      invalidate();
      toast.success('Deleted');
    },
    onError: handleError,
  });

  const restore = useMutation({
    mutationFn: (id: number) => restoreFile(id),
    onSuccess: () => {
      invalidate();
      toast.success('Restored');
    },
    onError: handleError,
  });

  const emptyTrash = useMutation({
    mutationFn: () => emptyRecycleBin(),
    onSuccess: (r) => {
      invalidate();
      toast.success(`Deleted ${r.deleted}`);
    },
    onError: handleError,
  });

  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / size));

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-[--text-1]">
          {t('admin.files.title')}
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
            placeholder={t('admin.files.search')}
            value={keywordInput}
            onChange={(e) => setKeywordInput(e.target.value)}
          />
        </form>
        <label className="flex items-center gap-2 text-sm text-[--text-2]">
          <input
            type="checkbox"
            checked={includeDeleted}
            onChange={(e) => {
              setIncludeDeleted(e.target.checked);
              setPage(1);
            }}
          />
          {t('admin.files.includeDeleted')}
        </label>
        {includeDeleted && (
          <Button
            variant="danger"
            size="sm"
            loading={emptyTrash.isPending}
            onClick={() => {
              if (window.confirm(t('admin.files.emptyTrashConfirm'))) {
                emptyTrash.mutate();
              }
            }}
          >
            {t('admin.files.emptyTrash')}
          </Button>
        )}
      </div>

      <Card className="!p-0 overflow-hidden">
        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <Spinner />
          </div>
        ) : !data || data.items.length === 0 ? (
          <div className="py-12 text-center text-sm text-[--text-muted]">
            {t('admin.files.empty')}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-[--bg-2] text-left text-xs text-[--text-2]">
                <tr>
                  <th className="px-3 py-2">{t('admin.files.columns.code')}</th>
                  <th className="px-3 py-2">{t('admin.files.columns.name')}</th>
                  <th className="px-3 py-2">{t('admin.files.columns.size')}</th>
                  <th className="px-3 py-2">{t('admin.files.columns.created')}</th>
                  <th className="px-3 py-2">{t('admin.files.columns.expires')}</th>
                  <th className="px-3 py-2">{t('admin.files.columns.used')}</th>
                  <th className="px-3 py-2">{t('admin.files.columns.status')}</th>
                  <th className="px-3 py-2">{t('admin.files.columns.actions')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[--border]">
                {data.items.map((row) => {
                  const deleted = !!row.deleted_at;
                  const expired = !deleted && isExpired(row.expired_at);
                  const status = deleted
                    ? t('admin.files.statusDeleted')
                    : expired
                    ? t('admin.files.statusExpired')
                    : t('admin.files.statusActive');
                  return (
                    <tr
                      key={row.id}
                      className={cn(
                        'hover:bg-[--bg-2]',
                        (deleted || expired) && 'opacity-60',
                      )}
                    >
                      <td className="px-3 py-2 font-mono">{row.code}</td>
                      <td className="px-3 py-2 max-w-[240px] truncate" title={row.name ?? ''}>
                        {row.is_text ? '[text]' : row.name ?? '—'}
                      </td>
                      <td className="px-3 py-2 text-xs text-[--text-2]">
                        {humanBytes(row.size)}
                      </td>
                      <td className="px-3 py-2 text-xs text-[--text-2]">
                        {formatTime(row.created_at)}
                      </td>
                      <td className="px-3 py-2 text-xs text-[--text-2]">
                        {row.expired_at ? formatTime(row.expired_at) : '∞'}
                      </td>
                      <td className="px-3 py-2 text-xs text-[--text-2]">
                        {row.used_count}
                        {row.expired_count > 0 ? ` / ${row.expired_count}` : ''}
                      </td>
                      <td className="px-3 py-2 text-xs text-[--text-2]">
                        {status}
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => setEditing(row)}
                          >
                            {t('admin.files.action.edit')}
                          </Button>
                          {deleted ? (
                            <>
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => restore.mutate(row.id)}
                              >
                                {t('admin.files.action.restore')}
                              </Button>
                              <Button
                                size="sm"
                                variant="danger"
                                onClick={() => hardDel.mutate(row.id)}
                              >
                                {t('admin.files.action.hardDelete')}
                              </Button>
                            </>
                          ) : (
                            <Button
                              size="sm"
                              variant="danger"
                              onClick={() => softDel.mutate(row.id)}
                            >
                              {t('admin.files.action.softDelete')}
                            </Button>
                          )}
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
        <span>{t('admin.files.page', { page, total: totalPages })}</span>
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

      {editing && (
        <EditExpiryModal
          row={editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            invalidate();
          }}
        />
      )}
    </div>
  );
}

// ─── Edit-expiry modal ──────────────────────────────────────────────────
function EditExpiryModal({
  row,
  onClose,
  onSaved,
}: {
  row: AdminFileRow;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t } = useTranslation();
  const [expiredAt, setExpiredAt] = useState(row.expired_at ?? '');
  const [expiredCount, setExpiredCount] = useState(String(row.expired_count));
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    try {
      await patchFile(row.id, {
        expired_at: expiredAt || null,
        expired_count: Number(expiredCount),
      });
      toast.success('Saved');
      onSaved();
    } catch (e) {
      toast.error((e as Error)?.message ?? '—');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-40 flex items-center justify-center bg-black/50 p-4"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-sm rounded-lg border border-[--border] bg-[--bg-1] p-5 shadow-xl"
      >
        <h2 className="mb-3 text-base font-semibold text-[--text-1]">
          {t('admin.files.editExpiry')}
        </h2>
        <div className="flex flex-col gap-3">
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-[--text-2]">{t('admin.files.expiredAt')}</span>
            <Input
              inputSize="sm"
              value={expiredAt}
              onChange={(e) => setExpiredAt(e.target.value)}
              placeholder="2026-12-31T23:59:00Z"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-[--text-2]">{t('admin.files.expiredCount')}</span>
            <Input
              inputSize="sm"
              type="number"
              value={expiredCount}
              onChange={(e) => setExpiredCount(e.target.value)}
            />
          </label>
        </div>
        <div className="mt-4 flex items-center justify-end gap-2">
          <Button size="sm" variant="ghost" onClick={onClose} disabled={saving}>
            {t('admin.files.cancel')}
          </Button>
          <Button
            size="sm"
            variant="primary"
            loading={saving}
            onClick={() => void save()}
          >
            {t('admin.files.save')}
          </Button>
        </div>
      </div>
    </div>
  );
}
