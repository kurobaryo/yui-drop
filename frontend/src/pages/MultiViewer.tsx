/**
 * MultiViewer — file-list view for kind=multi shares.
 *
 * Renders:
 *   - header with pickup code + "{n} files · {humanSize(total)}"
 *   - select-all checkbox + "Download selected" action
 *   - one row per file: order, icon, name, size, Preview, Download
 *   - per-file preview modal (image / pdf / video / audio / text / markdown)
 *
 * "Download selected" iterates the selected files and triggers a hidden
 * <a download> for each, with a small inter-file delay so browsers don't
 * collapse the requests. Server-side zip is future work.
 */
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  ArrowLeft,
  Download,
  FileText,
  FileImage,
  FileAudio,
  FileVideo,
  FileArchive,
  FileCode,
  File as FileIcon,
  Eye,
  Link2,
} from 'lucide-react';
import {
  shareSelect,
  type ShareMultiFile,
  type ShareSelectResponse,
} from '@/lib/api/share';
import { ApiError } from '@/lib/api';
import { Header } from '@/components/layout/Header';
import { Footer } from '@/components/layout/Footer';
import { Button } from '@/components/ui/Button';
import { Spinner } from '@/components/ui/Spinner';
import { humanBytes } from '@/lib/format';
import { renderMarkdown } from '@/lib/markdown';
import { copyToClipboard } from '@/lib/clipboard';
import { toast } from '@/components/ui/Toast';
import { cn } from '@/lib/cn';

type LoadState =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'ok'; res: ShareSelectResponse };

type PreviewKind =
  | 'image'
  | 'pdf'
  | 'video'
  | 'audio'
  | 'text'
  | 'markdown'
  | 'other';

function classifyContentType(ct: string | null): PreviewKind {
  if (!ct) return 'other';
  if (ct.startsWith('image/')) return 'image';
  if (ct === 'application/pdf') return 'pdf';
  if (ct.startsWith('video/')) return 'video';
  if (ct.startsWith('audio/')) return 'audio';
  if (ct === 'text/markdown' || ct === 'text/x-markdown') return 'markdown';
  if (ct.startsWith('text/')) return 'text';
  return 'other';
}

const ARCHIVE_EXTS = new Set([
  'zip',
  '7z',
  'rar',
  'tar',
  'gz',
  'bz2',
  'xz',
  'tgz',
  'tbz',
]);
const CODE_EXTS = new Set([
  'js',
  'jsx',
  'ts',
  'tsx',
  'py',
  'rb',
  'go',
  'rs',
  'java',
  'kt',
  'c',
  'cpp',
  'h',
  'hpp',
  'cs',
  'php',
  'sh',
  'bash',
  'json',
  'yaml',
  'yml',
  'toml',
  'xml',
  'html',
  'css',
  'scss',
  'sql',
]);
const DOC_EXTS = new Set([
  'pdf',
  'doc',
  'docx',
  'xls',
  'xlsx',
  'ppt',
  'pptx',
  'odt',
  'ods',
  'odp',
  'txt',
  'md',
  'rtf',
]);

function extOf(name: string): string {
  const dot = name.lastIndexOf('.');
  if (dot < 0) return '';
  return name.slice(dot + 1).toLowerCase();
}

function pickIcon(name: string, ct: string | null) {
  const k = classifyContentType(ct);
  if (k === 'image') return FileImage;
  if (k === 'video') return FileVideo;
  if (k === 'audio') return FileAudio;
  if (k === 'pdf') return FileText;
  const ext = extOf(name);
  if (ARCHIVE_EXTS.has(ext)) return FileArchive;
  if (CODE_EXTS.has(ext)) return FileCode;
  if (DOC_EXTS.has(ext)) return FileText;
  if (k === 'text' || k === 'markdown') return FileText;
  return FileIcon;
}

function isPreviewable(ct: string | null): boolean {
  const k = classifyContentType(ct);
  return (
    k === 'image' ||
    k === 'pdf' ||
    k === 'video' ||
    k === 'audio' ||
    k === 'text' ||
    k === 'markdown'
  );
}

/** Click an invisible <a download> so the browser triggers the save flow. */
function triggerDownload(url: string, name: string) {
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

export default function MultiViewer() {
  const { t } = useTranslation();
  const { code = '' } = useParams<{ code: string }>();
  const navigate = useNavigate();

  const [state, setState] = useState<LoadState>({ kind: 'loading' });
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [preview, setPreview] = useState<ShareMultiFile | null>(null);

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
  // If the share isn't actually multi (defensive), fall back to single Viewer.
  if (res.kind !== 'multi' || !res.files) {
    return (
      <>
        <Header />
        <main className="mx-auto flex min-h-[50vh] max-w-3xl flex-col items-center justify-center px-4 md:px-6 text-center">
          <p className="text-[--text-2]">{t('viewer.notFound')}</p>
          <Link to={`/v/${res.code}`} className="mt-5">
            <Button variant="outline">{t('viewer.download')}</Button>
          </Link>
        </main>
        <Footer />
      </>
    );
  }

  const files = res.files;
  const total = res.total_size ?? files.reduce((a, f) => a + f.size, 0);
  const allSelected = selected.size === files.length && files.length > 0;
  const anySelected = selected.size > 0;

  function toggle(id: number) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    if (allSelected) {
      setSelected(new Set());
    } else {
      setSelected(new Set(files.map((f) => f.file_id)));
    }
  }

  async function downloadSelected() {
    const chosen = files.filter((f) => selected.has(f.file_id) && f.url);
    for (let i = 0; i < chosen.length; i++) {
      const f = chosen[i]!;
      triggerDownload(f.url!, f.name);
      // Small stagger so browsers don't squash concurrent downloads.
      if (i < chosen.length - 1) {
        await new Promise((r) => setTimeout(r, 350));
      }
    }
  }

  async function copyLink() {
    const link =
      (typeof window !== 'undefined' ? window.location.origin : '') +
      `/s/${res.code}`;
    const ok = await copyToClipboard(link);
    if (ok) toast.success(t('common.copied'));
  }

  return (
    <>
      <Header />
      <main className="mx-auto max-w-6xl px-4 md:px-6 py-6">
        <div className="mb-4 flex flex-wrap items-center gap-3 border-b border-[--border] pb-3">
          <div className="min-w-0 flex-1">
            <div className="font-mono text-[--text-2]">#{res.code}</div>
            <div className="text-xs text-[--text-muted]">
              {t('sendFileMulti.summary', {
                n: res.file_count ?? files.length,
                size: humanBytes(total),
              })}
            </div>
          </div>
          <div className="flex items-center gap-2">
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

        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <label className="inline-flex items-center gap-2 text-sm text-[--text-2]">
            <input
              type="checkbox"
              checked={allSelected}
              onChange={toggleAll}
              className="h-4 w-4 accent-[hsl(var(--accent-h)_var(--accent-s)_var(--accent-l))]"
            />
            <span>{t('multiViewer.selectAll')}</span>
            {anySelected && (
              <span className="text-xs text-[--text-muted]">
                ({selected.size}/{files.length})
              </span>
            )}
          </label>
          <Button
            size="sm"
            variant="primary"
            disabled={!anySelected}
            leftIcon={<Download className="h-3.5 w-3.5" />}
            onClick={() => void downloadSelected()}
          >
            {t('multiViewer.downloadSelected')}
          </Button>
        </div>

        <ul className="divide-y divide-[--border] rounded-lg border border-[--border] bg-[--bg-1]">
          {files.map((f) => {
            const Icon = pickIcon(f.name, f.content_type);
            const previewable = isPreviewable(f.content_type) && !!f.url && !f.force_download;
            return (
              <li
                key={f.file_id}
                className="flex items-center gap-3 px-3 py-2.5 text-sm"
              >
                <input
                  type="checkbox"
                  checked={selected.has(f.file_id)}
                  onChange={() => toggle(f.file_id)}
                  className="h-4 w-4 shrink-0 accent-[hsl(var(--accent-h)_var(--accent-s)_var(--accent-l))]"
                />
                <span className="w-6 shrink-0 text-right font-mono text-xs text-[--text-muted]">
                  {f.order}
                </span>
                <Icon className="h-4 w-4 shrink-0 text-[--text-muted]" />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[--text-1]">{f.name}</div>
                  <div className="text-xs text-[--text-muted]">
                    {humanBytes(f.size)}
                    {f.content_type ? ` · ${f.content_type}` : ''}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-1.5">
                  {previewable && (
                    <Button
                      size="sm"
                      variant="ghost"
                      leftIcon={<Eye className="h-3.5 w-3.5" />}
                      onClick={() => setPreview(f)}
                    >
                      {t('multiViewer.preview')}
                    </Button>
                  )}
                  {f.url && (
                    <Button
                      size="sm"
                      variant="outline"
                      leftIcon={<Download className="h-3.5 w-3.5" />}
                      onClick={() => triggerDownload(f.url!, f.name)}
                    >
                      {t('viewer.download')}
                    </Button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>

        <p className="mt-3 text-[10px] text-[--text-muted]">
          {t('multiViewer.zipFootnote')}
        </p>
      </main>
      <Footer />

      {preview && (
        <PreviewModal file={preview} onClose={() => setPreview(null)} />
      )}
    </>
  );
}

// ─── Preview modal ──────────────────────────────────────────────────────

function PreviewModal({
  file,
  onClose,
}: {
  file: ShareMultiFile;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const url = file.url ?? '';
  const k = useMemo(() => classifyContentType(file.content_type), [file]);
  const [textBody, setTextBody] = useState<string | null>(null);

  useEffect(() => {
    if (!url) return;
    if (k !== 'text' && k !== 'markdown') return;
    let cancelled = false;
    fetch(url)
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
  }, [url, k]);

  // Esc to close.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-40 flex items-center justify-center bg-black/60 p-4"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className={cn(
          'relative flex w-full max-w-5xl flex-col rounded-lg border border-[--border]',
          'bg-[--bg-1] shadow-xl',
          'max-h-[90vh]',
        )}
      >
        <div className="flex items-center justify-between gap-3 border-b border-[--border] px-4 py-3">
          <div className="min-w-0">
            <div className="truncate text-sm font-medium text-[--text-1]">
              {file.name}
            </div>
            <div className="text-xs text-[--text-muted]">
              {humanBytes(file.size)}
              {file.content_type ? ` · ${file.content_type}` : ''}
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {url && (
              <Button
                size="sm"
                variant="outline"
                leftIcon={<Download className="h-3.5 w-3.5" />}
                onClick={() => triggerDownload(url, file.name)}
              >
                {t('viewer.download')}
              </Button>
            )}
            <Button size="sm" variant="ghost" onClick={onClose}>
              {t('common.close')}
            </Button>
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-auto p-4">
          {!url ? (
            <div className="rounded-lg border border-[--border] bg-[--bg-1] p-8 text-center text-[--text-2]">
              {t('viewer.noPreview')}
            </div>
          ) : k === 'image' ? (
            <div className="flex justify-center">
              <img
                src={url}
                alt={file.name}
                className="max-h-[75vh] max-w-full rounded-lg border border-[--border]"
              />
            </div>
          ) : k === 'pdf' ? (
            <iframe
              src={url}
              title={file.name}
              className="h-[75vh] w-full rounded-lg border border-[--border] bg-[--bg-1]"
            />
          ) : k === 'video' ? (
            <video
              src={url}
              controls
              className="max-h-[75vh] w-full rounded-lg border border-[--border] bg-black"
            />
          ) : k === 'audio' ? (
            <audio src={url} controls className="w-full" />
          ) : k === 'text' ? (
            textBody == null ? (
              <div className="flex justify-center py-10">
                <Spinner />
              </div>
            ) : (
              <pre className="max-h-[75vh] overflow-auto whitespace-pre-wrap break-words rounded-lg border border-[--border] bg-[--bg-1] p-4 text-sm text-[--text-1]">
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
                dangerouslySetInnerHTML={{ __html: renderMarkdown(textBody) }}
              />
            )
          ) : (
            <div className="rounded-lg border border-[--border] bg-[--bg-1] p-8 text-center text-[--text-2]">
              {t('viewer.noPreview')}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
