/**
 * App — top-level router.
 *
 * Public surface: `/` (WashiApp), plus deep-link short-code routes
 * `/s/:code` and `/v/:code` which hand the prefilled code to WashiApp so it
 * opens the pickup modal with that code resolved. `/m/:code` is kept for
 * multi-share short links; it likewise reuses WashiApp.
 *
 * Admin surface (`/admin/*`) is unchanged.
 */
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';

import Home from './pages/Home';
import NotFound from './pages/NotFound';
import AdminLogin from './pages/admin/Login';
import AdminLayout from './pages/admin/Layout';
import Dashboard from './pages/admin/Dashboard';
import AdminFiles from './pages/admin/Files';
import AdminLogs from './pages/admin/Logs';
import AdminSettings from './pages/admin/Settings';
import { ToastProvider } from './components/ui/Toast';

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Home />} />
        {/* Deep links — all funnel into WashiApp via Home with `:code` param. */}
        <Route path="/s/:code" element={<Home />} />
        <Route path="/v/:code" element={<Home />} />
        <Route path="/m/:code" element={<Home />} />
        <Route path="/admin/login" element={<AdminLogin />} />
        <Route path="/admin" element={<AdminLayout />}>
          <Route index element={<Dashboard />} />
          <Route path="files" element={<AdminFiles />} />
          <Route path="logs" element={<AdminLogs />} />
          <Route path="settings" element={<AdminSettings />} />
          <Route path="*" element={<Navigate to="/admin" replace />} />
        </Route>
        <Route path="*" element={<NotFound />} />
      </Routes>
      <ToastProvider />
    </BrowserRouter>
  );
}
