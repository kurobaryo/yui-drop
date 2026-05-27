/**
 * ApiKeyIssueModal — two-phase modal for minting a fresh API key.
 *
 * Phase "form":   operator fills note / scopes / quota / expiry, hits Issue.
 * Phase "result": shows the plaintext secret exactly once with a Copy button
 *                 and a loud red warning. Closing this view wipes the
 *                 plaintext from memory and resets the form for next open.
 */
import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Copy, AlertTriangle, CheckCircle2 } from 'lucide-react';

import {
  createApiKey,
  type ApiKeyCreateRequest,
  type ApiKeyCreateResponse,
  type ApiKeyScope,
} from '@/lib/api/adminApiKeys';
import { ApiError } from '@/lib/api';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { toast } from '@/components/ui/Toast';
import { humanBytes } from '@/lib/format';

interface ApiKeyIssueModalProps {
  open: boolean;
  onClose: () => void;
}

interface FormState {
  note: string;
  scopes: ApiKeyScope[];
  quota_daily_bytes: number;
  quota_per_minute: number;
  max_file_size: number;
  expires_in_days: number;
  neverExpires: boolean;
}

const DEFAULT_FORM: FormState = {
  note: '',
  scopes: ['upload', 'read'],
  quota_daily_bytes: 5_368_709_120, // 5 GiB
  quota_per_minute: 30,
  max_file_size: 524_288_000, // 500 MiB
  expires_in_days: 365,
  neverExpires: false,
};

export default function ApiKeyIssueModal({
  open,
  onClose,
}: ApiKeyIssueModalProps) {
  const qc = useQueryClient();
  const [form, setForm] = useState<FormState>(DEFAULT_FORM);
  const [issued, setIssued] = useState<ApiKeyCreateResponse | null>(null);
  const [copied, setCopied] = useState(false);

  const mut = useMutation({
    mutationFn: (body: ApiKeyCreateRequest) => createApiKey(body),
    onSuccess: (created) => {
      setIssued(created);
      qc.invalidateQueries({ queryKey: ['admin', 'api-keys'] });
    },
    onError: (e) =>
      toast.error(e instanceof ApiError ? e.message : String(e)),
  });

  function handleClose() {
    onClose();
    // Reset on every close so the next open is a blank slate. Defer so the
    // exit animation (if any) doesn't see content flash.
    setTimeout(() => {
      setForm(DEFAULT_FORM);
      setIssued(null);
      setCopied(false);
      // Clear react-query's mutation cache so the plaintext doesn't linger
      // on mut.data after the dialog closes.
      mut.reset();
    }, 50);
  }

  function toggleScope(scope: ApiKeyScope) {
    setForm((f) => ({
      ...f,
      scopes: f.scopes.includes(scope)
        ? f.scopes.filter((s) => s !== scope)
        : [...f.scopes, scope],
    }));
  }

  function submit() {
    const body: ApiKeyCreateRequest = {
      note: form.note.trim() || null,
      scopes: form.scopes,
      quota_daily_bytes: form.quota_daily_bytes,
      quota_per_minute: form.quota_per_minute,
      max_file_size: form.max_file_size,
      expires_in_days: form.neverExpires ? null : form.expires_in_days,
    };
    mut.mutate(body);
  }

  async function copyPlaintext() {
    if (!issued) return;
    try {
      await navigator.clipboard.writeText(issued.plaintext);
      setCopied(true);
      toast.success('Copied to clipboard');
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error('Copy failed — select the text manually');
    }
  }

  return (
    <Modal
      open={open}
      onClose={handleClose}
      title={issued ? 'API key issued' : 'Issue a new API key'}
      widthClassName="w-[90vw] max-w-xl"
    >
      <div className="p-4 space-y-4">
        {issued ? (
          // ── Result phase ─────────────────────────────────────────────
          <>
            <div className="flex items-start gap-2 rounded-md border border-red-500/50 bg-red-500/5 p-3 text-sm text-red-200">
              <AlertTriangle className="h-5 w-5 shrink-0" />
              <div>
                <strong className="block">
                  This is the only time this key will be shown.
                </strong>
                Save it to your password manager now — closing this dialog will
                discard the plaintext forever.
              </div>
            </div>

            <div>
              <label className="text-xs uppercase tracking-wider text-[--text-2]">
                Plaintext secret
              </label>
              <div className="mt-1 rounded-md border border-[--border] bg-[--bg-2] p-3 font-mono text-sm text-[--text-1] break-all select-all">
                {issued.plaintext}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <div className="text-xs text-[--text-2]">Key ID</div>
                <div className="font-mono text-[--text-1]">{issued.key_id}</div>
              </div>
              <div>
                <div className="text-xs text-[--text-2]">Note</div>
                <div className="text-[--text-1]">{issued.note ?? '—'}</div>
              </div>
              <div>
                <div className="text-xs text-[--text-2]">Scopes</div>
                <div className="text-[--text-1]">
                  {issued.scopes.join(', ')}
                </div>
              </div>
              <div>
                <div className="text-xs text-[--text-2]">Expires</div>
                <div className="text-[--text-1]">
                  {issued.expires_at ?? 'Never'}
                </div>
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <Button
                variant="outline"
                leftIcon={
                  copied ? (
                    <CheckCircle2 className="h-4 w-4" />
                  ) : (
                    <Copy className="h-4 w-4" />
                  )
                }
                onClick={copyPlaintext}
              >
                {copied ? 'Copied' : 'Copy'}
              </Button>
              <Button variant="primary" onClick={handleClose}>
                I've saved it
              </Button>
            </div>
          </>
        ) : (
          // ── Form phase ───────────────────────────────────────────────
          <>
            <div>
              <label className="text-xs uppercase tracking-wider text-[--text-2]">
                Note
              </label>
              <Input
                inputSize="sm"
                placeholder="What is this key for?"
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
                  Expires in (days)
                </label>
                <Input
                  inputSize="sm"
                  type="number"
                  min={1}
                  disabled={form.neverExpires}
                  value={form.expires_in_days}
                  onChange={(e) =>
                    setForm((f) => ({
                      ...f,
                      expires_in_days: Number(e.target.value),
                    }))
                  }
                  className="mt-1"
                />
                <label className="mt-1 inline-flex items-center gap-2 text-xs text-[--text-2] cursor-pointer">
                  <input
                    type="checkbox"
                    checked={form.neverExpires}
                    onChange={(e) =>
                      setForm((f) => ({
                        ...f,
                        neverExpires: e.target.checked,
                      }))
                    }
                  />
                  Never expires
                </label>
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <Button variant="ghost" onClick={handleClose}>
                Cancel
              </Button>
              <Button
                variant="primary"
                onClick={submit}
                loading={mut.isPending}
                disabled={form.scopes.length === 0}
              >
                Issue key
              </Button>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
