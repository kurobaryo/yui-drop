/**
 * App — top-level router.
 *
 * BrowserRouter + Routes; admin section is a nested layout with its own
 * children. ToastProvider is mounted here so toasts work on every page.
 */
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';

import Home from './pages/Home';
import ShortLink from './pages/ShortLink';
import Viewer from './pages/Viewer';
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
        <Route path="/s/:code" element={<ShortLink />} />
        <Route path="/v/:code" element={<Viewer />} />
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
