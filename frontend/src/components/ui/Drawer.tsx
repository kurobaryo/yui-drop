/**
 * A bare-bones right-side slide-in drawer.
 *
 * The project already ships a centred modal pattern (see Files.tsx's
 * EditExpiryModal); this component fills the side-sheet gap without
 * dragging in a heavier dialog library. Behaviour:
 *   - fixed-position overlay covers the viewport;
 *   - the panel itself is 480px wide on >=sm screens and full-width
 *     on phones;
 *   - clicking the dimmed backdrop closes;
 *   - pressing Escape closes;
 *   - while open, body scroll is locked so the page underneath
 *     doesn't bleed through trackpad inertia.
 */
import { useEffect } from 'react';
import { X } from 'lucide-react';
import { cn } from '@/lib/cn';

export interface DrawerProps {
  open: boolean;
  onClose: () => void;
  /** Rendered in the sticky header next to the close button. */
  title?: React.ReactNode;
  /** Optional aria-label for the dialog when `title` isn't a plain string. */
  ariaLabel?: string;
  children?: React.ReactNode;
  /** Override the default 480px panel width. */
  widthClassName?: string;
}

export function Drawer({
  open,
  onClose,
  title,
  ariaLabel,
  children,
  widthClassName,
}: DrawerProps) {
  // Esc-to-close + body-scroll lock while the drawer is open.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={ariaLabel ?? (typeof title === 'string' ? title : undefined)}
      className="fixed inset-0 z-40 flex justify-end"
    >
      {/* Backdrop ------------------------------------------------------ */}
      <button
        type="button"
        aria-label="close"
        tabIndex={-1}
        onClick={onClose}
        className="absolute inset-0 bg-black/50 transition-opacity"
      />

      {/* Panel --------------------------------------------------------- */}
      <div
        className={cn(
          'relative z-10 flex h-full flex-col',
          'border-l border-[--border] bg-[--bg-1] shadow-2xl',
          'animate-[drawer-slide-in_180ms_ease-out]',
          widthClassName ?? 'w-full sm:w-[480px]',
        )}
      >
        <header className="flex items-center justify-between gap-3 border-b border-[--border] px-4 py-3">
          <div className="min-w-0 flex-1 truncate text-sm text-[--text-1]">
            {title}
          </div>
          <button
            type="button"
            onClick={onClose}
            className={cn(
              'inline-flex h-8 w-8 items-center justify-center rounded-md',
              'text-[--text-2] hover:bg-[--bg-2] hover:text-[--text-1]',
              'focus:outline-none focus-visible:ring-1 focus-visible:ring-[--border-strong]',
            )}
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto">{children}</div>
      </div>
    </div>
  );
}

export default Drawer;
