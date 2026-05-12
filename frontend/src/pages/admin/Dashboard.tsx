/**
 * Admin Dashboard — 4 stat cards + today/yesterday counter rows.
 */
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { getDashboard } from '@/lib/api/admin';
import { Card } from '@/components/ui/Card';
import { Spinner } from '@/components/ui/Spinner';
import { CountUp } from '@/components/fx/CountUp';
import { humanBytes, humanDuration } from '@/lib/format';

export default function Dashboard() {
  const { t } = useTranslation();
  const { data, isLoading, error } = useQuery({
    queryKey: ['admin', 'dashboard'],
    queryFn: getDashboard,
    refetchInterval: 30_000,
  });

  if (isLoading) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center">
        <Spinner />
      </div>
    );
  }
  if (error || !data) {
    return (
      <p className="text-sm text-red-400">{(error as Error)?.message ?? '—'}</p>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold text-[--text-1]">
        {t('admin.dashboard.title')}
      </h1>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label={t('admin.dashboard.totalFiles')}
          value={<CountUp value={data.totalFiles} />}
        />
        <StatCard
          label={t('admin.dashboard.storageUsed')}
          value={<CountUp value={data.storageUsed} format={humanBytes} />}
        />
        <StatCard
          label={t('admin.dashboard.recycled')}
          value={<CountUp value={data.recycledFiles} />}
        />
        <StatCard
          label={t('admin.dashboard.uptime')}
          value={<CountUp value={data.sysUptime} format={humanDuration} />}
        />
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <Card>
          <div className="text-xs uppercase tracking-wider text-[--text-2]">
            {t('admin.dashboard.today')}
          </div>
          <div className="mt-2 flex items-baseline gap-6">
            <div>
              <div className="text-xs text-[--text-muted]">
                {t('admin.dashboard.uploads')}
              </div>
              <div className="text-2xl font-semibold text-[--text-1]">
                <CountUp value={data.today.uploads} />
              </div>
            </div>
            <div>
              <div className="text-xs text-[--text-muted]">
                {t('admin.dashboard.retrievals')}
              </div>
              <div className="text-2xl font-semibold text-[--text-1]">
                <CountUp value={data.today.retrievals} />
              </div>
            </div>
          </div>
        </Card>
        <Card>
          <div className="text-xs uppercase tracking-wider text-[--text-2]">
            {t('admin.dashboard.yesterday')}
          </div>
          <div className="mt-2 flex items-baseline gap-6">
            <div>
              <div className="text-xs text-[--text-muted]">
                {t('admin.dashboard.uploads')}
              </div>
              <div className="text-2xl font-semibold text-[--text-1]">
                <CountUp value={data.yesterday.uploads} />
              </div>
            </div>
            <div>
              <div className="text-xs text-[--text-muted]">
                {t('admin.dashboard.retrievals')}
              </div>
              <div className="text-2xl font-semibold text-[--text-1]">
                <CountUp value={data.yesterday.retrievals} />
              </div>
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
}

function StatCard({
  label,
  value,
}: {
  label: string;
  value: React.ReactNode;
}) {
  return (
    <Card>
      <div className="text-xs uppercase tracking-wider text-[--text-2]">
        {label}
      </div>
      <div className="mt-2 text-3xl font-semibold text-[--text-1]">{value}</div>
    </Card>
  );
}
