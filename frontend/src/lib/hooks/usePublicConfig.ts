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
  const config = usePublicConfig();
  const hydrate = useThemeStore((s) => s.hydrateFromServer);
  const theme = config.theme;

  useEffect(() => {
    if (!theme) return;
    hydrate(theme);
    // Re-run only when the server actually sends a different theme. The
    // object identity changes on every refetch, so compare by value.
  }, [
    hydrate,
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
