/**
 * RoomMessages — message panel rendered inside Room.tsx.
 *
 * Responsibilities:
 *   - render a scrollable list of messages (oldest at top, newest at bottom)
 *   - auto-scroll on new message arrival when the viewer is already near the
 *     bottom (so we don't yank the page out from under someone scrolling back
 *     through history)
 *   - text input + send button at the bottom; Enter submits, Shift+Enter
 *     inserts a newline
 *   - per-row delete button (visible when author-within-5-min OR isCreator)
 *
 * SSE message/deleted events are pushed in by the parent through the
 * `messages` array + setter pair so the parent owns a single source of truth
 * for the room.
 */
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
} from 'react';
import { useTranslation } from 'react-i18next';
import { Send, Trash2 } from 'lucide-react';
import {
  type CollectionMessage,
  deleteMessage,
  listMessages,
  sendMessage,
} from '@/lib/api/collection';
import { ApiError } from '@/lib/api';
import { toast } from '@/components/ui/Toast';
import type { WashiColors } from '@/variants/washi/palettes';

const FIVE_MIN_MS = 5 * 60 * 1000;
const MAX_MESSAGE_LEN = 2000;

export interface RoomMessagesProps {
  code: string;
  c: WashiColors;
  memberToken: string;
  memberId: number | null;
  isCreator: boolean;
  adminPassword?: string | null;
  /** Disabled when the room is closed. */
  inputDisabled?: boolean;
  /** Owned by the parent so SSE events can patch the same list. */
  messages: CollectionMessage[];
  setMessages: (
    updater: (prev: CollectionMessage[]) => CollectionMessage[],
  ) => void;
}

export function RoomMessages({
  code,
  c,
  memberToken,
  memberId,
  isCreator,
  adminPassword,
  inputDisabled = false,
  messages,
  setMessages,
}: RoomMessagesProps) {
  const { t } = useTranslation();
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const stickToBottomRef = useRef(true);

  // Sort ascending by id so newest sits at the bottom of the list.
  const ordered = useMemo(
    () => [...messages].sort((a, b) => a.id - b.id),
    [messages],
  );

  // Initial fetch — most-recent page. The list endpoint returns descending,
  // we flip it to ascending for the panel layout.
  useEffect(() => {
    let cancelled = false;
    listMessages(code, memberToken, { limit: 50 })
      .then((r) => {
        if (cancelled) return;
        // De-dupe in case SSE has already delivered one of these.
        setMessages((prev) => {
          const seen = new Set(prev.map((m) => m.id));
          const merged = [...prev];
          for (const m of r.messages) {
            if (!seen.has(m.id)) merged.push(m);
          }
          return merged;
        });
      })
      .catch(() => {
        /* SSE will catch us up if this transient fails */
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code, memberToken]);

  // Track whether we should auto-stick to the bottom on new messages.
  const onScroll = () => {
    const el = scrollerRef.current;
    if (!el) return;
    const fromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    stickToBottomRef.current = fromBottom < 80;
  };

  // Auto-scroll on new arrivals when the user hasn't scrolled away.
  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    if (stickToBottomRef.current) {
      el.scrollTop = el.scrollHeight;
    }
  }, [ordered.length]);

  const onSend = async () => {
    const trimmed = text.trim();
    if (!trimmed || sending || inputDisabled) return;
    if (trimmed.length > MAX_MESSAGE_LEN) {
      toast.error(t('collection.errors.messageTooLong'));
      return;
    }
    setSending(true);
    try {
      const msg = await sendMessage(code, memberToken, { text: trimmed });
      // SSE will also deliver this; the setter de-dupes by id.
      setMessages((prev) => {
        if (prev.some((m) => m.id === msg.id)) return prev;
        return [...prev, msg];
      });
      setText('');
      // Force-stick for the sender's own message.
      stickToBottomRef.current = true;
    } catch (e) {
      const m =
        e instanceof ApiError ? e.message : t('collection.errors.sendFailed');
      toast.error(m);
    } finally {
      setSending(false);
    }
  };

  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void onSend();
    }
  };

  const canDelete = (m: CollectionMessage): boolean => {
    if (isCreator) return true;
    if (memberId != null && m.member_id === memberId) {
      const age = Date.now() - new Date(m.created_at).getTime();
      return age < FIVE_MIN_MS;
    }
    return false;
  };

  const onDelete = async (m: CollectionMessage) => {
    if (!confirm(t('collection.room.deleteConfirm'))) return;
    try {
      await deleteMessage(code, m.id, memberToken, isCreator ? adminPassword : null);
      setMessages((prev) => prev.filter((x) => x.id !== m.id));
    } catch (e) {
      const msg =
        e instanceof ApiError ? e.message : t('collection.errors.deleteFailed');
      toast.error(msg);
    }
  };

  const scrollerStyle: CSSProperties = {
    flex: 1,
    minHeight: 240,
    maxHeight: '60vh',
    overflowY: 'auto',
    border: `1px solid ${c.soft}`,
    borderRadius: 10,
    padding: '10px 12px',
    background: 'transparent',
  };

  const inputWrapStyle: CSSProperties = {
    marginTop: 10,
    display: 'flex',
    alignItems: 'flex-end',
    gap: 8,
  };

  const textareaStyle: CSSProperties = {
    flex: 1,
    minHeight: 44,
    maxHeight: 140,
    resize: 'vertical',
    border: `1px solid ${c.soft}`,
    borderRadius: 8,
    background: 'transparent',
    color: c.ink,
    padding: '10px 12px',
    fontFamily: 'inherit',
    fontSize: 14,
    outline: 'none',
    boxSizing: 'border-box',
    opacity: inputDisabled ? 0.55 : 1,
  };

  const sendBtnStyle: CSSProperties = {
    height: 44,
    minWidth: 80,
    border: 'none',
    borderRadius: 8,
    background: c.accent,
    color: '#fff',
    fontSize: 14,
    letterSpacing: '0.04em',
    cursor: sending || inputDisabled ? 'not-allowed' : 'pointer',
    opacity: sending || inputDisabled ? 0.6 : 1,
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    padding: '0 14px',
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ fontSize: 13, color: c.sub, marginBottom: 10 }}>
        {t('collection.room.messages')}
      </div>

      <div ref={scrollerRef} onScroll={onScroll} style={scrollerStyle}>
        {ordered.length === 0 ? (
          <div
            style={{
              color: c.sub,
              fontSize: 13,
              textAlign: 'center',
              padding: '32px 0',
            }}
          >
            {t('collection.room.empty')}
          </div>
        ) : (
          ordered.map((m) => {
            const isOwn = memberId != null && m.member_id === memberId;
            return (
              <div
                key={m.id}
                style={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: 8,
                  padding: '8px 4px',
                  borderBottom: `1px solid ${c.soft}`,
                }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div
                    style={{
                      fontSize: 12,
                      color: c.sub,
                      marginBottom: 2,
                      display: 'flex',
                      gap: 8,
                      flexWrap: 'wrap',
                    }}
                  >
                    <span style={{ color: isOwn ? c.accent : c.sub }}>
                      {m.member_nickname}
                    </span>
                    <span>·</span>
                    <span>{new Date(m.created_at).toLocaleString()}</span>
                  </div>
                  <div
                    style={{
                      fontSize: 14,
                      color: c.ink,
                      whiteSpace: 'pre-wrap',
                      wordBreak: 'break-word',
                    }}
                  >
                    {m.body}
                  </div>
                </div>
                {canDelete(m) && (
                  <button
                    type="button"
                    onClick={() => onDelete(m)}
                    title={t('collection.room.delete') ?? ''}
                    style={{
                      border: 'none',
                      background: 'transparent',
                      color: c.sub,
                      width: 28,
                      height: 28,
                      borderRadius: 6,
                      cursor: 'pointer',
                      flexShrink: 0,
                    }}
                  >
                    <Trash2 size={14} />
                  </button>
                )}
              </div>
            );
          })
        )}
      </div>

      <div style={inputWrapStyle}>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKey}
          rows={1}
          maxLength={MAX_MESSAGE_LEN}
          disabled={inputDisabled}
          placeholder={t('collection.room.messageInputPlaceholder') ?? ''}
          style={textareaStyle}
        />
        <button
          type="button"
          onClick={() => void onSend()}
          disabled={sending || inputDisabled || !text.trim()}
          style={sendBtnStyle}
        >
          <Send size={14} />
          {t('collection.room.sendBtn')}
        </button>
      </div>
    </div>
  );
}

export default RoomMessages;
