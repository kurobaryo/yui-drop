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

import {
  listApiKeys,
  revokeApiKey,
  type ApiKeyListItem,
} from '@/lib/api/adminApiKeys';
import { ApiError } from '@/lib/api';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { Spinner } from '@/components/ui/Spinner';
import { toast } from '@/components/ui/Toast';
import { Icon } from '@/v2/components/IconSprite';
import { humanBytes, isExpired, formatTime } from '@/lib/format';

import ApiKeyIssueModal from './ApiKeyIssueModal';
import ApiKeyEditModal from './ApiKeyEditModal';
import ApiKeyUsageModal from './ApiKeyUsageModal';

type Status = 'active' | 'revoked' | 'expired';

function statusOf(row: ApiKeyListItem): Status {
  if (row.revoked_at) return 'revoked';
  if (isExpired(row.expires_at)) return 'expired';
  return 'active';
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
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14 }}>
        <h1 style={title}>API Keys</h1>
        <button type="button" data-yd="btn" onClick={() => setIssueOpen(true)} style={primary}>
          <Icon name="i-plus" size={15} />签发新 Key
        </button>
      </div>

      {isLoading ? (
        <div style={{ display: 'flex', justifyContent: 'center', padding: '48px 0' }}><Spinner /></div>
      ) : items.length === 0 ? (
        <div style={{ ...card, padding: '48px 0', textAlign: 'center', fontSize: 13, color: 'var(--tx3)' }}>{t('admin.apiKeys.empty')}</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {items.map((row) => {
            const status = statusOf(row);
            const tone = status === 'active' ? 'var(--ok)' : status === 'revoked' ? 'var(--bad)' : 'var(--warn)';
            return (
              <div key={row.id} style={{ ...card, padding: '14px 16px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--tx)' }}>{row.note || '未命名 Key'}</span>
                  <span style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 12, color: 'var(--tx3)' }}>{row.key_id}</span>
                  <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 5, background: 'var(--acs)', color: 'var(--act)' }}>
                    {row.scopes.join(' · ') || '—'}
                  </span>
                  <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 5, background: `color-mix(in srgb, ${tone} 14%, transparent)`, color: tone }}>
                    {t(`admin.apiKeys.statuses.${status}`)}
                  </span>
                  <span style={{ marginLeft: 'auto', display: 'inline-flex', gap: 6 }}>
                    <button type="button" data-yd="quiet" onClick={() => setUsageTarget(row.id)} style={act('var(--tx2)')}>用量</button>
                    <button type="button" data-yd="quiet" onClick={() => setEditTarget(row)} disabled={status === 'revoked'} style={act('var(--tx2)', status === 'revoked')}>编辑</button>
                    <button type="button" data-yd="quiet" onClick={() => setRevokeTarget(row)} disabled={status === 'revoked'} style={act('var(--bad)', status === 'revoked')}>吊销</button>
                  </span>
                </div>
                <div style={{ marginTop: 10, display: 'flex', gap: 24, flexWrap: 'wrap', fontSize: 12, color: 'var(--tx3)' }}>
                  <span>单文件上限 {humanBytes(row.max_file_size)}</span>
                  <span>每日配额 {humanBytes(row.quota_daily_bytes)}</span>
                  <span>限速 {row.quota_per_minute}/{t('admin.apiKeys.minUnit')}</span>
                  <span>最后使用 {row.last_used_at ? formatTime(row.last_used_at) : '从未'}</span>
                </div>
              </div>
            );
          })}
        </div>
      )}

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

const title: React.CSSProperties = { fontSize: 22, fontWeight: 700, letterSpacing: '-.01em', color: 'var(--tx)', marginRight: 'auto' };
const card: React.CSSProperties = { border: '1px solid var(--ln)', borderRadius: 12, background: 'var(--pn)' };
const primary: React.CSSProperties = { height: 36, padding: '0 14px', border: 'none', borderRadius: 9, background: 'var(--ac)', color: '#fff', fontFamily: 'inherit', fontSize: 13, fontWeight: 600, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 7, whiteSpace: 'nowrap' };
function act(color: string, disabled = false): React.CSSProperties {
  return { fontSize: 12, color, border: '1px solid var(--ln)', borderRadius: 7, padding: '4px 9px', cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.4 : 1, background: 'transparent', fontFamily: 'inherit' };
}
