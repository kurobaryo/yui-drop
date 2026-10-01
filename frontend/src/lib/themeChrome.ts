/**
 * Browser chrome that has to follow the applied theme.
 *
 * - `<meta name="theme-color">` tints the phone browser's address / status
 *   bars. index.html ships a static dark value, so without this the bars
 *   stayed black on the light page.
 * - `color-scheme` on <html> picks light or dark native scrollbars and form
 *   controls to match the resolved appearance.
 *
 * Called by both theme writers (the store's `applyToDOM` and v2's
 * `applyTheme`) right after they set the attributes, so the computed `--bg`
 * read here is already the new one.
 */
export function syncThemeChrome(resolved: 'light' | 'dark'): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  root.style.colorScheme = resolved;
  const bg = getComputedStyle(root).getPropertyValue('--bg').trim();
  if (!bg) return;
  let meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
  if (!meta) {
    meta = document.createElement('meta');
    meta.name = 'theme-color';
    document.head.appendChild(meta);
  }
  meta.content = bg;
}
