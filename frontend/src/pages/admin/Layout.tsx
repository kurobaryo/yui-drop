/**
 * Admin Layout — guard + sidebar shell.
 *
 * Redirects to /admin/login if the token store is invalid. Renders the
 * sidebar (Dashboard / Files / Logs / Settings + Sign out) and an <Outlet />
 * for the nested route content.
 *
 * Mobile (#4): on viewports <= 640px the sidebar collapses to a hamburger
 * button in the top bar. Tapping it slides a fixed-position drawer in from
 * the left over a dim overlay, locking body scroll while open. Selecting a
 * route or tapping the overlay closes the drawer.
 */
import { useEffect, useState } from 'react';
import { Navigate, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  LogOut,
  LayoutDashboard,
  FileText,
  ScrollText,
  Settings,
  Menu,
  X,
} from 'lucide-react';
import { useAdminStore } from '@/stores/admin';
import { Header } from '@/components/layout/Header';
import { cn } from '@/lib/cn';

const NAV = [
  { to: '/admin', end: true, key: 'admin.nav.dashboard', Icon: LayoutDashboard },
  { to: '/admin/files', end: false, key: 'admin.nav.files', Icon: FileText },
  { to: '/admin/logs', end: false, key: 'admin.nav.logs', Icon: ScrollText },
  { to: '/admin/settings', end: false, key: 'admin.nav.settings', Icon: Settings },
];

function useIsMobile(): boolean {
  const [isMobile, setIsMobile] = useState<boolean>(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return false;
    return window.matchMedia('(max-width: 640px)').matches;
  });
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mq = window.matchMedia('(max-width: 640px)');
    const onChange = (e: MediaQueryListEvent) => setIsMobile(e.matches);
    mq.addEventListener?.('change', onChange);
    return () => mq.removeEventListener?.('change', onChange);
  }, []);
  return isMobile;
}

export default function AdminLayout() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const isValid = useAdminStore((s) => s.isValid());
  const clear = useAdminStore((s) => s.clear);
  const isMobile = useIsMobile();
  const [drawerOpen, setDrawerOpen] = useState(false);

  // Close the drawer on every route change.
  useEffect(() => {
    setDrawerOpen(false);
  }, [location.pathname]);

  // Lock body scroll while the mobile drawer is open.
  useEffect(() => {
    if (!drawerOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [drawerOpen]);

  if (!isValid) {
    return <Navigate to="/admin/login" replace />;
  }

  function signOut() {
    clear();
    navigate('/admin/login', { replace: true });
  }

  const navLinks = (
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
  );

  return (
    <>
      <Header />
      {isMobile && (
        <div className="mx-auto flex max-w-6xl items-center gap-2 px-4 pt-3">
          <button
            type="button"
            aria-label="Open admin menu"
            onClick={() => setDrawerOpen(true)}
            className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-[--border] text-[--text-1]"
          >
            <Menu className="h-5 w-5" />
          </button>
        </div>
      )}
      <div className="mx-auto flex max-w-6xl gap-6 px-4 md:px-6 py-6">
        {!isMobile && (
          <aside className="w-48 shrink-0">{navLinks}</aside>
        )}
        <main className="min-w-0 flex-1">
          <Outlet />
        </main>
      </div>

      {/* Mobile slide-in drawer */}
      {isMobile && drawerOpen && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 80,
            background: 'rgba(0,0,0,0.5)',
          }}
          onClick={() => setDrawerOpen(false)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              position: 'fixed',
              top: 0,
              left: 0,
              bottom: 0,
              width: 240,
              background: 'var(--bg-0, #111)',
              borderRight: '1px solid var(--border, #333)',
              padding: '16px 12px',
              display: 'flex',
              flexDirection: 'column',
              gap: 12,
              overflowY: 'auto',
            }}
          >
            <div className="flex items-center justify-between">
              <span className="text-xs uppercase tracking-wider text-[--text-2]">
                {t('admin.nav.dashboard')}
              </span>
              <button
                type="button"
                aria-label="Close admin menu"
                onClick={() => setDrawerOpen(false)}
                className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-[--border] text-[--text-1]"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            {navLinks}
          </div>
        </div>
      )}
    </>
  );
}
