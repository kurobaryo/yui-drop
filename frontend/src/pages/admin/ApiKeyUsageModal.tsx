/**
 * ApiKeyUsageModal — 30-day usage histogram for a single API key.
 *
 * Fetches `/admin/api-keys/{pk}/usage?days=30` via react-query. Renders a
 * hand-rolled bar chart (no chart lib) where each bar's height is scaled
 * to the day's bytes or calls value, depending on the metric toggle.
 *
 * Bars are positioned bottom-up via flex `items-end` so a zero day stays
 * flush with the X-axis and the tallest day reaches the top.
 */
import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';

import {
  getApiKeyUsage,
  type ApiKeyUsageDay,
} from '@/lib/api/adminApiKeys';
import { ApiError } from '@/lib/api';
import { Modal } from '@/components/ui/Modal';
import { Spinner } from '@/components/ui/Spinner';
import { humanBytes } from '@/lib/format';

interface ApiKeyUsageModalProps {
  open: boolean;
  onClose: () => void;
  keyPk: number | null;
}

type Metric = 'bytes' | 'calls';

function abbrevDate(iso: string): string {
  // ISO `YYYY-MM-DD` → `MM-DD`. Defensive against extra TZ suffix.
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  return m ? `${m[2]}-${m[3]}` : iso;
}

export default function ApiKeyUsageModal({
  open,
  onClose,
  keyPk,
}: ApiKeyUsageModalProps) {
  const [metric, setMetric] = useState<Metric>('bytes');

  const { data, isLoading, error } = useQuery({
    queryKey: ['admin', 'api-keys', keyPk, 'usage', 30],
    queryFn: () => getApiKeyUsage(keyPk as number, 30),
    enabled: open && keyPk != null,
  });

  const days = data?.days ?? [];

  const maxValue = useMemo(() => {
    const values = days.map((d: ApiKeyUsageDay) =>
      metric === 'bytes' ? d.total_bytes : d.total_calls,
    );
    const m = Math.max(0, ...values);
    return m === 0 ? 1 : m; // avoid divide-by-zero
  }, [days, metric]);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="API key usage (last 30 days)"
      widthClassName="w-[95vw] max-w-3xl"
    >
      <div className="p-4 space-y-4">
        {isLoading ? (
          <div className="flex justify-center py-8">
            <Spinner />
          </div>
        ) : error ? (
          <div className="rounded-md border border-red-500/50 bg-red-500/5 p-3 text-sm text-red-200">
            {error instanceof ApiError ? error.message : String(error)}
          </div>
        ) : data ? (
          <>
            {/* Header summary */}
            <div className="flex items-center justify-between gap-4 flex-wrap">
              <div>
                <div className="text-xs uppercase tracking-wider text-[--text-2]">
                  Key
                </div>
                <div className="font-mono text-sm text-[--text-1]">
                  {data.key_id}
                </div>
              </div>
              <div className="flex gap-6">
                <div>
                  <div className="text-xs uppercase tracking-wider text-[--text-2]">
                    Total bytes
                  </div>
                  <div className="text-sm text-[--text-1]">
                    {humanBytes(data.totals.total_bytes)}
                  </div>
                </div>
                <div>
                  <div className="text-xs uppercase tracking-wider text-[--text-2]">
                    Total calls
                  </div>
                  <div className="text-sm text-[--text-1]">
                    {data.totals.total_calls.toLocaleString()}
                  </div>
                </div>
              </div>

              {/* Metric switch */}
              <div className="inline-flex rounded-md border border-[--border] overflow-hidden">
                {(['bytes', 'calls'] as Metric[]).map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => setMetric(m)}
                    className={
                      'px-3 py-1 text-xs ' +
                      (metric === m
                        ? 'bg-[hsl(var(--accent-h)_var(--accent-s)_var(--accent-l))] text-white'
                        : 'text-[--text-2] hover:text-[--text-1] hover:bg-[--bg-2]')
                    }
                  >
                    {m === 'bytes' ? 'Bytes' : 'Calls'}
                  </button>
                ))}
              </div>
            </div>

            {/* Chart */}
            <div className="rounded-md border border-[--border] bg-[--bg-2] p-3">
              <div className="flex items-end gap-1 h-48">
                {days.map((d) => {
                  const value =
                    metric === 'bytes' ? d.total_bytes : d.total_calls;
                  const pct = Math.max(2, (value / maxValue) * 100);
                  const label =
                    metric === 'bytes' ? humanBytes(value) : `${value} calls`;
                  return (
                    <div
                      key={d.date}
                      className="flex-1 min-w-0 flex flex-col items-center gap-1"
                    >
                      <div
                        className="w-full rounded-t bg-[hsl(var(--accent-h)_var(--accent-s)_var(--accent-l))] transition-all"
                        style={{ height: `${pct}%` }}
                        title={`${d.date} — ${label} (${d.total_calls} calls, ${humanBytes(d.total_bytes)})`}
                      />
                    </div>
                  );
                })}
              </div>
              {/* X-axis labels (rotated for readability when crowded) */}
              <div className="mt-2 flex gap-1">
                {days.map((d) => (
                  <div
                    key={d.date}
                    className="flex-1 min-w-0 text-center text-[10px] text-[--text-2] truncate"
                    title={d.date}
                  >
                    {abbrevDate(d.date)}
                  </div>
                ))}
              </div>
            </div>
          </>
        ) : null}
      </div>
    </Modal>
  );
}
