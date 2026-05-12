/**
 * Admin Layout — guard + sidebar shell.
 *
 * Redirects to /admin/login if the token store is invalid. Renders the
 * sidebar (Dashboard / Files / Logs / Settings + Sign out) and an <Outlet />
 * for the nested route content.
 */
import { Navigate, NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { LogOut, LayoutDashboard, FileText, ScrollText, Settings } from 'lucide-react';
import { useAdminStore } from '@/stores/admin';
import { Header } from '@/components/layout/Header';
import { cn } from '@/lib/cn';

const NAV = [
  { to: '/admin', end: true, key: 'admin.nav.dashboard', Icon: LayoutDashboard },
  { to: '/admin/files', end: false, key: 'admin.nav.files', Icon: FileText },
  { to: '/admin/logs', end: false, key: 'admin.nav.logs', Icon: ScrollText },
  { to: '/admin/settings', end: false, key: 'admin.nav.settings', Icon: Settings },
];

export default function AdminLayout() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const isValid = useAdminStore((s) => s.isValid());
  const clear = useAdminStore((s) => s.clear);

  if (!isValid) {
    return <Navigate to="/admin/login" replace />;
  }

  function signOut() {
    clear();
    navigate('/admin/login', { replace: true });
  }

  return (
    <>
      <Header />
      <div className="mx-auto flex max-w-6xl gap-6 px-4 md:px-6 py-6">
        <aside className="w-48 shrink-0">
          <nav className="flex flex-col gap-1">
            {NAV.map(({ to, end, key, Icon }) => (
              <NavLink
                key={to}
                to={to}
                end={end}
                className={({ isActive }) =>
                  cn(
                    'flex items-center gap-2 rounded-md px-3 py-2 text-sm',
                    'border border-transparent transition-colors duration-150',
                    isActive
                      ? 'border-[--border] bg-[--bg-1] text-[--text-1]'
                      : 'text-[--text-2] hover:text-[--text-1] hover:border-[--border]',
                  )
                }
              >
                <Icon className="h-4 w-4" />
                <span>{t(key)}</span>
              </NavLink>
            ))}
            <button
              type="button"
              onClick={signOut}
              className={cn(
                'mt-3 flex items-center gap-2 rounded-md px-3 py-2 text-sm',
                'border border-transparent text-[--text-2]',
                'transition-colors hover:text-red-300 hover:border-red-500/40',
              )}
            >
              <LogOut className="h-4 w-4" />
              <span>{t('admin.nav.logout')}</span>
            </button>
          </nav>
        </aside>
        <main className="min-w-0 flex-1">
          <Outlet />
        </main>
      </div>
    </>
  );
}
