/**
 * RoomTimeline — single-column Discord/Slack-style timeline that mixes
 * messages and files into one chronological view, with a sticky input
 * bar at the bottom that handles both text sending and file uploads.
 *
 * Replaces the old two-pane (RoomFiles + RoomMessages) layout. The
 * sub-components still exist for any direct integrations but Room.tsx
 * now uses this unified view exclusively.
 *
 * Owned arrays come from the parent (Room.tsx) so SSE events stay the
 * single source of truth. The component performs the initial fetch
 * (listFiles + listMessages in parallel) and merges them into the
 * parent arrays via the setters.
 */
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type DragEvent,
  type KeyboardEvent,
} from 'react';
import { useTranslation } from 'react-i18next';
import { Download, Paperclip, Send, Trash2, File as FileIcon } from 'lucide-react';
import {
  type CollectionFile,
  type CollectionMessage,
  deleteFile,
  deleteMessage,
  resolveFileDownloadUrl,
  listFiles,
  listMessages,
  sendMessage,
} from '@/lib/api/collection';
import {
  uploadFilesToCollection,
  type StorageBackend,
} from '@/lib/uploader';
import { ApiError } from '@/lib/api';
import { safeFormatTime } from '@/lib/safeDate';
import { toast } from '@/components/ui/Toast';
import { useCollectionMemberStore } from '@/stores/collectionMember';
import type { WashiColors } from '@/variants/washi/palettes';
import { PickupModal } from '@/variants/washi/tabs/PickupModal';
import type { ShareSelectResponse } from '@/lib/api/share';
import { fmtSize } from '@/variants/washi/utils';

const FIVE_MIN_MS = 5 * 60 * 1000;
const MAX_MESSAGE_LEN = 2000;

interface TimelineItem {
  kind: 'message' | 'file' | 'pending-upload';
  id: number | string;        // pending-upload uses string ("pending-<n>"); file/message use number
  created_at: string;
  member_id: number;
  member_nickname: string;
  // message-only
  content?: string;
  // file-only / pending-upload
  name?: string;
  size?: number;
  content_type?: string | null;
  // pending-upload only
  pending?: {
    progress: number;          // 0..1
    state: 'pending' | 'uploading' | 'complete' | 'failed';
    error?: string;
  };
}

export interface RoomTimelineProps {
  code: string;
  c: WashiColors;
  memberToken: string;
  memberId: number | null;
  isCreator: boolean;
  adminPassword?: string | null;
  uploadEnabled: boolean;
  storageBackend: StorageBackend;
  messages: CollectionMessage[];
  setMessages: (
    updater: (prev: CollectionMessage[]) => CollectionMessage[],
  ) => void;
  files: CollectionFile[];
  setFiles: (
    updater: (prev: CollectionFile[]) => CollectionFile[],
  ) => void;
}

export function RoomTimeline({
  code,
  c,
  memberToken,
  memberId,
  isCreator,
  adminPassword,
  uploadEnabled,
  storageBackend,
  messages,
  setMessages,
  files,
  setFiles,
}: RoomTimelineProps) {
  const { t } = useTranslation();
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [uploading, setUploading] = useState(false);
  // Pending uploads — appear in the timeline as optimistic placeholder
  // cards the moment the user picks files, with a live progress bar.
  // Removed from this map once the upload finishes (the SSE event delivers
  // the real CollectionFile row that replaces the placeholder).
  interface PendingUpload {
    key: string;            // unique placeholder id
    name: string;
    size: number;
    content_type: string | null;
    member_nickname: string;
    member_id: number;
    created_at: string;
    progress: number;       // 0..1
    state: 'pending' | 'uploading' | 'complete' | 'failed';
    error?: string;
  }
  const [pendingUploads, setPendingUploads] = useState<PendingUpload[]>([]);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const stickToBottomRef = useRef(true);

  // Current member's nickname — used to label optimistic placeholder cards
  // so the user sees their own name on the card the moment they pick a file.
  const myNickname = useCollectionMemberStore(
    (s) => s.members[code]?.nickname ?? '',
  );

  // ── Preview modal state ──────────────────────────────────────────────
  // Reuse the same PickupModal used by the /s/{code} pickup flow so the
  // in-room "click a file to preview" experience matches the pickup UX
  // 1:1 (image / pdf / video / audio / text / fallback) without re-rolling
  // a separate viewer. The adapter sits inline below — see openPreview.
  const [previewItem, setPreviewItem] = useState<ShareSelectResponse | null>(null);
  const [previewBusy, setPreviewBusy] = useState<number | null>(null);

  const openPreview = useCallback(
    async (fileItem: TimelineItem) => {
      if (fileItem.kind !== 'file' || typeof fileItem.id !== 'number') return;
      const fileId = fileItem.id;
      setPreviewBusy(fileId);
      try {
        // Resolve the actual storage URL (presigned R2 GET, or same-origin
        // /blob?token=<jwt> for the local backend). The resolver is the
        // single source of truth — it also surfaces orphan-row 404s as
        // file_not_yet_uploaded so we don't render NoSuchKey XML in an
        // image tag.
        const url = await resolveFileDownloadUrl(code, fileId, memberToken);
        // Adapt CollectionFile -> ShareSelectResponse. Only fields the
        // modal actually reads are populated; expired_at/expired_count
        // are pickup-flow concepts that don't apply inside a room, so
        // we feed sentinel values that render as "∞" in the footer.
        const adapted: ShareSelectResponse = {
          code: fileItem.id.toString(),  // header shows #<n>; room code goes in copy-link
          kind: 'file',
          name: fileItem.name ?? null,
          size: fileItem.size ?? null,
          text: null,
          url,
          content_type: fileItem.content_type ?? null,
          force_download: false,
          expired_at: null,
          expired_count: -1,
          used_count: 0,
        };
        setPreviewItem(adapted);
      } catch (err) {
        const msg =
          err instanceof ApiError ? err.message : t('collection.errors.downloadFailed');
        toast.error(msg);
      } finally {
        setPreviewBusy(null);
      }
    },
    [code, memberToken, t],
  );

  // ── Initial fetch (parallel) ─────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    Promise.all([
      listMessages(code, memberToken, { limit: 100 }).catch(() => ({
        messages: [] as CollectionMessage[],
      })),
      listFiles(code, memberToken).catch(() => ({ files: [] as CollectionFile[] })),
    ]).then(([msgsRes, filesRes]) => {
      if (cancelled) return;
      setMessages((prev) => {
        const seen = new Set(prev.map((m) => m.id));
        return [...prev, ...msgsRes.messages.filter((m) => !seen.has(m.id))];
      });
      setFiles((prev) => {
        const seen = new Set(prev.map((f) => f.id));
        return [...prev, ...filesRes.files.filter((f) => !seen.has(f.id))];
      });
    });
    return () => {
      cancelled = true;
    };
    // setters from zustand-style parents are stable; intentionally not in deps.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code, memberToken]);

  // ── Merged + sorted timeline ─────────────────────────────────────────
  const items: TimelineItem[] = useMemo(() => {
    const msgItems: TimelineItem[] = messages.map((m) => ({
      kind: 'message',
      id: m.id,
      created_at: m.created_at,
      member_id: m.member_id,
      member_nickname: m.nickname,
      content: m.body,
    }));
    const fileItems: TimelineItem[] = files.map((f) => ({
      kind: 'file',
      id: f.id,
      created_at: f.created_at,
      member_id: f.member_id,
      member_nickname: f.nickname,
      name: f.name,
      size: f.size,
      content_type: f.content_type,
    }));
    // Filter out pending placeholders whose final file has already arrived
    // via SSE so we don't briefly show "pending + finished" duplicates.
    const finishedNames = new Set(
      files
        .filter((f) => memberId != null && f.member_id === memberId)
        .map((f) => `${f.name}|${f.size}`),
    );
    const pendingItems: TimelineItem[] = pendingUploads
      .filter(
        (p) =>
          p.state !== 'complete' ||
          !finishedNames.has(`${p.name}|${p.size}`),
      )
      .map((p) => ({
        kind: 'pending-upload',
        id: p.key,
        created_at: p.created_at,
        member_id: p.member_id,
        member_nickname: p.member_nickname,
        name: p.name,
        size: p.size,
        content_type: p.content_type,
        pending: {
          progress: p.progress,
          state: p.state,
          error: p.error,
        },
      }));
    return [...msgItems, ...fileItems, ...pendingItems].sort((a, b) =>
      a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : 0,
    );
  }, [messages, files, pendingUploads, memberId]);

  // ── Track sticky-to-bottom + auto-scroll on new items ────────────────
  const onScroll = useCallback(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const near = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    stickToBottomRef.current = near;
  }, []);

  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    if (stickToBottomRef.current) {
      el.scrollTop = el.scrollHeight;
    }
  }, [items.length]);

  // ── Send message ─────────────────────────────────────────────────────
  const onSend = useCallback(async () => {
    const body = text.trim();
    if (!body || sending) return;
    if (body.length > MAX_MESSAGE_LEN) {
      toast.error(t('collection.errors.messageTooLong'));
      return;
    }
    setSending(true);
    try {
      const r = await sendMessage(code, memberToken, { text: body });
      setMessages((prev) => (prev.some((x) => x.id === r.id) ? prev : [...prev, r]));
      setText('');
      stickToBottomRef.current = true;
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : t('collection.errors.sendFailed');
      toast.error(msg);
    } finally {
      setSending(false);
    }
  }, [text, sending, code, memberToken, setMessages, t]);

  const onKey = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
        e.preventDefault();
        void onSend();
      }
    },
    [onSend],
  );

  // ── Upload (drag-drop or picker) ─────────────────────────────────────
  const doUpload = useCallback(
    async (filesToUpload: File[]) => {
      if (!uploadEnabled) {
        toast.error(t('collection.errors.uploadDisabled'));
        return;
      }
      if (filesToUpload.length === 0) return;
      setUploading(true);

      // Optimistic insert — create one placeholder per file BEFORE the
      // network call so the user sees their files appear in the timeline
      // instantly with an upload-in-progress bar.
      const baseTs = Date.now();
      const placeholders: PendingUpload[] = filesToUpload.map((f, idx) => ({
        // The timestamp suffix per file keeps the placeholder strictly after
        // any pre-existing items + preserves a stable order across the batch.
        // We bias by idx ms so placeholders within one batch sort deterministically.
        key: `pending-${baseTs}-${idx}`,
        name: f.name,
        size: f.size,
        content_type: f.type || null,
        member_nickname: myNickname,
        member_id: memberId ?? 0,
        created_at: new Date(baseTs + idx).toISOString(),
        progress: 0,
        state: 'pending',
      }));
      setPendingUploads((prev) => [...prev, ...placeholders]);
      stickToBottomRef.current = true;

      const placeholderKey = (idx: number) => placeholders[idx]!.key;

      try {
        const handle = uploadFilesToCollection({
          collectionCode: code,
          memberToken,
          files: filesToUpload,
          storageBackend,
          onFileState: (idx, state) => {
            const k = placeholderKey(idx);
            setPendingUploads((prev) =>
              prev.map((p) => (p.key === k ? { ...p, state } : p)),
            );
          },
          onFileProgress: (idx, fraction) => {
            const k = placeholderKey(idx);
            setPendingUploads((prev) =>
              prev.map((p) =>
                p.key === k
                  ? { ...p, progress: Math.min(1, Math.max(0, fraction)) }
                  : p,
              ),
            );
          },
        });
        await handle.promise;
        // SSE delivers the file events that fold the placeholder into the
        // real file row (see the `items` memo's finishedNames filter).
        // Clean up placeholders for this batch after a brief settle window
        // — usually SSE wins the race, but tear them down on a timer too
        // so a dropped SSE event doesn't leave a ghost "complete" card.
        window.setTimeout(() => {
          setPendingUploads((prev) =>
            prev.filter((p) => !placeholders.some((q) => q.key === p.key)),
          );
        }, 3000);
      } catch (err) {
        const msg = err instanceof ApiError ? err.message : t('collection.errors.uploadFailed');
        // Mark all in-progress placeholders for this batch as failed.
        setPendingUploads((prev) =>
          prev.map((p) =>
            placeholders.some((q) => q.key === p.key)
              ? { ...p, state: 'failed', error: msg }
              : p,
          ),
        );
        toast.error(msg);
      } finally {
        setUploading(false);
      }
    },
    [uploadEnabled, code, memberToken, storageBackend, t, myNickname, memberId],
  );

  const onDrop = useCallback(
    (e: DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      setDragOver(false);
      const fs = Array.from(e.dataTransfer?.files || []);
      void doUpload(fs);
    },
    [doUpload],
  );

  // ── Delete affordances ───────────────────────────────────────────────
  const canDeleteMessage = (m: TimelineItem) => {
    if (m.kind !== 'message') return false;
    if (isCreator) return true;
    if (memberId === m.member_id) {
      const age = Date.now() - new Date(m.created_at).getTime();
      return age < FIVE_MIN_MS;
    }
    return false;
  };
  const canDeleteFile = (f: TimelineItem) => {
    if (f.kind !== 'file') return false;
    if (isCreator) return true;
    return memberId === f.member_id;
  };

  const onDeleteMessage = async (id: number) => {
    try {
      await deleteMessage(code, id, memberToken, isCreator ? adminPassword : null);
      setMessages((prev) => prev.filter((m) => m.id !== id));
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : t('collection.errors.deleteFailed');
      toast.error(msg);
    }
  };
  const onDeleteFile = async (id: number) => {
    try {
      await deleteFile(code, id, memberToken, isCreator ? adminPassword : null);
      setFiles((prev) => prev.filter((f) => f.id !== id));
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : t('collection.errors.deleteFailed');
      toast.error(msg);
    }
  };

  // ── Styles ───────────────────────────────────────────────────────────
  const shellStyle: CSSProperties = {
    border: `1px solid ${dragOver ? c.accent : c.soft}`,
    borderRadius: 12,
    display: 'flex',
    flexDirection: 'column',
    height: 'min(72vh, 720px)',
    background: dragOver ? `${c.accent}08` : 'transparent',
    transition: 'border-color .15s, background .15s',
    position: 'relative',
  };
  const scrollerStyle: CSSProperties = {
    flex: 1,
    overflowY: 'auto',
    padding: '16px 18px',
  };

  return (
    <div
      style={shellStyle}
      onDragOver={(e) => {
        e.preventDefault();
        if (!dragOver) setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={onDrop}
    >
      <div ref={scrollerRef} style={scrollerStyle} onScroll={onScroll}>
        {items.length === 0 ? (
          <div
            style={{
              height: '100%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: c.sub,
              fontSize: 13,
              textAlign: 'center',
              padding: '20px 0',
            }}
          >
            {t('collection.timeline.empty')}
          </div>
        ) : (
          items.map((it) => (
            <Row
              key={`${it.kind}-${it.id}`}
              c={c}
              item={it}
              canDelete={
                it.kind === 'message'
                  ? canDeleteMessage(it)
                  : it.kind === 'file'
                    ? canDeleteFile(it)
                    : false
              }
              onDelete={() => {
                if (it.kind === 'message' && typeof it.id === 'number') {
                  void onDeleteMessage(it.id);
                } else if (it.kind === 'file' && typeof it.id === 'number') {
                  void onDeleteFile(it.id);
                }
                // pending-upload: no delete affordance (the upload is in
                // flight; cancellation is not yet plumbed through).
              }}
              onOpenFile={(item) => { void openPreview(item); }}
              busyFileId={previewBusy}
            />
          ))
        )}
      </div>

      <div
        style={{
          borderTop: `1px solid ${c.soft}`,
          padding: 12,
          display: 'flex',
          gap: 8,
          alignItems: 'flex-end',
          background: c.paper,
        }}
      >
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={!uploadEnabled || uploading}
          title={t('collection.timeline.attach') ?? ''}
          style={{
            width: 38,
            height: 38,
            border: `1px solid ${c.soft}`,
            background: 'transparent',
            color: uploadEnabled ? c.ink : c.sub,
            borderRadius: 8,
            cursor: uploadEnabled && !uploading ? 'pointer' : 'not-allowed',
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
            transition: 'transform .15s, opacity .15s, background .15s',
          }}
          onMouseDown={(e) => (e.currentTarget.style.transform = 'scale(0.95)')}
          onMouseUp={(e) => (e.currentTarget.style.transform = '')}
          onMouseLeave={(e) => (e.currentTarget.style.transform = '')}
        >
          <Paperclip size={16} />
        </button>
        <input
          ref={fileInputRef}
          type="file"
          multiple
          style={{ display: 'none' }}
          onChange={(e) => {
            const fs = Array.from(e.target.files || []);
            if (fs.length) void doUpload(fs);
            e.target.value = '';
          }}
        />
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKey}
          placeholder={t('collection.timeline.sendPlaceholder') ?? ''}
          rows={1}
          style={{
            flex: 1,
            resize: 'none',
            minHeight: 38,
            maxHeight: 120,
            padding: '9px 12px',
            border: `1px solid ${c.soft}`,
            borderRadius: 8,
            background: 'transparent',
            color: c.ink,
            fontFamily: 'inherit',
            fontSize: 14,
            outline: 'none',
            lineHeight: 1.4,
            transition: 'border-color .15s',
          }}
        />
        <button
          type="button"
          onClick={() => void onSend()}
          disabled={!text.trim() || sending}
          style={{
            width: 38,
            height: 38,
            border: 'none',
            background: text.trim() ? c.accent : c.soft,
            color: text.trim() ? '#fff' : c.sub,
            borderRadius: 8,
            cursor: text.trim() && !sending ? 'pointer' : 'not-allowed',
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
            transition: 'transform .15s, opacity .15s, background .15s',
          }}
          onMouseDown={(e) => (e.currentTarget.style.transform = 'scale(0.95)')}
          onMouseUp={(e) => (e.currentTarget.style.transform = '')}
          onMouseLeave={(e) => (e.currentTarget.style.transform = '')}
        >
          <Send size={16} />
        </button>
      </div>

      {dragOver && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: c.accent,
            fontSize: 16,
            pointerEvents: 'none',
            fontWeight: 600,
          }}
        >
          {t('collection.timeline.dropHere')}
        </div>
      )}
      {previewItem && (
        <PickupModal
          c={c}
          item={previewItem}
          onClose={() => setPreviewItem(null)}
          // Inside a room, "copy share link" should copy the room URL,
          // not a /s/{code} pickup URL (item.code is the file id, not a
          // pickup code — see openPreview adapter).
          shareLinkPath={`/c/${code}`}
        />
      )}
    </div>
  );
}

// ─── One row ────────────────────────────────────────────────────────────

interface RowProps {
  c: WashiColors;
  item: TimelineItem;
  canDelete: boolean;
  onDelete: () => void;
  onOpenFile: (item: TimelineItem) => void;
  busyFileId: number | null;
}

function Row({ c, item, canDelete, onDelete, onOpenFile, busyFileId }: RowProps) {
  const [hover, setHover] = useState(false);

  const ts = useMemo(() => safeFormatTime(item.created_at), [item.created_at]);

  return (
    <div
      data-yui="timeline-row"
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 4,
        padding: '8px 4px',
        position: 'relative',
        borderRadius: 6,
        background: hover ? `${c.accent}06` : 'transparent',
        transition: 'background .15s',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
        <span style={{ color: c.accent, fontSize: 13, fontWeight: 600 }}>
          {item.member_nickname}
        </span>
        <span style={{ color: c.sub, fontSize: 11 }}>{ts}</span>
      </div>
      {item.kind === 'message' ? (
        <div
          style={{
            color: c.ink,
            fontSize: 14,
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
            lineHeight: 1.45,
          }}
        >
          {item.content}
        </div>
      ) : item.kind === 'pending-upload' ? (
        <PendingFileCard c={c} item={item} />
      ) : (
        <FileCard
          c={c}
          item={item}
          onOpen={onOpenFile}
          busy={typeof item.id === 'number' && busyFileId === item.id}
        />
      )}
      {canDelete && hover && (
        <button
          type="button"
          onClick={onDelete}
          aria-label="delete"
          style={{
            position: 'absolute',
            top: 6,
            right: 6,
            width: 26,
            height: 26,
            border: `1px solid ${c.soft}`,
            background: c.paper,
            color: c.sub,
            borderRadius: 6,
            cursor: 'pointer',
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            transition: 'transform .15s, color .15s',
          }}
          onMouseEnter={(e) => (e.currentTarget.style.color = '#c44a3e')}
          onMouseLeave={(e) => (e.currentTarget.style.color = c.sub)}
        >
          <Trash2 size={13} />
        </button>
      )}
    </div>
  );
}

// ─── File card ──────────────────────────────────────────────────────────

function FileCard({
  c,
  item,
  onOpen,
  busy,
}: {
  c: WashiColors;
  item: TimelineItem;
  onOpen: (item: TimelineItem) => void;
  busy: boolean;
}) {
  // FileCard is only mounted for kind === 'file' (see Row), where id is
  // always numeric. Narrow once at the boundary so the rest of the body
  // doesn't have to repeat the assertion.
  if (typeof item.id !== 'number') return null;
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onOpen(item)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onOpen(item);
        }
      }}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        padding: '10px 12px',
        border: `1px solid ${c.soft}`,
        borderRadius: 8,
        background: `${c.accent}05`,
        textDecoration: 'none',
        color: c.ink,
        maxWidth: 420,
        cursor: busy ? 'wait' : 'pointer',
        opacity: busy ? 0.65 : 1,
        transition: 'background .15s, border-color .15s, opacity .15s',
        outline: 'none',
      }}
      onMouseEnter={(e) => {
        if (busy) return;
        e.currentTarget.style.background = `${c.accent}10`;
        e.currentTarget.style.borderColor = c.accent;
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = `${c.accent}05`;
        e.currentTarget.style.borderColor = c.soft;
      }}
    >
      <div
        style={{
          width: 32,
          height: 32,
          background: `${c.accent}18`,
          color: c.accent,
          borderRadius: 6,
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
        }}
      >
        <FileIcon size={16} />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            fontSize: 14,
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
        >
          {item.name}
        </div>
        <div style={{ fontSize: 11, color: c.sub }}>{fmtSize(item.size ?? 0)}</div>
      </div>
      <Download size={16} style={{ color: c.sub, flexShrink: 0 }} />
    </div>
  );
}

// ─── Pending upload card (placeholder + progress bar) ───────────────────

function PendingFileCard({ c, item }: { c: WashiColors; item: TimelineItem }) {
  const pct = Math.round(((item.pending?.progress ?? 0) * 100));
  const state = item.pending?.state ?? 'pending';
  const failed = state === 'failed';
  const done = state === 'complete';
  const stateLabel = failed
    ? item.pending?.error || 'failed'
    : done
      ? '✓'
      : state === 'uploading'
        ? `${pct}%`
        : '…';
  return (
    <div
      data-yui="pending-file-card"
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
        padding: '10px 12px',
        border: `1px dashed ${failed ? '#c44a3e' : c.soft}`,
        borderRadius: 8,
        background: `${c.accent}05`,
        maxWidth: 420,
        opacity: failed ? 0.85 : 1,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <div
          style={{
            width: 32,
            height: 32,
            background: `${c.accent}18`,
            color: c.accent,
            borderRadius: 6,
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
          }}
        >
          <FileIcon size={16} />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              fontSize: 14,
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              color: c.ink,
            }}
            title={item.name}
          >
            {item.name}
          </div>
          <div style={{ fontSize: 11, color: c.sub }}>
            {fmtSize(item.size ?? 0)} · {stateLabel}
          </div>
        </div>
      </div>
      {/* Progress bar — visible whenever an upload is in flight; turns red
          on failure and stays at 100% on success until the SSE event swaps
          the placeholder for the real file row. */}
      <div
        style={{
          height: 4,
          background: c.soft,
          borderRadius: 2,
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            width: `${failed ? 100 : Math.max(2, pct)}%`,
            height: '100%',
            background: failed ? '#c44a3e' : c.accent,
            transition: 'width .15s ease-out',
          }}
        />
      </div>
    </div>
  );
}

export default RoomTimeline;
