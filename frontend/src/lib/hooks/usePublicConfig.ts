/**
 * React Query hook for the public /api/config blob.
 * Falls back to DEFAULT_CONFIG inside getConfig() so consumers never have
 * to deal with "config is undefined".
 */
import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getConfig, DEFAULT_CONFIG, type PublicConfig } from '@/lib/api/public';
import { useThemeStore } from '@/stores/theme';

export function usePublicConfig(): PublicConfig {
  const { data } = useQuery({
    queryKey: ['public-config'],
    queryFn: getConfig,
    staleTime: 5 * 60 * 1000,
    placeholderData: DEFAULT_CONFIG,
  });
  return data ?? DEFAULT_CONFIG;
}

/**
 * Apply the server-persisted site theme once the public config lands.
 *
 * This is the mechanism that makes an admin theme change reach every visitor
 * with **no rebuild and no redeploy**: the admin writes settings_kv, the SPA
 * reads it here on next load and flips the <html> attributes that
 * `templates.css` keys off.
 *
 * Mount this once, near the router root. It renders nothing.
 */
export function useApplyServerTheme(): void {
  const { data, isError, isSuccess } = useQuery({
    queryKey: ['public-config'],
    queryFn: getConfig,
    staleTime: 5 * 60 * 1000,
    placeholderData: DEFAULT_CONFIG,
  });
  const hydrate = useThemeStore((s) => s.hydrateFromServer);
  const markHydrated = useThemeStore((s) => s.markHydrated);
  const theme = data?.theme;

  useEffect(() => {
    if (theme) {
      hydrate(theme);
      return;
    }
    // No theme in the payload — either the request failed or the backend
    // predates the theme field. Either way we must stop blocking render, or
    // consumers gated on `hydrated` (e.g. the v2/legacy switch) would show a
    // permanently blank page.
    if (isError || isSuccess) markHydrated();
    // Re-run only when the server actually sends a different theme. The
    // object identity changes on every refetch, so compare by value.
  }, [
    hydrate,
    markHydrated,
    isError,
    isSuccess,
    theme,
    theme?.template,
    theme?.mode,
    theme?.accent,
    theme?.accent_custom,
    theme?.lock_mode,
    theme?.brand_name,
    theme?.hero_title,
    theme?.hero_subtitle,
    theme?.logo_url,
  ]);
}
