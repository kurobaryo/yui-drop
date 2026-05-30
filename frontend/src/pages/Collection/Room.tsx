/**
 * Collection room page — `/c/:code`.
 *
 * Lifecycle:
 *   1. Preview the room (resolves name + closed flag + has_entry_password).
 *      404 → "Room not found"; closed=true → "Room closed".
 *   2. If we already hold a member token for this code in the persisted
 *      `useCollectionMemberStore`, skip the join form and mount the room
 *      view directly. Otherwise show a nickname (+ optional entry password)
 *      prompt and POST /join, persist the returned token, then mount the
 *      room view.
 *   3. Room view owns the SSE connection, the canonical `files`/`messages`
 *      arrays (so SSE events + child-component fetches converge on one
 *      source of truth), the upload-enabled flag, and the admin modal.
 *
 * Mobile layout: two-pane side-by-side at md+, single-pane with a tab
 * switcher at small viewports. CSS-only via Tailwind responsive utilities
 * keeps things SSR-safe and avoids matchMedia plumbing.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Settings, ShieldCheck } from 'lucide-react';
import { CollectionShell } from './Shell';
import { RoomFiles } from './RoomFiles';
import { RoomMessages } from './RoomMessages';
import { RoomAdminModal } from './RoomAdminModal';
import {
  adminVerify,
  joinCollection,
  previewCollection,
  type CollectionFile,
  type CollectionMessage,
  type PreviewCollectionResponse,
} from '@/lib/api/collection';
import { ApiError } from '@/lib/api';
import { CollectionSse } from '@/lib/collectionSse';
import { useCollectionMemberStore } from '@/stores/collectionMember';
import { getConfig, DEFAULT_CONFIG, type PublicConfig } from '@/lib/api/public';
import { toast } from '@/components/ui/Toast';
import type { WashiColors } from '@/variants/washi/palettes';
import type { StorageBackend } from '@/lib/uploader';

type MobileTab = 'files' | 'messages';

interface RoomViewProps {
  code: string;
  c: WashiColors;
  preview: PreviewCollectionResponse;
  storageBackend: StorageBackend;
}

/** Centred message card used for not-found / closed / loading states. */
function StatusCard({
  c,
  title,
  body,
}: {
  c: WashiColors;
  title: string;
  body?: string;
}) {
  return (
    <div
      style={{
        margin: '40px auto',
        maxWidth: 460,
        textAlign: 'center',
        padding: '36px 28px',
        border: `1px solid ${c.soft}`,
        borderRadius: 12,
        background: 'transparent',
      }}
    >
      <div style={{ fontSize: 18, color: c.ink, marginBottom: 8 }}>{title}</div>
      {body ? <div style={{ fontSize: 13, color: c.sub }}>{body}</div> : null}
    </div>
  );
}

// ─── Join form ─────────────────────────────────────────────────────────────

interface JoinFormProps {
  code: string;
  c: WashiColors;
  preview: PreviewCollectionResponse;
  onJoined: (
    memberToken: string,
    memberId: number,
    nickname: string,
    uploadEnabled: boolean,
    isCreator: boolean,
  ) => void;
}

function JoinForm({ code, c, preview, onJoined }: JoinFormProps) {
  const { t } = useTranslation();
  const [nickname, setNickname] = useState('');
  const [entryPassword, setEntryPassword] = useState('');
  const [busy, setBusy] = useState(false);

  const onSubmit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    const nick = nickname.trim();
    if (!nick) {
      toast.error(t('collection.errors.nicknameRequired'));
      return;
    }
    if (preview.has_entry_password && !entryPassword) {
      toast.error(t('collection.errors.entryPasswordRequired'));
      return;
    }
    setBusy(true);
    try {
      const r = await joinCollection(code, {
        nickname: nick,
        entry_password: preview.has_entry_password ? entryPassword : null,
      });
      onJoined(
        r.member_token,
        r.member_id,
        nick,
        r.upload_enabled,
        Boolean(r.is_creator),
      );
    } catch (err) {
      const msg =
        err instanceof ApiError ? err.message : t('collection.errors.joinFailed');
      toast.error(msg);
    } finally {
      setBusy(false);
    }
  };

  const inputStyle: CSSProperties = {
    width: '100%',
    height: 44,
    border: `1px solid ${c.soft}`,
    borderRadius: 8,
    background: 'transparent',
    color: c.ink,
    padding: '0 12px',
    fontSize: 14,
    fontFamily: 'inherit',
    outline: 'none',
    boxSizing: 'border-box',
  };
  const labelStyle: CSSProperties = {
    fontSize: 12,
    color: c.sub,
    letterSpacing: '0.04em',
    marginBottom: 6,
  };
  const btnStyle: CSSProperties = {
    width: '100%',
    height: 44,
    border: 'none',
    borderRadius: 8,
    background: c.accent,
    color: '#fff',
    fontSize: 14,
    letterSpacing: '0.06em',
    cursor: busy ? 'not-allowed' : 'pointer',
    opacity: busy ? 0.6 : 1,
    marginTop: 8,
  };

  return (
    <form
      onSubmit={onSubmit}
      style={{
        margin: '24px auto 0',
        maxWidth: 420,
        padding: '24px 22px',
        border: `1px solid ${c.soft}`,
        borderRadius: 12,
      }}
    >
      <div style={{ fontSize: 13, color: c.sub, marginBottom: 4 }}>
        {t('collection.room.codeLabel')}
      </div>
      <div
        style={{
          fontSize: 22,
          letterSpacing: '0.32em',
          color: c.ink,
          marginBottom: 18,
          fontVariantNumeric: 'tabular-nums',
        }}
      >
        {code}
      </div>
      {preview.name ? (
        <div style={{ fontSize: 14, color: c.ink, marginBottom: 16 }}>
          {preview.name}
        </div>
      ) : null}

      <div style={{ marginBottom: 14 }}>
        <div style={labelStyle}>{t('collection.room.nicknameLabel')}</div>
        <input
          type="text"
          value={nickname}
          onChange={(e) => setNickname(e.target.value)}
          maxLength={40}
          autoFocus
          placeholder={t('collection.room.nicknamePlaceholder') ?? ''}
          style={inputStyle}
        />
      </div>

      {preview.has_entry_password ? (
        <div style={{ marginBottom: 14 }}>
          <div style={labelStyle}>{t('collection.room.entryPasswordLabel')}</div>
          <input
            type="password"
            value={entryPassword}
            onChange={(e) => setEntryPassword(e.target.value)}
            autoComplete="off"
            placeholder={t('collection.room.entryPasswordPlaceholder') ?? ''}
            style={inputStyle}
          />
        </div>
      ) : null}

      <button type="submit" disabled={busy} style={btnStyle}>
        {busy ? t('collection.room.joining') : t('collection.room.joinBtn')}
      </button>
    </form>
  );
}

// ─── Room view ─────────────────────────────────────────────────────────────

function RoomView({ code, c, preview, storageBackend }: RoomViewProps) {
  const { t } = useTranslation();
  const storeSet = useCollectionMemberStore((s) => s.set);
  const storePatch = useCollectionMemberStore((s) => s.patch);
  const existing = useCollectionMemberStore((s) => s.members[code]);

  // Member-session state (mirrors what's in the persisted store, but the
  // store doesn't track memberId — we keep that purely in component state
  // after join).
  const [memberToken, setMemberToken] = useState<string | null>(
    existing?.memberToken ?? null,
  );
  const [memberId, setMemberId] = useState<number | null>(null);
  const [isCreator, setIsCreator] = useState<boolean>(existing?.isCreator ?? false);
  const [adminPassword, setAdminPassword] = useState<string | null>(
    existing?.adminPassword ?? null,
  );
  const [uploadEnabled, setUploadEnabled] = useState<boolean>(true);

  // Room state.
  const [files, setFiles] = useState<CollectionFile[]>([]);
  const [messages, setMessages] = useState<CollectionMessage[]>([]);
  const [roomClosed, setRoomClosed] = useState<boolean>(Boolean(preview.closed));

  // UI state.
  const [adminOpen, setAdminOpen] = useState(false);
  const [mobileTab, setMobileTab] = useState<MobileTab>('messages');

  const sseRef = useRef<CollectionSse | null>(null);

  // ─── Join handler (only used when no token exists yet) ──────────────────
  const onJoined = useCallback(
    (
      token: string,
      mid: number,
      nickname: string,
      upload: boolean,
      creatorFromServer: boolean,
    ) => {
      storeSet(code, {
        memberToken: token,
        nickname,
        isCreator: creatorFromServer,
      });
      setMemberToken(token);
      setMemberId(mid);
      setIsCreator(creatorFromServer);
      setUploadEnabled(upload);
    },
    [code, storeSet],
  );

  // ─── SSE wiring ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (!memberToken) return;
    if (roomClosed) return;
    const sse = new CollectionSse(code, memberToken, {
      onMessage: (m) => {
        setMessages((prev) => {
          if (prev.some((x) => x.id === m.id)) return prev;
          return [...prev, m];
        });
      },
      onFile: (f) => {
        setFiles((prev) => {
          if (prev.some((x) => x.id === f.id)) return prev;
          return [...prev, f];
        });
      },
      onDeleted: ({ kind, id }) => {
        if (kind === 'message') {
          setMessages((prev) => prev.filter((x) => x.id !== id));
        } else {
          setFiles((prev) => prev.filter((x) => x.id !== id));
        }
      },
      onClosed: () => {
        setRoomClosed(true);
      },
      onError: (info) => {
        if (info.permanent) {
          toast.error(t('collection.errors.sseDisconnected'));
        }
      },
    });
    sse.start();
    sseRef.current = sse;
    return () => {
      sse.close();
      sseRef.current = null;
    };
  }, [code, memberToken, roomClosed, t]);

  // ─── "I'm the creator" admin verify flow ─────────────────────────────────
  const onClaimCreator = useCallback(async () => {
    if (!memberToken) return;
    const pw = window.prompt(t('collection.room.adminPasswordPrompt') ?? '');
    if (!pw) return;
    const ok = await adminVerify(code, memberToken, pw);
    if (!ok) {
      toast.error(t('collection.errors.adminVerifyFailed'));
      return;
    }
    setIsCreator(true);
    setAdminPassword(pw);
    storePatch(code, { isCreator: true, adminPassword: pw });
    toast.success(t('collection.room.adminVerified'));
  }, [code, memberToken, storePatch, t]);

  // Already-stored member → if it's our first mount, run a quick listFiles
  // bootstrap solely to learn our own memberId? The children components own
  // their own initial fetches, so we lift that to them and skip extra work
  // here. memberId stays null on a returning-member mount (the SSE plus the
  // children's panels still function — memberId only gates the "delete own"
  // affordance).

  // ─── If we have no token yet → render join form ─────────────────────────
  if (!memberToken) {
    return <JoinForm code={code} c={c} preview={preview} onJoined={onJoined} />;
  }

  // ─── Room toolbar ───────────────────────────────────────────────────────
  const toolbarStyle: CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    flexWrap: 'wrap',
    padding: '12px 14px',
    border: `1px solid ${c.soft}`,
    borderRadius: 10,
    marginBottom: 16,
  };
  const codeLabelStyle: CSSProperties = {
    fontSize: 12,
    color: c.sub,
    letterSpacing: '0.04em',
  };
  const codeStyle: CSSProperties = {
    fontSize: 18,
    color: c.ink,
    letterSpacing: '0.24em',
    fontVariantNumeric: 'tabular-nums',
  };
  const adminBtnStyle: CSSProperties = {
    marginLeft: 'auto',
    height: 36,
    padding: '0 12px',
    border: `1px solid ${c.soft}`,
    borderRadius: 8,
    background: 'transparent',
    color: c.ink,
    fontSize: 13,
    cursor: 'pointer',
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
  };

  // ─── Panels ─────────────────────────────────────────────────────────────
  const filesPanel = (
    <RoomFiles
      code={code}
      c={c}
      memberToken={memberToken}
      memberId={memberId}
      uploadEnabled={uploadEnabled && !roomClosed}
      isCreator={isCreator}
      adminPassword={adminPassword}
      storageBackend={storageBackend}
      files={files}
      setFiles={setFiles}
    />
  );

  const messagesPanel = (
    <RoomMessages
      code={code}
      c={c}
      memberToken={memberToken}
      memberId={memberId}
      isCreator={isCreator}
      adminPassword={adminPassword}
      inputDisabled={roomClosed}
      messages={messages}
      setMessages={setMessages}
    />
  );

  const tabBtnBase: CSSProperties = {
    flex: 1,
    height: 36,
    border: `1px solid ${c.soft}`,
    background: 'transparent',
    color: c.ink,
    fontSize: 13,
    cursor: 'pointer',
  };

  return (
    <div style={{ position: 'relative' }}>
      <div style={toolbarStyle}>
        <div>
          <div style={codeLabelStyle}>{t('collection.room.codeLabel')}</div>
          <div style={codeStyle}>{code}</div>
        </div>
        {preview.name ? (
          <div style={{ fontSize: 14, color: c.sub }}>{preview.name}</div>
        ) : null}
        {isCreator ? (
          <button
            type="button"
            onClick={() => setAdminOpen(true)}
            style={adminBtnStyle}
            title={t('collection.admin.admin') ?? ''}
          >
            <Settings size={14} />
            {t('collection.admin.admin')}
          </button>
        ) : (
          <button type="button" onClick={onClaimCreator} style={adminBtnStyle}>
            <ShieldCheck size={14} />
            {t('collection.room.claimCreator')}
          </button>
        )}
      </div>

      {roomClosed ? (
        <div
          style={{
            margin: '0 0 16px',
            padding: '12px 14px',
            border: `1px solid #c44`,
            color: '#c44',
            borderRadius: 10,
            background: 'transparent',
            fontSize: 13,
            textAlign: 'center',
          }}
        >
          {t('collection.room.closedBanner')}
        </div>
      ) : null}

      {/* Mobile tab switcher (hidden md+) */}
      <div
        className="md:hidden"
        style={{ display: 'flex', gap: 0, marginBottom: 12 }}
      >
        <button
          type="button"
          onClick={() => setMobileTab('files')}
          style={{
            ...tabBtnBase,
            borderTopLeftRadius: 8,
            borderBottomLeftRadius: 8,
            borderRight: 'none',
            background: mobileTab === 'files' ? `${c.accent}22` : 'transparent',
          }}
        >
          {t('collection.room.tabFiles')}
        </button>
        <button
          type="button"
          onClick={() => setMobileTab('messages')}
          style={{
            ...tabBtnBase,
            borderTopRightRadius: 8,
            borderBottomRightRadius: 8,
            background:
              mobileTab === 'messages' ? `${c.accent}22` : 'transparent',
          }}
        >
          {t('collection.room.tabMessages')}
        </button>
      </div>

      {/* Desktop: side-by-side. Mobile: only the active tab. */}
      <div className="grid gap-4 md:grid-cols-2">
        <div
          className={mobileTab === 'files' ? '' : 'hidden md:block'}
          style={{
            border: `1px solid ${c.soft}`,
            borderRadius: 10,
            padding: 14,
          }}
        >
          {filesPanel}
        </div>
        <div
          className={mobileTab === 'messages' ? '' : 'hidden md:block'}
          style={{
            border: `1px solid ${c.soft}`,
            borderRadius: 10,
            padding: 14,
            display: 'flex',
            flexDirection: 'column',
            minHeight: 320,
          }}
        >
          {messagesPanel}
        </div>
      </div>

      {isCreator && adminPassword ? (
        <RoomAdminModal
          open={adminOpen}
          onClose={() => setAdminOpen(false)}
          c={c}
          code={code}
          memberToken={memberToken}
          adminPassword={adminPassword}
          uploadEnabled={uploadEnabled}
          onUploadToggled={(enabled) => setUploadEnabled(enabled)}
          onRoomClosed={() => setRoomClosed(true)}
        />
      ) : null}
    </div>
  );
}

// ─── Top-level page ────────────────────────────────────────────────────────

export function CollectionRoomPage() {
  const { t } = useTranslation();
  const { code = '' } = useParams<{ code: string }>();

  const [preview, setPreview] = useState<PreviewCollectionResponse | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [config, setConfig] = useState<PublicConfig>(DEFAULT_CONFIG);

  useEffect(() => {
    let cancelled = false;
    setPreview(null);
    setNotFound(false);
    if (!code) {
      setNotFound(true);
      return;
    }
    previewCollection(code)
      .then((p) => {
        if (cancelled) return;
        setPreview(p);
      })
      .catch((err) => {
        if (cancelled) return;
        if (err instanceof ApiError && err.httpStatus === 404) {
          setNotFound(true);
        } else {
          const msg =
            err instanceof ApiError
              ? err.message
              : err instanceof Error
                ? err.message
                : 'preview failed';
          toast.error(msg);
          setNotFound(true);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [code]);

  // Public config — only needed for the storage_backend hint passed down to
  // RoomFiles' uploader. Failures fall back to DEFAULT_CONFIG.
  useEffect(() => {
    let cancelled = false;
    getConfig()
      .then((c) => {
        if (!cancelled) setConfig(c);
      })
      .catch(() => {
        /* ignored — DEFAULT_CONFIG is fine */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const storageBackend: StorageBackend = useMemo(
    () => (config.storage_backend ?? 'local') as StorageBackend,
    [config.storage_backend],
  );

  return (
    <CollectionShell>
      {(c) => {
        if (notFound) {
          return (
            <StatusCard
              c={c}
              title={t('collection.errors.roomNotFound')}
              body={code ? `${t('collection.room.codeLabel')}: ${code}` : undefined}
            />
          );
        }
        if (!preview) {
          return (
            <div
              style={{
                margin: '40px auto',
                maxWidth: 460,
                textAlign: 'center',
                color: c.sub,
                fontSize: 13,
              }}
            >
              {t('collection.room.loading')}
            </div>
          );
        }
        if (preview.closed) {
          return (
            <StatusCard
              c={c}
              title={t('collection.room.closedTitle')}
              body={`${t('collection.room.codeLabel')}: ${code}`}
            />
          );
        }
        return (
          <RoomView
            code={code}
            c={c}
            preview={preview}
            storageBackend={storageBackend}
          />
        );
      }}
    </CollectionShell>
  );
}

export default CollectionRoomPage;
