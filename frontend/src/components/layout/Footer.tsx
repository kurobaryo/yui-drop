/**
 * Footer — two-column footer matching the spec screenshot.
 *
 * Left side:  "Yui-Drop · MIT"
 * Right side: three links — Docs / GitHub / Admin.
 *   - Docs   → /docs (route is not implemented yet, see TODO)
 *   - GitHub → public repo on github.com/kurobaryo/yui-drop, new tab
 *   - Admin  → /admin/login
 */
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

const GITHUB_URL = 'https://github.com/kurobaryo/yui-drop';

export function Footer() {
  const { t } = useTranslation();
  return (
    <footer className="mx-auto max-w-6xl px-4 md:px-6 py-6 text-xs text-[--text-muted]">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <span className="text-[--text-2]">Yui-Drop · MIT</span>
        <nav
          aria-label="footer-links"
          className="flex flex-wrap items-center gap-x-4 gap-y-1"
        >
          {/* TODO: docs route — the /docs page is not implemented yet, but
              I'm keeping the link so it slots in once the docs ship. */}
          <Link
            to="/docs"
            className="text-[--text-2] hover:text-[hsl(var(--accent-h)_var(--accent-s)_var(--accent-l))] transition-colors"
          >
            {t('footer.docs')}
          </Link>
          <a
            href={GITHUB_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[--text-2] hover:text-[hsl(var(--accent-h)_var(--accent-s)_var(--accent-l))] transition-colors"
          >
            {t('footer.github')}
          </a>
          <Link
            to="/admin/login"
            className="text-[--text-2] hover:text-[hsl(var(--accent-h)_var(--accent-s)_var(--accent-l))] transition-colors"
          >
            {t('footer.admin')}
          </Link>
        </nav>
      </div>
    </footer>
  );
}

export default Footer;
