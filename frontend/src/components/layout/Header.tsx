/**
 * Header — 56px tall, sticky, translucent background with backdrop blur.
 *
 * Left: logo "Yui-Drop ✨" linking home.
 * Right: language + theme switchers.
 */
import { Link } from 'react-router-dom';
import { LangSwitcher } from './LangSwitcher';
import { ThemeSwitcher } from './ThemeSwitcher';
import { cn } from '@/lib/cn';

export function Header() {
  return (
    <header
      className={cn(
        'sticky top-0 z-20 h-14 w-full',
        'bg-[--bg-1]/80 backdrop-blur',
        'border-b border-[--border]',
      )}
    >
      <div className="mx-auto flex h-full max-w-5xl items-center justify-between px-4 md:px-6">
        <Link
          to="/"
          className={cn(
            'inline-flex items-center gap-1.5 text-base font-semibold',
            'text-[--text-1] hover:text-[hsl(var(--accent-h)_var(--accent-s)_var(--accent-l))]',
            'transition-colors duration-150',
          )}
        >
          <span>Yui-Drop</span>
          <span aria-hidden="true">✨</span>
        </Link>
        <div className="flex items-center gap-2">
          <LangSwitcher />
          <ThemeSwitcher />
        </div>
      </div>
    </header>
  );
}

export default Header;
