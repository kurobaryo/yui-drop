/**
 * A centred modal dialog with a dimmed backdrop.
 *
 * Mirrors the prop signature of `Drawer.tsx` (`open`, `onClose`, `title`,
 * `children`) so call sites can swap one for the other in a single line.
 * Behaviour:
 *   - fixed-position overlay covers the viewport;
 *   - the panel is centred, capped at `max-w-3xl w-[90vw] max-h-[85vh]`;
 *   - clicking the dimmed backdrop closes;
 *   - pressing Escape closes;
 *   - while open, body scroll is locked so the page underneath
 *     doesn't bleed through trackpad inertia.
 *
 * The visual treatment intentionally matches the existing `EditExpiryModal`
 * pattern in `pages/admin/Files.tsx` — `bg-[--bg-1]` panel, `border-[--border]`,
 * `bg-[--bg-2]` accents — so dark/light themes keep working without
 * touching the CSS variable layer.
 */
import { useEffect } from 'react';
import { X } from 'lucide-react';
import { cn } from '@/lib/cn';

export interface ModalProps {
  open: boolean;
  onClose: () => void;
  /** Rendered in the sticky header next to the close button. */
  title?: React.ReactNode;
  /** Optional aria-label for the dialog when `title` isn't a plain string. */
  ariaLabel?: string;
  children?: React.ReactNode;
  /** Override the default `max-w-3xl w-[90vw]` panel width. */
  widthClassName?: string;
}

export function Modal({
  open,
  onClose,
  title,
  ariaLabel,
  children,
  widthClassName,
}: ModalProps) {
  // Esc-to-close + body-scroll lock while the modal is open.
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
      className="fixed inset-0 z-40 flex items-center justify-center p-4"
    >
      {/* Backdrop ------------------------------------------------------ */}
      <button
        type="button"
        aria-label="close"
        tabIndex={-1}
        onClick={onClose}
        className="absolute inset-0 bg-black/60 transition-opacity"
      />

      {/* Panel --------------------------------------------------------- */}
      <div
        className={cn(
          'relative z-10 flex max-h-[85vh] flex-col',
          'rounded-lg border border-[--border] bg-[--bg-1] shadow-2xl',
          widthClassName ?? 'w-[90vw] max-w-3xl',
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

export default Modal;
