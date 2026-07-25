/**
 * SiteRoot — chooses which public UI renders for the active site theme.
 *
 * The admin-selected template decides whether a visitor sees the v2 design or
 * the legacy Washi UI. Because the choice is data (a slug from /api/config),
 * switching is a setting change — no rebuild, and the old UI stays reachable
 * as a rollback.
 *
 * ★ Adding a future UI: register its slug in `v2/themes.ts`, add the CSS file,
 *   and (only if it needs a different component tree) branch here. Themes that
 *   are pure restyles of v2 need no change to this file at all.
 */
import { lazy, Suspense } from 'react';
import { useLocation } from 'react-router-dom';

import { useThemeStore } from '@/stores/theme';
import { THEMES } from '@/v2/themes';
import LegacyHome from '@/pages/Home';
import LegacyApiDocs from '@/pages/ApiDocs';
import LegacyCollectionCreate from '@/pages/Collection/Create';
import LegacyCollectionRoom from '@/pages/Collection/Room';

// Code-split: visitors on the legacy UI never download the v2 bundle, and
// vice-versa.
const V2App = lazy(() => import('@/v2/V2App'));

/** Slugs served by the v2 component tree. Sourced from the v2 registry so a
 *  newly registered theme is picked up without editing this list. */
const V2_SLUGS = new Set(THEMES.map((t) => t.slug));

export function SiteRoot() {
  const location = useLocation();
  const template = useThemeStore((s) => s.template);
  const hydrated = useThemeStore((s) => s.hydrated);

  // Until /api/config lands we don't know which UI to show. Rendering the
  // legacy tree and then swapping would flash; render nothing briefly instead.
  if (!hydrated) return null;

  if (V2_SLUGS.has(template)) {
    return (
      <Suspense fallback={null}>
        <V2App />
      </Suspense>
    );
  }
  if (location.pathname === '/docs') return <LegacyApiDocs />;
  if (location.pathname === '/collection/new') return <LegacyCollectionCreate />;
  if (location.pathname.startsWith('/c/')) return <LegacyCollectionRoom />;
  return <LegacyHome />;
}

export default SiteRoot;
