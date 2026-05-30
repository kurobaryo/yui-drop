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

import Home from './pages/Home';
import NotFound from './pages/NotFound';
import ApiDocs from './pages/ApiDocs';
import AdminLogin from './pages/admin/Login';
import AdminLayout from './pages/admin/Layout';
import Dashboard from './pages/admin/Dashboard';
import AdminFiles from './pages/admin/Files';
import AdminApiKeys from './pages/admin/ApiKeys';
import AdminLogs from './pages/admin/Logs';
import AdminSettings from './pages/admin/Settings';
import AdminCollections from './pages/admin/Collections';
import OidcCallback from './pages/admin/auth/OidcCallback';
import OidcBound from './pages/admin/auth/OidcBound';
import CollectionLanding from './pages/Collection/Landing';
import CollectionCreate from './pages/Collection/Create';
import CollectionRoom from './pages/Collection/Room';
import { ToastProvider } from './components/ui/Toast';

/**
 * Wraps `<Routes>` so we can read the current location and remount the routed
 * tree under a path-keyed `<div>`. The CSS class `.route-fade` re-runs its
 * keyframes every time the key changes — that gives us a soft fade between
 * pages without bringing in any animation library.
 */
function AnimatedRoutes() {
  const location = useLocation();
  return (
    <div key={location.pathname} className="route-fade">
      <Routes location={location}>
        <Route path="/" element={<Home />} />
        {/* Deep links — all funnel into WashiApp via Home with `:code` param. */}
        <Route path="/s/:code" element={<Home />} />
        <Route path="/v/:code" element={<Home />} />
        <Route path="/m/:code" element={<Home />} />
        <Route path="/docs" element={<ApiDocs />} />
        {/* Collection (共享空间) — multi-user drop boxes. */}
        <Route path="/collection" element={<CollectionLanding />} />
        <Route path="/collection/new" element={<CollectionCreate />} />
        <Route path="/c/:code" element={<CollectionRoom />} />
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
