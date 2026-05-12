/**
 * Admin Logs — paginated table with an action filter dropdown.
 */
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { listLogs } from '@/lib/api/admin';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Select } from '@/components/ui/Select';
import { Spinner } from '@/components/ui/Spinner';
import { formatTime } from '@/lib/format';

const ACTION_OPTIONS = [
  '',
  'create_text',
  'create_file',
  'select',
  'download',
  'login',
  'admin_patch',
  'admin_delete',
  'admin_restore',
  'admin_empty_trash',
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
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-[--text-1]">
          {t('admin.logs.title')}
        </h1>
      </div>

      <div className="flex items-center gap-3">
        <label className="text-sm text-[--text-2]">
          {t('admin.logs.filterAction')}
        </label>
        <div className="w-48">
          <Select
            selectSize="sm"
            value={action}
            onChange={(e) => {
              setAction(e.target.value);
              setPage(1);
            }}
          >
            {ACTION_OPTIONS.map((a) => (
              <option key={a || 'all'} value={a}>
                {a || t('admin.logs.all')}
              </option>
            ))}
          </Select>
        </div>
      </div>

      <Card className="!p-0 overflow-hidden">
        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <Spinner />
          </div>
        ) : !data || data.items.length === 0 ? (
          <div className="py-12 text-center text-sm text-[--text-muted]">
            {t('admin.logs.empty')}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-[--bg-2] text-left text-xs text-[--text-2]">
                <tr>
                  <th className="px-3 py-2">{t('admin.logs.columns.ts')}</th>
                  <th className="px-3 py-2">{t('admin.logs.columns.action')}</th>
                  <th className="px-3 py-2">{t('admin.logs.columns.code')}</th>
                  <th className="px-3 py-2">{t('admin.logs.columns.ip')}</th>
                  <th className="px-3 py-2">{t('admin.logs.columns.ua')}</th>
                  <th className="px-3 py-2">{t('admin.logs.columns.status')}</th>
                  <th className="px-3 py-2">{t('admin.logs.columns.event')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[--border]">
                {data.items.map((row) => {
                  const event =
                    (row.extra && typeof row.extra === 'object'
                      ? (row.extra as Record<string, unknown>).event
                      : null) ?? '';
                  return (
                    <tr key={row.id} className="hover:bg-[--bg-2]">
                      <td className="px-3 py-2 whitespace-nowrap text-xs text-[--text-2]">
                        {formatTime(row.ts)}
                      </td>
                      <td className="px-3 py-2 text-xs">{row.action}</td>
                      <td className="px-3 py-2 font-mono text-xs">
                        {row.code ?? '—'}
                      </td>
                      <td className="px-3 py-2 text-xs text-[--text-2]">
                        {row.ip ?? '—'}
                      </td>
                      <td
                        className="px-3 py-2 max-w-[220px] truncate text-xs text-[--text-2]"
                        title={row.ua ?? ''}
                      >
                        {row.ua ?? '—'}
                      </td>
                      <td className="px-3 py-2 text-xs">
                        {row.status_code ?? '—'}
                      </td>
                      <td className="px-3 py-2 text-xs text-[--text-2]">
                        {String(event)}
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
    </div>
  );
}
