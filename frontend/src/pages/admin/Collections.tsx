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
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { Spinner } from '@/components/ui/Spinner';
import { toast } from '@/components/ui/Toast';
import { Icon } from '@/v2/components/IconSprite';
import { isExpired } from '@/lib/format';

const ptitle: React.CSSProperties = { fontSize: 22, fontWeight: 700, letterSpacing: '-.01em', color: 'var(--tx)', marginBottom: 14 };
const pcard: React.CSSProperties = { border: '1px solid var(--ln)', borderRadius: 12, background: 'var(--pn)', overflow: 'hidden' };
const pth: React.CSSProperties = { textAlign: 'left', fontWeight: 500, fontSize: 11.5, color: 'var(--tx3)', padding: '9px 12px' };
const ptd: React.CSSProperties = { padding: '10px 12px' };
const pmeta: React.CSSProperties = { padding: '10px 12px', color: 'var(--tx3)', fontSize: 12 };
const ppage: React.CSSProperties = { width: 30, height: 30, border: '1px solid var(--ln)', borderRadius: 8, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', background: 'transparent', color: 'inherit' };
/** Pager button style with an explicit disabled affordance. */
function pageBtn(disabled: boolean): React.CSSProperties {
  return { ...ppage, cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.35 : 1 };
}
function pact(color: string, disabled = false): React.CSSProperties {
  return { fontSize: 12, color, border: '1px solid var(--ln)', borderRadius: 6, padding: '3px 8px', marginLeft: 8, background: 'transparent', fontFamily: 'inherit', cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.4 : 1 };
}

type StatusFilter = AdminCollectionStatus | 'all';

const STATUS_FILTERS: StatusFilter[] = ['active', 'closed', 'expired', 'all'];

function rowStatus(row: AdminCollectionRow): AdminCollectionStatus {
  if (row.closed_at) return 'closed';
  if (isExpired(row.expires_at)) return 'expired';
  return 'active';
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
    <div>
      <h1 style={ptitle}>收集箱</h1>

      <div data-r="filterrow" style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 12 }}>
        <form
          style={{ flex: 1, minWidth: 200, display: 'flex', alignItems: 'center', gap: 8, height: 36, padding: '0 10px', border: '1px solid var(--ln2)', borderRadius: 9, background: 'var(--p2)' }}
          onSubmit={(e) => { e.preventDefault(); setKeyword(keywordInput.trim()); setPage(1); }}
        >
          <Icon name="i-search" size={15} style={{ color: 'var(--tx3)' }} />
          <input
            placeholder="搜索收集箱编号"
            value={keywordInput}
            onChange={(e) => setKeywordInput(e.target.value)}
            style={{ flex: 1, minWidth: 0, border: 'none', background: 'transparent', color: 'var(--tx1)', fontFamily: 'inherit', fontSize: 13, outline: 'none' }}
          />
        </form>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {STATUS_FILTERS.map((s) => {
            const on = statusFilter === s;
            return (
              <button key={s} type="button" data-yd="quiet"
                onClick={() => { setStatusFilter(s); setPage(1); }}
                style={{ height: 34, padding: '0 12px', borderRadius: 9, fontSize: 13, cursor: 'pointer', fontFamily: 'inherit',
                  border: `1px solid ${on ? 'var(--ac)' : 'var(--ln2)'}`, background: on ? 'var(--acs)' : 'transparent',
                  color: on ? 'var(--act)' : 'var(--tx2)', fontWeight: on ? 600 : 500 }}>
                {t(`admin.collections.filter.${s}`)}
              </button>
            );
          })}
        </div>
      </div>

      <div data-r="tablewrap" style={pcard}>
        {isLoading ? (
          <div style={{ display: 'flex', justifyContent: 'center', padding: '48px 0' }}><Spinner /></div>
        ) : !data || data.items.length === 0 ? (
          <div style={{ padding: '48px 0', textAlign: 'center', fontSize: 13, color: 'var(--tx3)' }}>{t('admin.collections.empty')}</div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, minWidth: 680 }}>
            <thead>
              <tr style={{ background: 'var(--p1)' }}>
                {['编号', '名称', '成员', '文件', '留言', '可见性', '状态'].map((h) => <th key={h} style={pth}>{h}</th>)}
                <th style={{ ...pth, textAlign: 'right' }}>操作</th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((row) => {
                const status = rowStatus(row);
                const tone = status === 'active' ? 'var(--ok)' : status === 'closed' ? 'var(--tx3)' : 'var(--warn)';
                return (
                  <tr key={row.id} data-yd="row" style={{ borderTop: '1px solid var(--ln)', opacity: status === 'active' ? 1 : 0.6 }}>
                    <td style={{ ...ptd, fontFamily: "'JetBrains Mono',monospace", color: 'var(--act)' }}>{row.code}</td>
                    <td style={{ ...ptd, color: 'var(--tx1)', maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={row.name ?? ''}>{row.name ?? '—'}</td>
                    <td style={pmeta}>{row.member_count}</td>
                    <td style={pmeta}>{row.file_count}</td>
                    <td style={pmeta}>{row.message_count}</td>
                    <td style={pmeta}>{t(`admin.collections.visibilities.${row.visibility}`)}</td>
                    <td style={ptd}><span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 5, background: `color-mix(in srgb, ${tone} 14%, transparent)`, color: tone }}>{t(`admin.collections.statuses.${status}`)}</span></td>
                    <td style={{ ...ptd, textAlign: 'right', whiteSpace: 'nowrap' }}>
                      <button type="button" onClick={() => window.open(`/c/${encodeURIComponent(row.code)}`, '_blank', 'noopener,noreferrer')} style={pact('var(--tx2)')}>查看</button>
                      <button type="button" disabled={status !== 'active'} onClick={() => setCloseTarget(row)} style={pact('var(--tx2)', status !== 'active')}>关闭</button>
                      <button type="button" onClick={() => setDeleteTarget(row)} style={pact('var(--bad)')}>删除</button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 12, fontSize: 12, color: 'var(--tx3)' }}>
        <span>第 {page} / {totalPages} 页 · 共 {total} 条</span>
        <span style={{ display: 'flex', gap: 6 }}>
          <button type="button" data-yd="quiet" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))} style={pageBtn(page <= 1)}>
            <Icon name="i-chev" size={14} style={{ transform: 'rotate(180deg)' }} />
          </button>
          <button type="button" data-yd="quiet" disabled={page >= totalPages} onClick={() => setPage((p) => Math.min(totalPages, p + 1))} style={pageBtn(page >= totalPages)}>
            <Icon name="i-chev" size={14} />
          </button>
        </span>
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
