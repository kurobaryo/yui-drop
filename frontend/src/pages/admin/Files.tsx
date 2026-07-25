/**
 * Admin Files — paginated table with search, include-deleted toggle,
 * empty-recycle-bin action, and per-row edit / soft-delete / restore /
 * hard-delete.
 *
 * Clicking the code cell (or anywhere on the row that isn't an action
 * button) opens a right-side drawer showing the full FileCode metadata
 * plus the share's access log. See `FileDetailModal` below.
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
  getFileByCode,
  getFileAccessLog,
  getFileContent,
  downloadFileAsAdmin,
  type AdminFileRow,
  type AdminFileAccessLogItem,
} from '@/lib/api/admin';
import { ApiError } from '@/lib/api';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/v2/components/IconSprite';
import { Input } from '@/components/ui/Input';
import { Spinner } from '@/components/ui/Spinner';
import { Modal } from '@/components/ui/Modal';
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
  const [activeCode, setActiveCode] = useState<string | null>(null);

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
    <div>
      <h1 style={ptitle}>文件</h1>

      <div data-r="filterrow" style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 12 }}>
        <form
          style={{ flex: 1, minWidth: 200, display: 'flex', alignItems: 'center', gap: 8, height: 36, padding: '0 10px', border: '1px solid var(--ln2)', borderRadius: 9, background: 'var(--p2)' }}
          onSubmit={(e) => { e.preventDefault(); setKeyword(keywordInput.trim()); setPage(1); }}
        >
          <Icon name="i-search" size={15} style={{ color: 'var(--tx3)' }} />
          <input
            placeholder="搜索取件码或文件名"
            value={keywordInput}
            onChange={(e) => setKeywordInput(e.target.value)}
            style={{ flex: 1, minWidth: 0, border: 'none', background: 'transparent', color: 'var(--tx1)', fontFamily: 'inherit', fontSize: 13, outline: 'none' }}
          />
        </form>
        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 7, fontSize: 13, color: 'var(--tx2)', cursor: 'pointer', height: 36, flexShrink: 0 }}>
          <input type="checkbox" checked={includeDeleted} onChange={(e) => { setIncludeDeleted(e.target.checked); setPage(1); }} style={{ accentColor: 'var(--ac)', width: 15, height: 15, cursor: 'pointer' }} />
          含已删除
        </label>
        {includeDeleted && (
          <button type="button" data-yd="quiet" disabled={emptyTrash.isPending}
            onClick={() => { if (window.confirm(t('admin.files.emptyTrashConfirm'))) emptyTrash.mutate(); }}
            style={{ height: 36, padding: '0 12px', border: '1px solid var(--ln2)', borderRadius: 9, background: 'transparent', color: 'var(--bad)', fontFamily: 'inherit', fontSize: 13, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap' }}>
            <Icon name="i-trash" size={14} />清空回收站
          </button>
        )}
      </div>

      <div data-r="tablewrap" style={pcard}>
        {isLoading ? (
          <div style={{ display: 'flex', justifyContent: 'center', padding: '48px 0' }}><Spinner /></div>
        ) : !data || data.items.length === 0 ? (
          <div style={{ padding: '48px 0', textAlign: 'center', fontSize: 13, color: 'var(--tx3)' }}>{t('admin.files.empty')}</div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, minWidth: 760 }}>
            <thead>
              <tr style={{ background: 'var(--p1)' }}>
                {['取件码', '名称', '大小', '创建', '过期', '取件', '状态'].map((h) => <th key={h} style={pth}>{h}</th>)}
                <th style={{ ...pth, textAlign: 'right' }}>操作</th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((row) => {
                const deleted = !!row.deleted_at;
                const expired = !deleted && isExpired(row.expired_at);
                const status = deleted ? t('admin.files.statusDeleted') : expired ? t('admin.files.statusExpired') : t('admin.files.statusActive');
                const tone = deleted ? 'var(--bad)' : expired ? 'var(--warn)' : 'var(--ok)';
                return (
                  <tr key={row.id} data-yd="row" onClick={() => setActiveCode(row.code)}
                    style={{ cursor: 'pointer', borderTop: '1px solid var(--ln)', opacity: deleted || expired ? 0.6 : 1 }}>
                    <td style={{ ...ptd, fontFamily: "'JetBrains Mono',monospace", color: 'var(--act)' }}>{row.code}</td>
                    <td style={{ ...ptd, color: 'var(--tx1)', maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={row.name ?? ''}>{row.is_text ? '[文字]' : row.name ?? '—'}</td>
                    <td style={pmeta}>{humanBytes(row.size)}</td>
                    <td style={pmeta}>{formatTime(row.created_at)}</td>
                    <td style={pmeta}>{row.expired_at ? formatTime(row.expired_at) : '∞'}</td>
                    <td style={pmeta}>{row.used_count}{row.expired_count > 0 ? ` / ${row.expired_count}` : ''}</td>
                    <td style={ptd}><span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 5, background: `color-mix(in srgb, ${tone} 14%, transparent)`, color: tone }}>{status}</span></td>
                    <td style={{ ...ptd, textAlign: 'right', whiteSpace: 'nowrap' }} onClick={(e) => e.stopPropagation()}>
                      <button type="button" onClick={() => setEditing(row)} style={pact('var(--tx2)')}>改期</button>
                      {deleted ? (
                        <>
                          <button type="button" onClick={() => restore.mutate(row.id)} style={pact('var(--tx2)')}>恢复</button>
                          <button type="button" onClick={() => hardDel.mutate(row.id)} style={pact('var(--bad)')}>彻底删除</button>
                        </>
                      ) : (
                        <button type="button" onClick={() => softDel.mutate(row.id)} style={pact('var(--bad)')}>删除</button>
                      )}
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

      {editing && (
        <EditExpiryModal
          row={editing}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); invalidate(); }}
        />
      )}

      <FileDetailModal code={activeCode} onClose={() => setActiveCode(null)} />
    </div>
  );
}

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
function pact(color: string): React.CSSProperties {
  return { fontSize: 12, color, border: '1px solid var(--ln)', borderRadius: 6, padding: '3px 8px', marginLeft: 8, background: 'transparent', fontFamily: 'inherit', cursor: 'pointer' };
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

// ─── File detail drawer (G.4) ───────────────────────────────────────────
function FileDetailModal({
  code,
  onClose,
}: {
  code: string | null;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const open = code !== null;

  // Two parallel queries — render both halves of the drawer independently
  // so a slow access-log query doesn't gate the metadata panel.
  const detail = useQuery({
    queryKey: ['admin', 'file-detail', code],
    queryFn: () => getFileByCode(code!),
    enabled: open,
  });
  const logs = useQuery({
    queryKey: ['admin', 'file-access-log', code],
    queryFn: () => getFileAccessLog(code!, 200),
    enabled: open,
  });
  // Text content is admin-only and only fetched for text shares. The
  // endpoint emits an `admin_action` audit row, never a `share_retrieve`,
  // so previewing in the admin UI does not pollute the visitor audit
  // trail. Binary shares fall back to the explicit Download button.
  const content = useQuery({
    queryKey: ['admin', 'file-content', code],
    queryFn: () => getFileContent(code!),
    enabled: open && !!detail.data?.is_text,
  });

  const row = detail.data;
  const deleted = !!row?.deleted_at;
  const expired = !deleted && isExpired(row?.expired_at);
  const status = deleted
    ? t('admin.files.statusDeleted')
    : expired
    ? t('admin.files.statusExpired')
    : t('admin.files.statusActive');

  // Aggregate download stats from the access log.
  const fetchEvents = (logs.data?.items ?? []).filter(
    (it) => it.action === 'share_retrieve',
  );

  return (
    <Modal
      open={open}
      onClose={onClose}
      ariaLabel={t('admin.files.drawer.title')}
      title={
        <div className="flex items-baseline gap-3">
          <span className="font-mono text-lg text-[--text-1]">
            {code ?? ''}
          </span>
          <span className="text-xs text-[--text-2]">
            {t('admin.files.drawer.title')}
          </span>
        </div>
      }
    >
      {detail.isLoading || !row ? (
        <div className="flex items-center justify-center py-16">
          <Spinner />
        </div>
      ) : (
        <div className="flex flex-col gap-5 p-4">
          {/* Download-count callout: surface the headline number above the
              metadata grid so it's the first thing the admin notices. */}
          <DownloadCountCallout
            used={row.used_count}
            limit={row.expired_count}
            distinctIps={
              new Set(
                fetchEvents.map((e) => e.ip).filter((ip): ip is string => !!ip),
              ).size
            }
          />

          {/* Metadata block ------------------------------------------- */}
          <div className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-xs">
            <MetaRow label={t('admin.files.drawer.meta.code')}>
              <span className="font-mono">{row.code}</span>
            </MetaRow>
            <MetaRow label={t('admin.files.drawer.meta.name')}>
              {row.is_text ? '[text]' : row.name ?? '—'}
            </MetaRow>
            <MetaRow label={t('admin.files.drawer.meta.size')}>
              {humanBytes(row.size)}
            </MetaRow>
            <MetaRow label={t('admin.files.drawer.meta.kind')}>
              {row.is_text ? 'text' : row.is_chunked ? 'chunked' : 'single'}
            </MetaRow>
            <MetaRow label={t('admin.files.drawer.meta.created')}>
              {formatTime(row.created_at)}
            </MetaRow>
            <MetaRow label={t('admin.files.drawer.meta.expires')}>
              {row.expired_at ? formatTime(row.expired_at) : '∞'}
            </MetaRow>
            <MetaRow label={t('admin.files.drawer.meta.usage')}>
              {row.used_count}
              {row.expired_count > 0 ? ` / ${row.expired_count}` : ' / ∞'}
            </MetaRow>
            <MetaRow label={t('admin.files.drawer.meta.status')}>
              {status}
            </MetaRow>
            <MetaRow label={t('admin.files.drawer.meta.storage')}>
              {row.storage_backend ?? '—'}
            </MetaRow>
            <MetaRow label={t('admin.files.drawer.meta.filePath')}>
              <span className="font-mono break-all">{row.file_path ?? '—'}</span>
            </MetaRow>
            <MetaRow label={t('admin.files.drawer.meta.createdByIp')}>
              <span className="font-mono">{row.created_by_ip ?? '—'}</span>
            </MetaRow>
            <MetaRow label={t('admin.files.drawer.meta.createdByUa')}>
              <span className="break-all">{row.created_by_ua ?? '—'}</span>
            </MetaRow>
          </div>

          {/* Content preview / download ------------------------------- */}
          <section>
            <h3 className="mb-2 text-xs uppercase tracking-wider text-[--text-2]">
              {row.is_text
                ? t('admin.files.drawer.contentPreview')
                : t('admin.files.drawer.binaryPayload')}
            </h3>
            {row.is_text ? (
              <TextPreview
                loading={content.isLoading}
                text={content.data?.text}
              />
            ) : (
              <BinaryDownload
                code={row.code}
                fallbackName={row.name ?? row.code}
              />
            )}
          </section>

          {/* Access log table ----------------------------------------- */}
          <section>
            <h3 className="mb-2 text-xs uppercase tracking-wider text-[--text-2]">
              {t('admin.files.drawer.accessLog')}
            </h3>
            {logs.isLoading ? (
              <div className="flex items-center justify-center py-6">
                <Spinner />
              </div>
            ) : !logs.data || logs.data.items.length === 0 ? (
              <div className="py-6 text-center text-xs text-[--text-muted]">
                {t('admin.files.drawer.noLog')}
              </div>
            ) : (
              <div className="max-h-[50vh] overflow-y-auto rounded-md border border-[--border]">
                <table className="w-full text-xs">
                  <thead className="sticky top-0 bg-[--bg-2] text-left text-[--text-2]">
                    <tr>
                      <th className="px-2 py-1.5">
                        {t('admin.files.drawer.col.ts')}
                      </th>
                      <th className="px-2 py-1.5">
                        {t('admin.files.drawer.col.action')}
                      </th>
                      <th className="px-2 py-1.5">
                        {t('admin.files.drawer.col.ip')}
                      </th>
                      <th className="px-2 py-1.5">
                        {t('admin.files.drawer.col.ua')}
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[--border]">
                    {logs.data.items.map((item, i) => (
                      <AccessLogRow key={i} item={item} />
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </div>
      )}
    </Modal>
  );
}

function MetaRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <>
      <div className="whitespace-nowrap text-[--text-2]">{label}</div>
      <div className="min-w-0 text-[--text-1]">{children}</div>
    </>
  );
}

/**
 * Headline counter shown at the top of the drawer. The maintainer asked
 * for "download count" to be prominent — this badge plus the per-row
 * highlighting in the access-log table cover both halves of the request.
 */
function DownloadCountCallout({
  used,
  limit,
  distinctIps,
}: {
  used: number;
  limit: number;
  distinctIps: number;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-wrap items-center gap-4 rounded-md border border-[--border] bg-[--bg-2] px-4 py-3">
      <div className="flex flex-col">
        <span className="text-[10px] uppercase tracking-wider text-[--text-2]">
          {t('admin.files.drawer.downloads')}
        </span>
        <span className="text-2xl font-semibold text-[--text-1]">
          {used}
          {limit > 0 ? (
            <span className="ml-1 text-sm font-normal text-[--text-2]">
              / {limit}
            </span>
          ) : (
            <span className="ml-1 text-sm font-normal text-[--text-2]">
              / ∞
            </span>
          )}
        </span>
      </div>
      <div className="flex flex-col">
        <span className="text-[10px] uppercase tracking-wider text-[--text-2]">
          {t('admin.files.drawer.distinctIps')}
        </span>
        <span className="text-2xl font-semibold text-[--text-1]">
          {distinctIps}
        </span>
      </div>
    </div>
  );
}

/**
 * Read-only, monospace, scrollable preview of a text share with a Copy
 * button. The text comes from the admin-only `/content` endpoint which
 * does not bump `used_count`.
 */
function TextPreview({
  loading,
  text,
}: {
  loading: boolean;
  text: string | undefined;
}) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);

  async function copy() {
    if (text == null) return;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error(t('admin.files.drawer.copyFailed'));
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-6">
        <Spinner />
      </div>
    );
  }
  if (text == null) {
    return (
      <div className="py-6 text-center text-xs text-[--text-muted]">
        {t('admin.files.drawer.contentUnavailable')}
      </div>
    );
  }
  return (
    <div className="relative">
      <pre className="max-h-[40vh] overflow-auto rounded-md border border-[--border] bg-[--bg-2] p-3 font-mono text-xs leading-relaxed text-[--text-1]">
        {text}
      </pre>
      <Button
        size="sm"
        variant="outline"
        className="absolute right-2 top-2"
        onClick={() => void copy()}
      >
        {copied
          ? t('admin.files.drawer.copied')
          : t('admin.files.drawer.copy')}
      </Button>
    </div>
  );
}

/**
 * "Download" button for binary shares. Streams the bytes through the
 * admin-only endpoint, which writes one `admin_action` audit row tagged
 * `extra.reason='admin_preview'` and leaves `used_count` untouched.
 */
function BinaryDownload({
  code,
  fallbackName,
}: {
  code: string;
  fallbackName: string;
}) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);

  async function go() {
    setBusy(true);
    try {
      await downloadFileAsAdmin(code, fallbackName);
    } catch (e) {
      toast.error((e as Error)?.message ?? '—');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex items-center gap-3">
      <Button
        size="sm"
        variant="primary"
        loading={busy}
        onClick={() => void go()}
      >
        {t('admin.files.drawer.download')}
      </Button>
      <span className="text-xs text-[--text-2]">
        {t('admin.files.drawer.downloadHint')}
      </span>
    </div>
  );
}

// Visual tokens for the access-log action column. Each row is colour-coded
// so an admin can tell at a glance which events are share creations
// (uploads), which are real visitor fetches, and which are admin actions
// — including the admin's own preview clicks (extra.reason ===
// 'admin_preview').
function actionVisual(action: string, reason: string | null): {
  label: string;
  icon: string;
  className: string;
  tKey: string;
} {
  switch (action) {
    case 'share_create':
      return {
        label: 'Create',
        icon: '↑',
        className: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
        tKey: 'admin.files.drawer.actionCreate',
      };
    case 'share_retrieve':
      return {
        label: 'Retrieve',
        icon: '↓',
        className: 'bg-sky-500/10 text-sky-600 dark:text-sky-400',
        tKey: 'admin.files.drawer.actionRetrieve',
      };
    case 'admin_action':
      if (reason === 'admin_preview') {
        return {
          label: 'Admin preview',
          icon: '👁',
          className:
            'bg-amber-500/10 text-amber-600 dark:text-amber-400 italic',
          tKey: 'admin.files.drawer.actionAdminPreview',
        };
      }
      return {
        label: 'Admin',
        icon: '⚙',
        className:
          'bg-violet-500/10 text-violet-600 dark:text-violet-400',
        tKey: 'admin.files.drawer.actionAdmin',
      };
    default:
      return {
        label: action,
        icon: '•',
        className: 'bg-[--bg-2] text-[--text-2]',
        tKey: '',
      };
  }
}

function AccessLogRow({ item }: { item: AdminFileAccessLogItem }) {
  const { t } = useTranslation();
  const ua = item.ua ?? '';
  const truncated = ua.length > 60 ? `${ua.slice(0, 60)}…` : ua;
  const reason =
    typeof item.extra === 'object' && item.extra !== null
      ? ((item.extra as Record<string, unknown>).reason as string | undefined) ??
        null
      : null;
  const v = actionVisual(item.action, reason);
  const label = v.tKey ? t(v.tKey) : v.label;

  return (
    <tr>
      <td className="whitespace-nowrap px-2 py-1.5 text-[--text-2]">
        {formatTime(item.ts)}
      </td>
      <td className="px-2 py-1.5">
        <span
          className={cn(
            'inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-medium',
            v.className,
          )}
        >
          <span aria-hidden>{v.icon}</span>
          {label}
        </span>
      </td>
      <td className="px-2 py-1.5 font-mono text-[--text-2]">
        {item.ip ?? '—'}
      </td>
      <td className="px-2 py-1.5 text-[--text-2]" title={ua || undefined}>
        {truncated || '—'}
      </td>
    </tr>
  );
}
