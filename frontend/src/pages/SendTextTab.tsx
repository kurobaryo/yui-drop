/**
 * SendTextTab — paste/type a snippet, choose expiry, submit, show big code.
 */
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Copy, RotateCcw } from 'lucide-react';
import { shareText, type ExpireStyle } from '@/lib/api/share';
import { ApiError } from '@/lib/api';
import { usePublicConfig } from '@/lib/hooks/usePublicConfig';
import { Button } from '@/components/ui/Button';
import { Select } from '@/components/ui/Select';
import { copyToClipboard } from '@/lib/clipboard';
import { toast } from '@/components/ui/Toast';
import { pushRecent } from '@/lib/recent';
import { humanBytes } from '@/lib/format';
import { cn } from '@/lib/cn';

interface ExpireChoice {
  value: number;
  style: ExpireStyle;
  labelKey: string;
}

const EXPIRE_CHOICES: ExpireChoice[] = [
  { value: 1, style: 'day', labelKey: 'sendFile.expireDay' },
  { value: 1, style: 'week', labelKey: 'sendFile.expireWeek' },
  { value: 1, style: 'month', labelKey: 'sendFile.expireMonth' },
  { value: 5, style: 'count', labelKey: 'sendFile.expireCount' },
  { value: 0, style: 'forever', labelKey: 'sendFile.expireForever' },
];

// Approximate byte size of a UTF-8 string without spinning up a TextEncoder
// on every keystroke. The encoder is cheap, so let's just use it.
function utf8Size(s: string): number {
  if (typeof TextEncoder === 'undefined') return s.length;
  return new TextEncoder().encode(s).length;
}

export default function SendTextTab() {
  const { t } = useTranslation();
  const config = usePublicConfig();

  const [text, setText] = useState('');
  const [choiceIdx, setChoiceIdx] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<{ code: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const bytes = utf8Size(text);
  const overLimit = bytes > config.max_text_bytes;

  async function submit() {
    if (submitting || !text || overLimit) return;
    const choice = EXPIRE_CHOICES[choiceIdx]!;
    setSubmitting(true);
    setError(null);
    try {
      const res = await shareText({
        text,
        expire_value: choice.value,
        expire_style: choice.style,
      });
      setResult({ code: res.code });
      pushRecent({
        code: res.code,
        kind: 'text',
        name: null,
        size: bytes,
        type: 'text/plain',
        created_at: new Date().toISOString(),
        expires_at: res.expired_at,
      });
    } catch (e) {
      if (e instanceof ApiError)
        setError(e.message || t('retrieve.genericError'));
      else setError(t('retrieve.genericError'));
    } finally {
      setSubmitting(false);
    }
  }

  function reset() {
    setText('');
    setResult(null);
    setError(null);
  }

  if (result) {
    return (
      <div className="flex flex-col items-center text-center">
        <div className="text-xs uppercase tracking-wider text-[--text-2] mb-2">
          {t('sendFile.code')}
        </div>
        <div className="font-mono text-5xl md:text-6xl font-bold text-[--text-1] tracking-widest">
          {result.code}
        </div>
        <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
          <Button
            size="md"
            variant="outline"
            leftIcon={<Copy className="h-4 w-4" />}
            onClick={async () => {
              const ok = await copyToClipboard(result.code);
              if (ok) toast.success(t('common.copied'));
            }}
          >
            {t('sendFile.copy')}
          </Button>
          <Button
            size="md"
            variant="ghost"
            leftIcon={<RotateCcw className="h-4 w-4" />}
            onClick={reset}
          >
            {t('sendFile.another')}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={t('sendText.placeholder', {
          max: humanBytes(config.max_text_bytes),
        })}
        rows={8}
        className={cn(
          'w-full rounded-md bg-[--bg-1] text-[--text-1] p-3',
          'border border-[--border] resize-y min-h-[160px]',
          'placeholder:text-[--text-muted]',
          'focus:outline-none focus:border-[hsl(var(--accent-h)_var(--accent-s)_var(--accent-l))]',
          'focus:ring-1 focus:ring-[hsl(var(--accent-h)_var(--accent-s)_var(--accent-l))]',
          overLimit && 'border-red-500/60 focus:border-red-500 focus:ring-red-500',
        )}
      />
      <div className="flex items-center justify-between text-xs">
        <span
          className={cn(
            'text-[--text-muted]',
            overLimit && 'text-red-400',
          )}
        >
          {humanBytes(bytes)} / {humanBytes(config.max_text_bytes)}
        </span>
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-[1fr_auto]">
        <label className="flex flex-col gap-1">
          <span className="text-xs text-[--text-2]">{t('sendFile.expire')}</span>
          <Select
            value={choiceIdx}
            onChange={(e) => setChoiceIdx(Number(e.target.value))}
            disabled={submitting}
          >
            {EXPIRE_CHOICES.map((c, i) => (
              <option key={i} value={i}>
                {t(c.labelKey)}
              </option>
            ))}
          </Select>
        </label>
        <div className="flex items-end">
          <Button
            variant="primary"
            size="md"
            loading={submitting}
            disabled={!text || overLimit}
            onClick={() => void submit()}
          >
            {t('sendFile.upload')}
          </Button>
        </div>
      </div>

      {overLimit && (
        <p className="text-sm text-red-400" role="alert">
          {t('sendText.tooLong', { max: humanBytes(config.max_text_bytes) })}
        </p>
      )}
      {error && (
        <p className="text-sm text-red-400" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
