/**
 * RetrieveTab — OTP input → shareSelect → either navigate to /v/:code (file)
 * or open a modal with the text payload (text drop).
 */
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { shareSelect } from '@/lib/api/share';
import { ApiError } from '@/lib/api';
import { OtpInput } from '@/components/ui/OtpInput';
import { Button } from '@/components/ui/Button';
import { Spinner } from '@/components/ui/Spinner';
import { copyToClipboard } from '@/lib/clipboard';
import { toast } from '@/components/ui/Toast';
import { pushRecent } from '@/lib/recent';
import { cn } from '@/lib/cn';

export default function RetrieveTab() {
  const { t } = useTranslation();
  const navigate = useNavigate();

  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // For text drops: show the text in a modal.
  const [textPayload, setTextPayload] = useState<{ code: string; text: string } | null>(
    null,
  );

  async function lookup(value: string) {
    if (loading) return;
    setLoading(true);
    setError(null);
    try {
      const res = await shareSelect(value);
      // Remember it locally regardless of kind.
      pushRecent({
        code: res.code,
        kind: res.kind,
        name: res.name,
        size: res.size,
        type: res.content_type,
        created_at: new Date().toISOString(),
        expires_at: res.expired_at,
      });
      if (res.kind === 'text') {
        setTextPayload({ code: res.code, text: res.text ?? '' });
      } else {
        navigate(`/v/${res.code}`);
      }
    } catch (e) {
      if (e instanceof ApiError) {
        if (e.httpStatus === 429) setError(t('retrieve.rateLimited'));
        else if (e.httpStatus === 404 || e.code === 4040)
          setError(t('retrieve.notFound'));
        else setError(e.message || t('retrieve.genericError'));
      } else {
        setError(t('retrieve.genericError'));
      }
    } finally {
      setLoading(false);
    }
  }

  async function copyText() {
    if (!textPayload) return;
    const ok = await copyToClipboard(textPayload.text);
    if (ok) toast.success(t('common.copied'));
  }

  return (
    <div className="flex flex-col items-center">
      <p className="mb-4 text-sm text-[--text-2]">{t('retrieve.label')}</p>
      <OtpInput
        value={code}
        onChange={(v) => {
          setCode(v);
          if (error) setError(null);
        }}
        onComplete={(v) => void lookup(v)}
        autoFocus
        disabled={loading}
        hasError={!!error}
      />
      <div className="mt-3 h-5 text-center text-xs">
        {loading ? (
          <span className="inline-flex items-center gap-1.5 text-[--text-2]">
            <Spinner size={12} />
            {t('retrieve.loading')}
          </span>
        ) : error ? (
          <span className="text-red-400">{error}</span>
        ) : (
          <span className="text-[--text-muted]">{t('retrieve.pasteHint')}</span>
        )}
      </div>

      {/* Text payload modal. */}
      {textPayload && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-40 flex items-center justify-center bg-black/50 p-4"
          onClick={() => setTextPayload(null)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className={cn(
              'relative w-full max-w-2xl rounded-lg border border-[--border]',
              'bg-[--bg-1] p-5 shadow-xl',
            )}
          >
            <div className="mb-3 flex items-center justify-between">
              <div className="font-mono text-[--text-2]">
                #{textPayload.code}
              </div>
              <div className="flex items-center gap-2">
                <Button size="sm" variant="outline" onClick={copyText}>
                  {t('common.copy')}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setTextPayload(null)}
                >
                  {t('common.close')}
                </Button>
              </div>
            </div>
            <pre className="max-h-[60vh] overflow-auto whitespace-pre-wrap break-words rounded bg-[--bg-2] p-3 text-base text-[--text-1]">
              {textPayload.text}
            </pre>
          </div>
        </div>
      )}
    </div>
  );
}
