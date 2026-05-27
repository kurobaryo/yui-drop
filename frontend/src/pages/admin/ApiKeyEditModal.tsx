/**
 * ApiKeyEditModal — patch an existing API key.
 *
 * Pre-populates from `initial`. On submit, sends only the fields that
 * actually changed (PATCH semantics: omitted = leave alone). The
 * "Clear expiry" checkbox maps to the explicit `clear_expires_at: true`
 * flag in the request body.
 */
import { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';

import {
  updateApiKey,
  type ApiKeyListItem,
  type ApiKeyScope,
  type ApiKeyUpdateRequest,
} from '@/lib/api/adminApiKeys';
import { ApiError } from '@/lib/api';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { toast } from '@/components/ui/Toast';
import { humanBytes } from '@/lib/format';

interface ApiKeyEditModalProps {
  open: boolean;
  onClose: () => void;
  initial: ApiKeyListItem | null;
}

interface FormState {
  note: string;
  scopes: ApiKeyScope[];
  quota_daily_bytes: number;
  quota_per_minute: number;
  max_file_size: number;
  expires_at_local: string; // <input type=datetime-local> value, '' = none
  clear_expires_at: boolean;
}

/**
 * Convert an ISO timestamp to the `<input type="datetime-local">` value
 * format (YYYY-MM-DDTHH:mm in local time). Returns '' when input is null.
 */
function isoToLocalInput(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n: number) => n.toString().padStart(2, '0');
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `T${pad(d.getHours())}:${pad(d.getMinutes())}`
  );
}

function localInputToIso(local: string): string | null {
  if (!local) return null;
  const d = new Date(local);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

function buildFormFromInitial(initial: ApiKeyListItem | null): FormState {
  return {
    note: initial?.note ?? '',
    scopes: initial?.scopes ?? ['upload', 'read'],
    quota_daily_bytes: initial?.quota_daily_bytes ?? 0,
    quota_per_minute: initial?.quota_per_minute ?? 0,
    max_file_size: initial?.max_file_size ?? 0,
    expires_at_local: isoToLocalInput(initial?.expires_at ?? null),
    clear_expires_at: false,
  };
}

export default function ApiKeyEditModal({
  open,
  onClose,
  initial,
}: ApiKeyEditModalProps) {
  const qc = useQueryClient();
  const [form, setForm] = useState<FormState>(() =>
    buildFormFromInitial(initial),
  );

  // Re-seed the form whenever a different row is opened.
  useEffect(() => {
    setForm(buildFormFromInitial(initial));
  }, [initial]);

  const mut = useMutation({
    mutationFn: ({ pk, body }: { pk: number; body: ApiKeyUpdateRequest }) =>
      updateApiKey(pk, body),
    onSuccess: () => {
      toast.success('API key updated');
      qc.invalidateQueries({ queryKey: ['admin', 'api-keys'] });
      onClose();
    },
    onError: (e) =>
      toast.error(e instanceof ApiError ? e.message : String(e)),
  });

  function toggleScope(scope: ApiKeyScope) {
    setForm((f) => ({
      ...f,
      scopes: f.scopes.includes(scope)
        ? f.scopes.filter((s) => s !== scope)
        : [...f.scopes, scope],
    }));
  }

  function submit() {
    if (!initial) return;
    const body: ApiKeyUpdateRequest = {};

    const noteNorm = form.note.trim() === '' ? null : form.note.trim();
    if (noteNorm !== (initial.note ?? null)) body.note = noteNorm;

    // Scope diff: compare as sorted-joined strings.
    const a = [...form.scopes].sort().join(',');
    const b = [...initial.scopes].sort().join(',');
    if (a !== b) body.scopes = form.scopes;

    if (form.quota_daily_bytes !== initial.quota_daily_bytes)
      body.quota_daily_bytes = form.quota_daily_bytes;
    if (form.quota_per_minute !== initial.quota_per_minute)
      body.quota_per_minute = form.quota_per_minute;
    if (form.max_file_size !== initial.max_file_size)
      body.max_file_size = form.max_file_size;

    if (form.clear_expires_at) {
      body.clear_expires_at = true;
    } else {
      const newIso = localInputToIso(form.expires_at_local);
      // Only send when the moment actually changed.
      const oldMs = initial.expires_at
        ? new Date(initial.expires_at).getTime()
        : null;
      const newMs = newIso ? new Date(newIso).getTime() : null;
      if (oldMs !== newMs && newIso !== null) {
        body.expires_at = newIso;
      }
    }

    if (Object.keys(body).length === 0) {
      toast.info('No changes to save');
      onClose();
      return;
    }

    mut.mutate({ pk: initial.id, body });
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={
        initial ? (
          <span>
            Edit key <span className="font-mono">{initial.key_id}</span>
          </span>
        ) : (
          'Edit API key'
        )
      }
      widthClassName="w-[90vw] max-w-xl"
    >
      <div className="p-4 space-y-4">
        <div>
          <label className="text-xs uppercase tracking-wider text-[--text-2]">
            Note
          </label>
          <Input
            inputSize="sm"
            value={form.note}
            onChange={(e) =>
              setForm((f) => ({ ...f, note: e.target.value }))
            }
            className="mt-1"
          />
        </div>

        <div>
          <label className="text-xs uppercase tracking-wider text-[--text-2]">
            Scopes
          </label>
          <div className="mt-1 flex gap-4">
            {(['upload', 'read'] as ApiKeyScope[]).map((scope) => (
              <label
                key={scope}
                className="inline-flex items-center gap-2 text-sm text-[--text-1] cursor-pointer"
              >
                <input
                  type="checkbox"
                  checked={form.scopes.includes(scope)}
                  onChange={() => toggleScope(scope)}
                />
                {scope}
              </label>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs uppercase tracking-wider text-[--text-2]">
              Daily quota (bytes)
            </label>
            <Input
              inputSize="sm"
              type="number"
              min={0}
              value={form.quota_daily_bytes}
              onChange={(e) =>
                setForm((f) => ({
                  ...f,
                  quota_daily_bytes: Number(e.target.value),
                }))
              }
              className="mt-1"
            />
            <div className="mt-1 text-xs text-[--text-2]">
              {humanBytes(form.quota_daily_bytes)} per day
            </div>
          </div>

          <div>
            <label className="text-xs uppercase tracking-wider text-[--text-2]">
              Max file size (bytes)
            </label>
            <Input
              inputSize="sm"
              type="number"
              min={0}
              value={form.max_file_size}
              onChange={(e) =>
                setForm((f) => ({
                  ...f,
                  max_file_size: Number(e.target.value),
                }))
              }
              className="mt-1"
            />
            <div className="mt-1 text-xs text-[--text-2]">
              {humanBytes(form.max_file_size)} per file
            </div>
          </div>

          <div>
            <label className="text-xs uppercase tracking-wider text-[--text-2]">
              Requests / minute
            </label>
            <Input
              inputSize="sm"
              type="number"
              min={1}
              value={form.quota_per_minute}
              onChange={(e) =>
                setForm((f) => ({
                  ...f,
                  quota_per_minute: Number(e.target.value),
                }))
              }
              className="mt-1"
            />
          </div>

          <div>
            <label className="text-xs uppercase tracking-wider text-[--text-2]">
              Expires at
            </label>
            <Input
              inputSize="sm"
              type="datetime-local"
              disabled={form.clear_expires_at}
              value={form.expires_at_local}
              onChange={(e) =>
                setForm((f) => ({
                  ...f,
                  expires_at_local: e.target.value,
                }))
              }
              className="mt-1"
            />
            <label className="mt-1 inline-flex items-center gap-2 text-xs text-[--text-2] cursor-pointer">
              <input
                type="checkbox"
                checked={form.clear_expires_at}
                onChange={(e) =>
                  setForm((f) => ({
                    ...f,
                    clear_expires_at: e.target.checked,
                  }))
                }
              />
              Clear expiry (never expires)
            </label>
          </div>
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={submit}
            loading={mut.isPending}
            disabled={!initial || form.scopes.length === 0}
          >
            Save changes
          </Button>
        </div>
      </div>
    </Modal>
  );
}
