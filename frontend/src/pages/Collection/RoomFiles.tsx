/**
 * RoomFiles — file panel rendered inside Room.tsx.
 *
 * Responsibilities:
 *   - render a scrollable list of files (name, size, uploader, time)
 *   - drag-drop zone + "Choose files" button when upload_enabled
 *   - per-file delete button (when allowed: own file within 5min OR isCreator)
 *   - download links (signed by the server via `?token=` query)
 *
 * The actual upload pipeline lives in `lib/uploader.ts` (`uploadFilesToCollection`).
 * This component owns the per-file progress overlay during in-flight uploads.
 */
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type DragEvent,
} from 'react';
import { useTranslation } from 'react-i18next';
import { Download, Trash2, Upload } from 'lucide-react';
import {
  type CollectionFile,
  deleteFile,
  triggerFileDownload,
  listFiles,
} from '@/lib/api/collection';
import {
  uploadFilesToCollection,
  type StorageBackend,
  type UploadFileState,
  type UploadFilesToCollectionHandle,
} from '@/lib/uploader';
import { ApiError } from '@/lib/api';
import { safeFormatDateTime } from '@/lib/safeDate';
import { toast } from '@/components/ui/Toast';
import type { WashiColors } from '@/variants/washi/palettes';
import { fmtSize } from '@/variants/washi/utils';

const FIVE_MIN_MS = 5 * 60 * 1000;

export interface RoomFilesProps {
  code: string;
  c: WashiColors;
  memberToken: string;
  memberId: number | null;
  uploadEnabled: boolean;
  isCreator: boolean;
  adminPassword?: string | null;
  storageBackend: StorageBackend;
  files: CollectionFile[];
  /** Setter — used after upload + after server-side delete. */
  setFiles: (updater: (prev: CollectionFile[]) => CollectionFile[]) => void;
}

interface PendingUpload {
  index: number;
  name: string;
  size: number;
  fraction: number;
  state: UploadFileState;
}

export function RoomFiles({
  code,
  c,
  memberToken,
  memberId,
  uploadEnabled,
  isCreator,
  adminPassword,
  storageBackend,
  files,
  setFiles,
}: RoomFilesProps) {
  const { t } = useTranslation();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const handleRef = useRef<UploadFilesToCollectionHandle | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [pending, setPending] = useState<PendingUpload[]>([]);

  // Initial load.
  useEffect(() => {
    let cancelled = false;
    listFiles(code, memberToken)
      .then((r) => {
        if (cancelled) return;
        setFiles(() => r.files);
      })
      .catch(() => {
        /* SSE will catch us up if this transient fails */
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code, memberToken]);

  useEffect(() => () => handleRef.current?.abort(), []);

  const onPickFiles = () => inputRef.current?.click();

  const startUpload = (selected: File[]) => {
    if (!selected.length) return;
    if (!uploadEnabled) {
      toast.error(t('collection.errors.uploadDisabled'));
      return;
    }
    const initial: PendingUpload[] = selected.map((f, i) => ({
      index: i,
      name: f.name,
      size: f.size,
      fraction: 0,
      state: 'pending',
    }));
    setPending(initial);

    const h = uploadFilesToCollection({
      collectionCode: code,
      memberToken,
      files: selected,
      storageBackend,
      onFileProgress: (i, frac) =>
        setPending((prev) =>
          prev.map((p) => (p.index === i ? { ...p, fraction: frac } : p)),
        ),
      onFileState: (i, state) =>
        setPending((prev) =>
          prev.map((p) => (p.index === i ? { ...p, state } : p)),
        ),
    });
    handleRef.current = h;
    h.promise
      .then(() => {
        // SSE will deliver the canonical CollectionFile records; we just
        // clear the pending overlay after a short grace so the UI doesn't
        // flash empty between "100%" and the SSE event arriving.
        window.setTimeout(() => setPending([]), 600);
      })
      .catch((e) => {
        const msg =
          e instanceof ApiError
            ? e.message
            : e instanceof Error
              ? e.message
              : 'upload failed';
        toast.error(msg);
        setPending([]);
      });
  };

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    if (!e.dataTransfer?.files?.length) return;
    startUpload(Array.from(e.dataTransfer.files));
  };

  const canDelete = (f: CollectionFile): boolean => {
    if (isCreator) return true;
    if (memberId != null && f.member_id === memberId) {
      const age = Date.now() - new Date(f.created_at).getTime();
      return age < FIVE_MIN_MS;
    }
    return false;
  };

  const onDelete = async (f: CollectionFile) => {
    if (!confirm(t('collection.confirmations.deleteFile'))) return;
    try {
      await deleteFile(code, f.id, memberToken, isCreator ? adminPassword : null);
      setFiles((prev) => prev.filter((x) => x.id !== f.id));
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : t('collection.errors.deleteFailed');
      toast.error(msg);
    }
  };

  const dropZoneStyle: CSSProperties = {
    border: `1.5px dashed ${dragOver ? c.accent : c.soft}`,
    borderRadius: 12,
    padding: '22px 18px',
    textAlign: 'center',
    background: dragOver ? `${c.accent}11` : 'transparent',
    transition: 'all 120ms',
    cursor: uploadEnabled ? 'pointer' : 'not-allowed',
    opacity: uploadEnabled ? 1 : 0.55,
  };

  const sortedFiles = useMemo(
    () =>
      [...files].sort(
        (a, b) =>
          new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
      ),
    [files],
  );

  return (
    <div>
      <div style={{ fontSize: 13, color: c.sub, marginBottom: 10 }}>
        {t('collection.room.filesHeader', { count: files.length })}
      </div>

      <div
        style={dropZoneStyle}
        onClick={uploadEnabled ? onPickFiles : undefined}
        onDragOver={(e) => {
          if (!uploadEnabled) return;
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={uploadEnabled ? onDrop : undefined}
      >
        <Upload size={20} style={{ color: c.accent }} />
        <div style={{ marginTop: 8, fontSize: 14 }}>
          {uploadEnabled
            ? t('collection.room.dropHint')
            : t('collection.room.uploadDisabled')}
        </div>
        <input
          ref={inputRef}
          type="file"
          multiple
          hidden
          onChange={(e) => {
            const arr = e.target.files ? Array.from(e.target.files) : [];
            startUpload(arr);
            e.currentTarget.value = '';
          }}
        />
      </div>

      {pending.length > 0 && (
        <div style={{ marginTop: 14 }}>
          {pending.map((p) => (
            <div
              key={p.index}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                padding: '8px 10px',
                border: `1px solid ${c.soft}`,
                borderRadius: 8,
                marginBottom: 6,
              }}
            >
              <div style={{ flex: 1, minWidth: 0 }}>
                <div
                  style={{
                    fontSize: 13,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {p.name}
                </div>
                <div
                  style={{
                    marginTop: 6,
                    height: 4,
                    background: c.soft,
                    borderRadius: 2,
                    overflow: 'hidden',
                  }}
                >
                  <div
                    style={{
                      width: `${Math.round(p.fraction * 100)}%`,
                      height: '100%',
                      background: p.state === 'failed' ? '#c44' : c.accent,
                      transition: 'width 120ms',
                    }}
                  />
                </div>
              </div>
              <div style={{ fontSize: 12, color: c.sub, minWidth: 48, textAlign: 'right' }}>
                {p.state === 'failed'
                  ? t('collection.room.uploadFailed')
                  : `${Math.round(p.fraction * 100)}%`}
              </div>
            </div>
          ))}
        </div>
      )}

      <div style={{ marginTop: 18 }}>
        {sortedFiles.length === 0 ? (
          <div
            style={{
              color: c.sub,
              fontSize: 13,
              textAlign: 'center',
              padding: '22px 0',
            }}
          >
            {t('collection.room.filesEmpty')}
          </div>
        ) : (
          sortedFiles.map((f) => (
            <div
              key={f.id}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                padding: '10px 12px',
                border: `1px solid ${c.soft}`,
                borderRadius: 8,
                marginBottom: 6,
              }}
            >
              <div style={{ flex: 1, minWidth: 0 }}>
                <div
                  style={{
                    fontSize: 14,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {f.name}
                </div>
                <div style={{ fontSize: 12, color: c.sub, marginTop: 2 }}>
                  {fmtSize(f.size)} · {f.nickname} ·{' '}
                  {safeFormatDateTime(f.created_at)}
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  triggerFileDownload(code, f.id, memberToken).catch((e) => {
                    const msg = e instanceof Error ? e.message : 'download failed';
                    toast.error(msg);
                  });
                }}
                title={t('collection.room.download') ?? ''}
                style={{
                  border: 'none',
                  background: 'transparent',
                  color: c.accent,
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  width: 32,
                  height: 32,
                  borderRadius: 6,
                  cursor: 'pointer',
                }}
              >
                <Download size={16} />
              </button>
              {canDelete(f) && (
                <button
                  type="button"
                  onClick={() => onDelete(f)}
                  title={t('collection.room.delete') ?? ''}
                  style={{
                    border: 'none',
                    background: 'transparent',
                    color: c.sub,
                    width: 32,
                    height: 32,
                    borderRadius: 6,
                    cursor: 'pointer',
                  }}
                >
                  <Trash2 size={16} />
                </button>
              )}
            </div>
          ))
        )}
      </div>

      {/* End of file list */}
    </div>
  );
}

export default RoomFiles;
