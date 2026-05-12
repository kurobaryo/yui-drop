/**
 * Viewer — render whatever the server hands back for /share/select.
 *
 * The kind/content_type drives which subview we render:
 *   - image/* → <img>
 *   - application/pdf → <iframe>
 *   - video/* or audio/* → native players
 *   - text/plain → fetched body inside <pre>
 *   - text/markdown → fetched body sanitized via renderMarkdown
 *   - force_download === true → download-only screen
 *   - kind === 'text' → render res.text directly
 *   - anything else → "no preview, please download"
 */
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ArrowLeft, Download, Link2 } from 'lucide-react';
import { shareSelect, type ShareSelectResponse } from '@/lib/api/share';
import { ApiError } from '@/lib/api';
import { Header } from '@/components/layout/Header';
import { Footer } from '@/components/layout/Footer';
import { Button } from '@/components/ui/Button';
import { Spinner } from '@/components/ui/Spinner';
import { humanBytes } from '@/lib/format';
import { renderMarkdown } from '@/lib/markdown';
import { copyToClipboard } from '@/lib/clipboard';
import { toast } from '@/components/ui/Toast';

type LoadState =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'ok'; res: ShareSelectResponse };

function classifyContentType(ct: string | null): 'image' | 'pdf' | 'video' | 'audio' | 'text' | 'markdown' | 'other' {
  if (!ct) return 'other';
  if (ct.startsWith('image/')) return 'image';
  if (ct === 'application/pdf') return 'pdf';
  if (ct.startsWith('video/')) return 'video';
  if (ct.startsWith('audio/')) return 'audio';
  if (ct === 'text/markdown' || ct === 'text/x-markdown') return 'markdown';
  if (ct.startsWith('text/')) return 'text';
  return 'other';
}

export default function Viewer() {
  const { t } = useTranslation();
  const { code = '' } = useParams<{ code: string }>();
  const navigate = useNavigate();

  const [state, setState] = useState<LoadState>({ kind: 'loading' });
  const [textBody, setTextBody] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function run() {
      try {
        const res = await shareSelect(code);
        if (cancelled) return;
        setState({ kind: 'ok', res });
      } catch (e) {
        if (cancelled) return;
        const msg =
          e instanceof ApiError
            ? e.httpStatus === 404 || e.code === 4040
              ? t('viewer.notFound')
              : e.message || t('retrieve.genericError')
            : t('retrieve.genericError');
        setState({ kind: 'error', message: msg });
      }
    }
    void run();
    return () => {
      cancelled = true;
    };
  }, [code, t]);

  // Lazy-fetch text/markdown body when url is present.
  const textKind = useMemo(() => {
    if (state.kind !== 'ok') return null;
    if (state.res.kind !== 'file') return null;
    return classifyContentType(state.res.content_type);
  }, [state]);

  useEffect(() => {
    if (state.kind !== 'ok') return;
    if (!state.res.url) return;
    if (textKind !== 'text' && textKind !== 'markdown') return;
    let cancelled = false;
    fetch(state.res.url)
      .then((r) => r.text())
      .then((body) => {
        if (!cancelled) setTextBody(body);
      })
      .catch(() => {
        if (!cancelled) setTextBody(null);
      });
    return () => {
      cancelled = true;
    };
  }, [state, textKind]);

  // ── Render top-level states ───────────────────────────────────────────
  if (state.kind === 'loading') {
    return (
      <>
        <Header />
        <main className="mx-auto flex min-h-[50vh] max-w-3xl items-center justify-center px-4 md:px-6">
          <Spinner />
        </main>
        <Footer />
      </>
    );
  }
  if (state.kind === 'error') {
    return (
      <>
        <Header />
        <main className="mx-auto flex min-h-[50vh] max-w-3xl flex-col items-center justify-center px-4 md:px-6 text-center">
          <p className="text-[--text-2]">{state.message}</p>
          <Button
            variant="outline"
            className="mt-5"
            leftIcon={<ArrowLeft className="h-4 w-4" />}
            onClick={() => navigate('/')}
          >
            {t('notFound.back')}
          </Button>
        </main>
        <Footer />
      </>
    );
  }

  const res = state.res;

  async function copyLink() {
    const link =
      (typeof window !== 'undefined' ? window.location.origin : '') +
      `/s/${res.code}`;
    const ok = await copyToClipboard(link);
    if (ok) toast.success(t('common.copied'));
  }

  // ── Text drop (kind === 'text') ──────────────────────────────────────
  if (res.kind === 'text') {
    return (
      <>
        <Header />
        <main className="mx-auto max-w-3xl px-4 md:px-6 py-8">
          <div className="mb-4 flex items-center justify-between text-sm">
            <div className="font-mono text-[--text-2]">#{res.code}</div>
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                variant="outline"
                leftIcon={<Link2 className="h-3.5 w-3.5" />}
                onClick={copyLink}
              >
                {t('viewer.copyLink')}
              </Button>
            </div>
          </div>
          <pre className="whitespace-pre-wrap break-words rounded-lg border border-[--border] bg-[--bg-1] p-4 text-base text-[--text-1]">
            {res.text}
          </pre>
        </main>
        <Footer />
      </>
    );
  }

  // ── File drop ────────────────────────────────────────────────────────
  const url = res.url ?? '';
  const k = classifyContentType(res.content_type);

  return (
    <>
      <Header />
      <main className="mx-auto max-w-6xl px-4 md:px-6 py-6">
        {/* Toolbar */}
        <div className="mb-4 flex flex-wrap items-center gap-3 border-b border-[--border] pb-3">
          <div className="min-w-0 flex-1">
            <div className="truncate text-base font-medium text-[--text-1]">
              {res.name ?? '—'}
            </div>
            <div className="text-xs text-[--text-muted]">
              {res.size != null ? humanBytes(res.size) : ''}
              {res.content_type ? ` · ${res.content_type}` : ''}
            </div>
          </div>
          <div className="flex items-center gap-2">
            {url && (
              <a href={url} download={res.name ?? undefined}>
                <Button
                  size="sm"
                  variant="primary"
                  leftIcon={<Download className="h-3.5 w-3.5" />}
                >
                  {t('viewer.download')}
                </Button>
              </a>
            )}
            <Button
              size="sm"
              variant="outline"
              leftIcon={<Link2 className="h-3.5 w-3.5" />}
              onClick={copyLink}
            >
              {t('viewer.copyLink')}
            </Button>
            <Link to="/">
              <Button size="sm" variant="ghost">
                <ArrowLeft className="h-3.5 w-3.5" />
              </Button>
            </Link>
          </div>
        </div>

        {/* Body */}
        {res.force_download ? (
          <div className="rounded-lg border border-[--border] bg-[--bg-1] p-8 text-center text-[--text-2]">
            <p>{t('viewer.forceDownload')}</p>
            {url && (
              <a href={url} download={res.name ?? undefined} className="mt-4 inline-block">
                <Button
                  variant="primary"
                  leftIcon={<Download className="h-4 w-4" />}
                >
                  {t('viewer.download')}
                </Button>
              </a>
            )}
          </div>
        ) : !url ? (
          <div className="rounded-lg border border-[--border] bg-[--bg-1] p-8 text-center text-[--text-2]">
            {t('viewer.noPreview')}
          </div>
        ) : k === 'image' ? (
          <div className="flex justify-center">
            <img
              src={url}
              alt={res.name ?? ''}
              className="max-h-[80vh] max-w-full rounded-lg border border-[--border]"
            />
          </div>
        ) : k === 'pdf' ? (
          <iframe
            src={url}
            title={res.name ?? 'pdf'}
            className="h-[80vh] w-full rounded-lg border border-[--border] bg-[--bg-1]"
          />
        ) : k === 'video' ? (
          <video
            src={url}
            controls
            className="max-h-[80vh] w-full rounded-lg border border-[--border] bg-black"
          />
        ) : k === 'audio' ? (
          <audio src={url} controls className="w-full" />
        ) : k === 'text' ? (
          textBody == null ? (
            <div className="flex justify-center py-10">
              <Spinner />
            </div>
          ) : (
            <pre className="max-h-[80vh] overflow-auto whitespace-pre-wrap break-words rounded-lg border border-[--border] bg-[--bg-1] p-4 text-sm text-[--text-1]">
              {textBody}
            </pre>
          )
        ) : k === 'markdown' ? (
          textBody == null ? (
            <div className="flex justify-center py-10">
              <Spinner />
            </div>
          ) : (
            <div
              className="prose prose-invert max-w-none rounded-lg border border-[--border] bg-[--bg-1] p-5 text-[--text-1]"
              // renderMarkdown sanitizes via DOMPurify.
              dangerouslySetInnerHTML={{ __html: renderMarkdown(textBody) }}
            />
          )
        ) : (
          <div className="rounded-lg border border-[--border] bg-[--bg-1] p-8 text-center text-[--text-2]">
            {t('viewer.noPreview')}
          </div>
        )}
      </main>
      <Footer />
    </>
  );
}
