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
  fileDownloadUrl,
  listFiles,
  listMessages,
  sendMessage,
} from '@/lib/api/collection';
import {
  uploadFilesToCollection,
  type StorageBackend,
} from '@/lib/uploader';
import { ApiError } from '@/lib/api';
import { toast } from '@/components/ui/Toast';
import type { WashiColors } from '@/variants/washi/palettes';
import { fmtSize } from '@/variants/washi/utils';

const FIVE_MIN_MS = 5 * 60 * 1000;
const MAX_MESSAGE_LEN = 2000;

interface TimelineItem {
  kind: 'message' | 'file';
  id: number;
  created_at: string;
  member_id: number;
  member_nickname: string;
  // message-only
  content?: string;
  // file-only
  name?: string;
  size?: number;
  content_type?: string | null;
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
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const stickToBottomRef = useRef(true);

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
      // Backend serializer for messages uses ``nickname`` rather than the
      // ``member_nickname`` that files use. Map both onto our internal
      // ``member_nickname`` field so the renderer stays uniform.
      member_nickname: m.nickname,
      content: m.body,
    }));
    const fileItems: TimelineItem[] = files.map((f) => ({
      kind: 'file',
      id: f.id,
      created_at: f.created_at,
      member_id: f.member_id,
      member_nickname: f.member_nickname,
      name: f.name,
      size: f.size,
      content_type: f.content_type,
    }));
    return [...msgItems, ...fileItems].sort((a, b) =>
      a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : 0,
    );
  }, [messages, files]);

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
      try {
        const handle = uploadFilesToCollection({
          collectionCode: code,
          memberToken,
          files: filesToUpload,
          storageBackend,
        });
        await handle.promise;
        // SSE will deliver the file events — no manual setFiles needed.
        stickToBottomRef.current = true;
      } catch (err) {
        const msg = err instanceof ApiError ? err.message : t('collection.errors.uploadFailed');
        toast.error(msg);
      } finally {
        setUploading(false);
      }
    },
    [uploadEnabled, code, memberToken, storageBackend, t],
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
              code={code}
              memberToken={memberToken}
              canDelete={
                it.kind === 'message' ? canDeleteMessage(it) : canDeleteFile(it)
              }
              onDelete={() =>
                it.kind === 'message' ? onDeleteMessage(it.id) : onDeleteFile(it.id)
              }
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
    </div>
  );
}

// ─── One row ────────────────────────────────────────────────────────────

interface RowProps {
  c: WashiColors;
  item: TimelineItem;
  code: string;
  memberToken: string;
  canDelete: boolean;
  onDelete: () => void;
}

function Row({ c, item, code, memberToken, canDelete, onDelete }: RowProps) {
  const [hover, setHover] = useState(false);

  const ts = useMemo(() => {
    try {
      const d = new Date(item.created_at);
      return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    } catch {
      return '';
    }
  }, [item.created_at]);

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
      ) : (
        <FileCard c={c} item={item} code={code} memberToken={memberToken} />
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
  code,
  memberToken,
}: {
  c: WashiColors;
  item: TimelineItem;
  code: string;
  memberToken: string;
}) {
  const url = fileDownloadUrl(code, item.id, memberToken);
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
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
        transition: 'background .15s, border-color .15s',
      }}
      onMouseEnter={(e) => {
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
    </a>
  );
}

export default RoomTimeline;
