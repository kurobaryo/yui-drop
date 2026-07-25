/**
 * App — top-level router.
 *
 * Public surface: `/` (WashiApp), plus deep-link short-code routes
 * `/s/:code` and `/v/:code` which hand the prefilled code to WashiApp so it
 * opens the pickup modal with that code resolved. `/m/:code` is kept for
 * multi-share short links; it likewise reuses WashiApp.
 *
 * Admin surface (`/admin/*`) is unchanged.
 *
 * Route transitions: every page mounts inside a keyed `<div class="route-fade">`
 * so navigating to a new path triggers a short fade-in. Respects
 * `prefers-reduced-motion` via the global CSS rule.
 */
import {
  BrowserRouter,
  Navigate,
  Route,
  Routes,
  useLocation,
} from 'react-router-dom';

import SiteRoot from './SiteRoot';
import NotFound from './pages/NotFound';
import AdminLogin from './pages/admin/Login';
import AdminLayout from './pages/admin/Layout';
import Dashboard from './pages/admin/Dashboard';
import AdminFiles from './pages/admin/Files';
import AdminApiKeys from './pages/admin/ApiKeys';
import AdminLogs from './pages/admin/Logs';
import AdminSettings from './pages/admin/Settings';
import AdminTheme from './pages/admin/Theme';
import AdminCollections from './pages/admin/Collections';
import OidcCallback from './pages/admin/auth/OidcCallback';
import OidcBound from './pages/admin/auth/OidcBound';
import CollectionLanding from './pages/Collection/Landing';
import { ToastProvider } from './components/ui/Toast';
import { useApplyServerTheme } from './lib/hooks/usePublicConfig';

/**
 * Wraps `<Routes>` so we can read the current location and remount the routed
 * tree under a path-keyed `<div>`. The CSS class `.route-fade` re-runs its
 * keyframes every time the key changes — that gives us a soft fade between
 * pages without bringing in any animation library.
 */
function AnimatedRoutes() {
  const location = useLocation();
  // Apply the admin-configured site theme as soon as /api/config lands.
  useApplyServerTheme();
  return (
    <div key={location.pathname} className="route-fade">
      <Routes location={location}>
        {/* `/` picks the v2 or legacy public UI from the active site theme. */}
        <Route path="/" element={<SiteRoot />} />
        {/* Deep links — all funnel into WashiApp via Home with `:code` param. */}
        <Route path="/s/:code" element={<SiteRoot />} />
        <Route path="/v/:code" element={<SiteRoot />} />
        <Route path="/m/:code" element={<SiteRoot />} />
        <Route path="/docs" element={<SiteRoot />} />
        {/* Collection (共享空间) — multi-user drop boxes. */}
        <Route path="/collection" element={<CollectionLanding />} />
        <Route path="/collection/new" element={<SiteRoot />} />
        <Route path="/c/:code" element={<SiteRoot />} />
        <Route path="/admin/login" element={<AdminLogin />} />
        {/* OIDC SPA-side landings — must sit *outside* the AdminLayout so they
            don't require an existing admin token to render. */}
        <Route path="/admin/oidc/callback" element={<OidcCallback />} />
        <Route path="/admin/oidc/bound" element={<OidcBound />} />
        <Route path="/admin" element={<AdminLayout />}>
          <Route index element={<Dashboard />} />
          <Route path="files" element={<AdminFiles />} />
          <Route path="api-keys" element={<AdminApiKeys />} />
          <Route path="logs" element={<AdminLogs />} />
          <Route path="theme" element={<AdminTheme />} />
          <Route path="settings" element={<AdminSettings />} />
          <Route path="collections" element={<AdminCollections />} />
          <Route path="*" element={<Navigate to="/admin" replace />} />
        </Route>
        <Route path="*" element={<NotFound />} />
      </Routes>
    </div>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <AnimatedRoutes />
      <ToastProvider />
    </BrowserRouter>
  );
}
