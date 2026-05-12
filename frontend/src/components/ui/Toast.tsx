/**
 * Toast — minimal global notification stack.
 *
 * Usage:
 *   import { toast, ToastProvider } from '@/components/ui/Toast';
 *   toast.success('Copied!');
 *
 * Mount <ToastProvider /> once near the root (we do it in <App />).
 */
import { useEffect } from 'react';
import { create } from 'zustand';
import { CheckCircle2, Info, XCircle, X } from 'lucide-react';
import { cn } from '@/lib/cn';

export type ToastKind = 'success' | 'error' | 'info';

export interface ToastItem {
  id: number;
  kind: ToastKind;
  message: string;
  /** ms before auto-dismiss; 0 disables auto-dismiss. */
  duration: number;
}

interface ToastState {
  items: ToastItem[];
  push: (t: Omit<ToastItem, 'id'>) => number;
  dismiss: (id: number) => void;
}

let nextId = 1;

const useToastStore = create<ToastState>((set) => ({
  items: [],
  push: (t) => {
    const id = nextId++;
    set((s) => ({ items: [...s.items, { id, ...t }] }));
    return id;
  },
  dismiss: (id) =>
    set((s) => ({ items: s.items.filter((x) => x.id !== id) })),
}));

function pushToast(kind: ToastKind, message: string, duration = 3200): number {
  return useToastStore.getState().push({ kind, message, duration });
}

/** Imperative facade. */
export const toast = {
  success: (msg: string, duration?: number) =>
    pushToast('success', msg, duration),
  error: (msg: string, duration?: number) =>
    pushToast('error', msg, duration),
  info: (msg: string, duration?: number) => pushToast('info', msg, duration),
  dismiss: (id: number) => useToastStore.getState().dismiss(id),
};

const KIND_STYLES: Record<ToastKind, string> = {
  success: 'border-emerald-500/40 text-emerald-200',
  error: 'border-red-500/40 text-red-200',
  info: 'border-[--border-strong] text-[--text-1]',
};

function KindIcon({ kind }: { kind: ToastKind }) {
  if (kind === 'success') return <CheckCircle2 className="h-4 w-4 text-emerald-400" />;
  if (kind === 'error') return <XCircle className="h-4 w-4 text-red-400" />;
  return <Info className="h-4 w-4 text-[--text-2]" />;
}

function ToastRow({ item }: { item: ToastItem }) {
  const dismiss = useToastStore((s) => s.dismiss);
  useEffect(() => {
    if (!item.duration) return;
    const t = window.setTimeout(() => dismiss(item.id), item.duration);
    return () => window.clearTimeout(t);
  }, [item.id, item.duration, dismiss]);

  return (
    <div
      role="status"
      className={cn(
        'pointer-events-auto flex items-start gap-2',
        'min-w-[240px] max-w-sm rounded-md border bg-[--bg-1] px-3 py-2 shadow-lg',
        'animate-fadeUp',
        KIND_STYLES[item.kind],
      )}
    >
      <div className="mt-0.5 shrink-0">
        <KindIcon kind={item.kind} />
      </div>
      <div className="flex-1 text-sm break-words">{item.message}</div>
      <button
        type="button"
        onClick={() => dismiss(item.id)}
        className="shrink-0 rounded p-0.5 text-[--text-muted] hover:text-[--text-1]"
        aria-label="dismiss"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

export function ToastProvider() {
  const items = useToastStore((s) => s.items);
  return (
    <div
      aria-live="polite"
      className="pointer-events-none fixed bottom-4 right-4 z-50 flex flex-col gap-2"
    >
      {items.map((it) => (
        <ToastRow key={it.id} item={it} />
      ))}
    </div>
  );
}

export default ToastProvider;
