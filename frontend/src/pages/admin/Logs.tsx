/**
 * Admin Logs — prototype-styled access log with an action filter.
 *
 * Data layer (listLogs + pagination) is unchanged; only the presentation was
 * rebuilt against the v2 design tokens so it matches the rest of the admin.
 */
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';

import { listLogs } from '@/lib/api/admin';
import { Spinner } from '@/components/ui/Spinner';
import { Icon } from '@/v2/components/IconSprite';
import { formatTime } from '@/lib/format';

// Must mirror ``AccessLogAction`` in backend/app/models/access_log.py.
// The pre-v2 list contained values the backend never emits (login,
// admin_patch, create_text, ...), so those filters always returned zero rows.
const ACTION_OPTIONS = [
  '',
  'share_create',
  'share_retrieve',
  'admin_action',
];

export default function AdminLogs() {
  const { t } = useTranslation();
  const [page, setPage] = useState(1);
  const size = 20;
  const [action, setAction] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['admin', 'logs', { page, size, action }],
    queryFn: () => listLogs({ page, size, action }),
    placeholderData: (prev) => prev,
  });

  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / size));

  return (
    <div>
      <h1 style={title}>访问日志</h1>

      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 13, color: 'var(--tx2)' }}>动作</span>
        <select
          value={action}
          onChange={(e) => { setAction(e.target.value); setPage(1); }}
          style={{ height: 34, padding: '0 10px', border: '1px solid var(--ln2)', borderRadius: 9, background: 'var(--p2)', color: 'var(--tx1)', fontFamily: 'inherit', fontSize: 13, outline: 'none' }}
        >
          {ACTION_OPTIONS.map((a) => <option key={a || 'all'} value={a}>{a || '全部'}</option>)}
        </select>
        <span style={{ fontSize: 12, color: 'var(--tx3)' }}>记录客户端 IP 与 User-Agent，用于滥用追溯</span>
      </div>

      <div data-r="tablewrap" style={card}>
        {isLoading ? (
          <div style={{ display: 'flex', justifyContent: 'center', padding: '48px 0' }}><Spinner /></div>
        ) : !data || data.items.length === 0 ? (
          <div style={{ padding: '48px 0', textAlign: 'center', fontSize: 13, color: 'var(--tx3)' }}>{t('admin.logs.empty')}</div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, minWidth: 720 }}>
            <thead>
              <tr style={{ background: 'var(--p1)' }}>
                {['时间', '动作', '取件码', 'IP', 'User-Agent', '状态'].map((h) => <th key={h} style={th}>{h}</th>)}
              </tr>
            </thead>
            <tbody>
              {data.items.map((row) => {
                const bad = (row.status_code ?? 200) >= 400;
                return (
                  <tr key={row.id} data-yd="row" style={{ borderTop: '1px solid var(--ln)' }}>
                    <td style={{ ...meta, whiteSpace: 'nowrap', fontFamily: "'JetBrains Mono',monospace" }}>{formatTime(row.ts)}</td>
                    <td style={td}>
                      <span style={{ fontSize: 11, padding: '2px 7px', borderRadius: 5, background: bad ? 'color-mix(in srgb, var(--bad) 14%, transparent)' : 'var(--acs)', color: bad ? 'var(--bad)' : 'var(--act)' }}>{row.action}</span>
                    </td>
                    <td style={{ ...td, fontFamily: "'JetBrains Mono',monospace", color: 'var(--act)' }}>{row.code ?? '—'}</td>
                    <td style={{ ...meta, fontFamily: "'JetBrains Mono',monospace" }}>{row.ip ?? '—'}</td>
                    <td data-r="rowmeta" style={{ ...meta, maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={row.ua ?? ''}>{row.ua ?? '—'}</td>
                    <td style={{ ...meta, color: bad ? 'var(--bad)' : 'var(--tx3)' }}>{row.status_code ?? '—'}</td>
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
    </div>
  );
}

const title: React.CSSProperties = { fontSize: 22, fontWeight: 700, letterSpacing: '-.01em', color: 'var(--tx)', marginBottom: 14 };
const card: React.CSSProperties = { border: '1px solid var(--ln)', borderRadius: 12, background: 'var(--pn)', overflow: 'hidden' };
const th: React.CSSProperties = { textAlign: 'left', fontWeight: 500, fontSize: 11.5, color: 'var(--tx3)', padding: '9px 12px' };
const td: React.CSSProperties = { padding: '10px 12px' };
const meta: React.CSSProperties = { padding: '10px 12px', color: 'var(--tx3)', fontSize: 12 };
const pager: React.CSSProperties = { width: 30, height: 30, border: '1px solid var(--ln)', borderRadius: 8, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', background: 'transparent', color: 'inherit' };
/** Pager button style with an explicit disabled affordance. */
function pageBtn(disabled: boolean): React.CSSProperties {
  return { ...pager, cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.35 : 1 };
}
