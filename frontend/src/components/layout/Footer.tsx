/**
 * Footer — single line: © year · credit · Admin link.
 */
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

export function Footer() {
  const { t } = useTranslation();
  const year = new Date().getFullYear();
  return (
    <footer className="mx-auto max-w-5xl px-4 md:px-6 py-6 text-xs text-[--text-muted]">
      <div className="flex flex-wrap items-center justify-center gap-x-2 gap-y-1">
        <span>
          {t('footer.credit', { year })}
        </span>
        <span aria-hidden="true">·</span>
        <Link
          to="/admin/login"
          className="text-[--text-2] hover:text-[hsl(var(--accent-h)_var(--accent-s)_var(--accent-l))] transition-colors"
        >
          {t('footer.admin')}
        </Link>
      </div>
    </footer>
  );
}

export default Footer;
