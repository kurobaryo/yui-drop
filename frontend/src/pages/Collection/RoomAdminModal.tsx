/**
 * RoomAdminModal — admin actions for a Collection room.
 *
 * Two primary actions:
 *   1. Toggle upload (Pause uploads / Resume uploads — label flips with state)
 *   2. Close room — requires a second-step red confirmation
 *
 * Wraps `components/ui/Modal`. The caller is responsible for opening + closing
 * (`open` + `onClose`); we surface `onUploadToggled` + `onRoomClosed` so the
 * parent can update its own state immediately rather than wait for the SSE
 * round-trip.
 */
import { useState, type CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, Pause, Play, X } from 'lucide-react';
import Modal from '@/components/ui/Modal';
import { adminCloseRoom, adminToggleUpload } from '@/lib/api/collection';
import { ApiError } from '@/lib/api';
import { toast } from '@/components/ui/Toast';
import type { WashiColors } from '@/variants/washi/palettes';

export interface RoomAdminModalProps {
  open: boolean;
  onClose: () => void;
  c: WashiColors;
  code: string;
  memberToken: string;
  adminPassword: string;
  uploadEnabled: boolean;
  onUploadToggled: (enabled: boolean) => void;
  onRoomClosed: () => void;
}

export function RoomAdminModal({
  open,
  onClose,
  c,
  code,
  memberToken,
  adminPassword,
  uploadEnabled,
  onUploadToggled,
  onRoomClosed,
}: RoomAdminModalProps) {
  const { t } = useTranslation();
  const [toggling, setToggling] = useState(false);
  const [closing, setClosing] = useState(false);
  const [confirmClose, setConfirmClose] = useState(false);

  const handleClose = () => {
    if (toggling || closing) return;
    setConfirmClose(false);
    onClose();
  };

  const onToggle = async () => {
    if (toggling) return;
    setToggling(true);
    try {
      const r = await adminToggleUpload(
        code,
        memberToken,
        adminPassword,
        !uploadEnabled,
      );
      onUploadToggled(r.upload_enabled);
    } catch (e) {
      const m =
        e instanceof ApiError ? e.message : t('collection.errors.serverError');
      toast.error(m);
    } finally {
      setToggling(false);
    }
  };

  const onCloseRoom = async () => {
    if (closing) return;
    setClosing(true);
    try {
      await adminCloseRoom(code, memberToken, adminPassword);
      onRoomClosed();
      // Don't auto-dismiss the modal here — the parent will lock the UI and
      // surface a "Room closed" banner; closing the modal is the user's call.
    } catch (e) {
      const m =
        e instanceof ApiError ? e.message : t('collection.errors.serverError');
      toast.error(m);
    } finally {
      setClosing(false);
      setConfirmClose(false);
    }
  };

  const sectionStyle: CSSProperties = {
    padding: '16px 18px',
    borderBottom: `1px solid ${c.soft}`,
  };
  const labelStyle: CSSProperties = {
    fontSize: 13,
    color: c.sub,
    letterSpacing: '0.04em',
    marginBottom: 8,
  };
  const primaryBtn: CSSProperties = {
    height: 40,
    padding: '0 16px',
    border: `1px solid ${c.soft}`,
    borderRadius: 8,
    background: 'transparent',
    color: c.ink,
    fontSize: 14,
    cursor: toggling ? 'wait' : 'pointer',
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
  };
  const dangerBtn: CSSProperties = {
    height: 40,
    padding: '0 16px',
    border: 'none',
    borderRadius: 8,
    background: '#c44',
    color: '#fff',
    fontSize: 14,
    cursor: closing ? 'wait' : 'pointer',
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
  };
  const subBtn: CSSProperties = {
    height: 40,
    padding: '0 14px',
    border: `1px solid ${c.soft}`,
    borderRadius: 8,
    background: 'transparent',
    color: c.ink,
    fontSize: 13,
    cursor: 'pointer',
  };

  return (
    <Modal
      open={open}
      onClose={handleClose}
      title={t('collection.admin.admin')}
      widthClassName="w-[90vw] max-w-md"
    >
      <div style={{ background: c.paper, color: c.ink }}>
        <div style={sectionStyle}>
          <div style={labelStyle}>{t('collection.room.uploadFiles')}</div>
          <button type="button" onClick={onToggle} disabled={toggling} style={primaryBtn}>
            {uploadEnabled ? <Pause size={14} /> : <Play size={14} />}
            {uploadEnabled
              ? t('collection.admin.pauseUploads')
              : t('collection.admin.resumeUploads')}
          </button>
        </div>

        <div style={{ ...sectionStyle, borderBottom: 'none' }}>
          <div style={labelStyle}>{t('collection.admin.closeRoom')}</div>
          {!confirmClose ? (
            <button
              type="button"
              onClick={() => setConfirmClose(true)}
              style={dangerBtn}
            >
              <X size={14} />
              {t('collection.admin.closeRoom')}
            </button>
          ) : (
            <div>
              <div
                style={{
                  display: 'flex',
                  gap: 8,
                  alignItems: 'flex-start',
                  marginBottom: 12,
                  color: '#c44',
                  fontSize: 13,
                }}
              >
                <AlertTriangle size={16} style={{ marginTop: 2, flexShrink: 0 }} />
                <div>{t('collection.admin.closeConfirm')}</div>
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  type="button"
                  onClick={() => setConfirmClose(false)}
                  disabled={closing}
                  style={subBtn}
                >
                  {t('collection.common.cancel')}
                </button>
                <button
                  type="button"
                  onClick={() => void onCloseRoom()}
                  disabled={closing}
                  style={dangerBtn}
                >
                  <X size={14} />
                  {t('collection.admin.closeRoom')}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
}

export default RoomAdminModal;
