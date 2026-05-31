/**
 * Create — `/collection/new`.
 *
 * Form fields per brief:
 *   - name (optional)
 *   - visibility radio (public | creator_only)
 *   - entry password (optional + show/hide)
 *   - admin password (required ≥4 + show/hide)
 *   - lifetime (radio: 1d / 7d / 30d / 365d / custom days / permanent)
 *
 * On submit → POST /api/collections, then navigate to `/c/{code}`. The first
 * join is performed inside Room.tsx (so the creator gets a normal
 * member_token; admin status is later acquired via /admin/verify).
 *
 * Layout (v0.3.9): two-column grid matching SendFile/SendText. Left card holds
 * room identity (name + visibility + passwords); right card holds lifetime
 * choice. The CTA spans both columns underneath. This keeps the page visually
 * "of a piece" with the rest of the washi tabs — uppercase section labels,
 * the same border/padding/radius treatment, the same `Forge … →` button voice.
 */
import {
  useState,
  type CSSProperties,
  type FormEvent,
  type ReactNode,
} from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Eye, EyeOff } from 'lucide-react';
import { CollectionShell } from './Shell';
import {
  createCollection,
  type CollectionVisibility,
} from '@/lib/api/collection';
import { ApiError } from '@/lib/api';
import { toast } from '@/components/ui/Toast';
import { useCollectionMemberStore } from '@/stores/collectionMember';
import { pushRecent } from '@/lib/recent';
import type { WashiColors } from '@/variants/washi/palettes';

type LifetimePreset = '1' | '7' | '30' | '365' | 'custom' | 'permanent';

function Inner({ c }: { c: WashiColors }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const setMember = useCollectionMemberStore((s) => s.set);

  const [name, setName] = useState('');
  const [visibility, setVisibility] = useState<CollectionVisibility>('public');
  const [entryPassword, setEntryPassword] = useState('');
  const [showEntryPw, setShowEntryPw] = useState(false);
  const [adminPassword, setAdminPassword] = useState('');
  const [showAdminPw, setShowAdminPw] = useState(false);
  const [lifetimePreset, setLifetimePreset] = useState<LifetimePreset>('7');
  const [customDays, setCustomDays] = useState('14');
  const [submitting, setSubmitting] = useState(false);

  // Mirrors the parts/Expiry treatment in SendFile / SendText so all
  // three forms read as the same family. Soft cream block, uppercase
  // 12px section label, 10–18px padding.
  const cardStyle: CSSProperties = {
    border: `1px solid ${c.soft}`,
    borderRadius: 10,
    padding: 18,
    background: `${c.ink}04`,
  };

  // Same as parts/Expiry's section header (e.g. "EXPIRY").
  const sectionLabelStyle: CSSProperties = {
    fontSize: 12,
    color: c.sub,
    letterSpacing: '0.08em',
    textTransform: 'uppercase',
    marginBottom: 12,
  };

  const fieldLabelStyle: CSSProperties = {
    display: 'block',
    fontSize: 11,
    color: c.sub,
    letterSpacing: '0.08em',
    textTransform: 'uppercase',
    marginTop: 16,
    marginBottom: 6,
  };

  // First field label inside a card — no top margin so it sits directly
  // under the section title.
  const fieldLabelFirstStyle: CSSProperties = {
    ...fieldLabelStyle,
    marginTop: 0,
  };

  const inputStyle: CSSProperties = {
    width: '100%',
    height: 38,
    border: `1px solid ${c.soft}`,
    borderRadius: 6,
    background: 'transparent',
    color: c.ink,
    padding: '0 10px',
    fontSize: 13,
    boxSizing: 'border-box',
    outline: 'none',
    fontFamily: 'inherit',
  };
  const inputWithToggle: CSSProperties = { ...inputStyle, paddingRight: 36 };

  const helperStyle: CSSProperties = {
    fontSize: 11,
    color: c.sub,
    marginTop: 6,
    lineHeight: 1.5,
  };

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (submitting) return;
    if (adminPassword.length < 4) {
      toast.error(t('collection.errors.adminPasswordTooShort'));
      return;
    }
    let lifetime_days: number | null;
    if (lifetimePreset === 'permanent') lifetime_days = null;
    else if (lifetimePreset === 'custom') {
      const n = parseInt(customDays, 10);
      if (!Number.isFinite(n) || n < 1 || n > 365) {
        toast.error(t('collection.errors.customDaysRange'));
        return;
      }
      lifetime_days = n;
    } else {
      lifetime_days = parseInt(lifetimePreset, 10);
    }

    setSubmitting(true);
    try {
      const res = await createCollection({
        name: name.trim() || null,
        visibility,
        entry_password: entryPassword || null,
        admin_password: adminPassword,
        lifetime_days,
      });
      // Persist the auto-issued creator token so Room.tsx skips the join form.
      if (res.member_token && res.member_id != null) {
        setMember(res.code, {
          memberToken: res.member_token,
          nickname: 'Owner',
          isCreator: true,
          adminPassword,
        });
      }
      pushRecent({
        code: res.code,
        kind: 'collection',
        name: res.name ?? null,
        created_at: new Date().toISOString(),
        expires_at: res.expires_at ?? null,
        isCreator: true,
      });
      // Hand off to Room.tsx — it picks up the freshly created code and
      // uses the persisted member token instead of re-prompting for /join.
      navigate(`/c/${res.code}?created=1`);
    } catch (e) {
      if (e instanceof ApiError) {
        toast.error(e.message || t('collection.errors.createFailed'));
      } else {
        toast.error(t('collection.errors.createFailed'));
      }
      setSubmitting(false);
    }
  };

  const Pill = ({
    active,
    onClick,
    children,
  }: {
    active: boolean;
    onClick: () => void;
    children: ReactNode;
  }) => (
    <button
      type="button"
      onClick={onClick}
      style={{
        padding: '8px 14px',
        borderRadius: 999,
        border: `1px solid ${active ? c.accent : c.soft}`,
        background: active ? c.accent : 'transparent',
        color: active ? '#fff' : c.ink,
        fontSize: 13,
        cursor: 'pointer',
        fontFamily: 'inherit',
      }}
    >
      {children}
    </button>
  );

  // Lifetime preset tile — matches the date-grid look in parts/Expiry.
  const PresetTile = ({
    active,
    onClick,
    children,
  }: {
    active: boolean;
    onClick: () => void;
    children: ReactNode;
  }) => (
    <button
      type="button"
      onClick={onClick}
      style={{
        padding: '10px 8px',
        border: `1px solid ${active ? c.accent : c.soft}`,
        background: active ? `${c.accent}15` : 'transparent',
        color: active ? c.accent : c.ink,
        borderRadius: 6,
        cursor: 'pointer',
        fontFamily: 'inherit',
        fontSize: 12,
        fontWeight: 500,
      }}
    >
      {children}
    </button>
  );

  const canSubmit = adminPassword.length >= 4 && !submitting;

  return (
    <div>
      <h1
        style={{
          fontFamily: '"Noto Serif JP", "Noto Serif SC", serif',
          fontSize: 32,
          margin: 0,
          marginBottom: 4,
        }}
      >
        {t('collection.create.title')}
      </h1>
      <p style={{ color: c.sub, fontSize: 13, marginTop: 0, marginBottom: 24 }}>
        {t('collection.create.subtitle')}
      </p>

      <form onSubmit={onSubmit}>
        <div
          data-yui="two-col"
          style={{
            display: 'grid',
            gridTemplateColumns: '1.2fr 1fr',
            gap: 28,
            alignItems: 'stretch',
          }}
        >
          {/* Left card — ROOM */}
          <div style={cardStyle}>
            <div style={sectionLabelStyle}>
              {t('collection.create.sectionRoom')}
            </div>

            <label style={fieldLabelFirstStyle}>
              {t('collection.create.nameLabel')}
            </label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={80}
              placeholder={t('collection.create.namePlaceholder') ?? ''}
              style={inputStyle}
            />

            <label style={fieldLabelStyle}>
              {t('collection.create.visibilityLabel')}
            </label>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              <Pill
                active={visibility === 'public'}
                onClick={() => setVisibility('public')}
              >
                {t('collection.create.visibilityPublic')}
              </Pill>
              <Pill
                active={visibility === 'creator_only'}
                onClick={() => setVisibility('creator_only')}
              >
                {t('collection.create.visibilityCreatorOnly')}
              </Pill>
            </div>
            <div style={helperStyle}>
              {visibility === 'public'
                ? t('collection.create.visibilityPublicHint')
                : t('collection.create.visibilityCreatorOnlyHint')}
            </div>

            <label style={fieldLabelStyle}>
              {t('collection.create.entryPasswordLabel')}
            </label>
            <div style={{ position: 'relative' }}>
              <input
                type={showEntryPw ? 'text' : 'password'}
                value={entryPassword}
                onChange={(e) => setEntryPassword(e.target.value)}
                autoComplete="new-password"
                placeholder={t('collection.create.entryPasswordPlaceholder') ?? ''}
                style={inputWithToggle}
              />
              <button
                type="button"
                aria-label={showEntryPw ? 'hide' : 'show'}
                onClick={() => setShowEntryPw((v) => !v)}
                style={{
                  position: 'absolute',
                  top: 0,
                  right: 0,
                  height: 38,
                  width: 36,
                  border: 'none',
                  background: 'transparent',
                  color: c.sub,
                  cursor: 'pointer',
                }}
              >
                {showEntryPw ? <EyeOff size={15} /> : <Eye size={15} />}
              </button>
            </div>

            <label style={fieldLabelStyle}>
              {t('collection.create.adminPasswordLabel')}
            </label>
            <div style={{ position: 'relative' }}>
              <input
                type={showAdminPw ? 'text' : 'password'}
                value={adminPassword}
                onChange={(e) => setAdminPassword(e.target.value)}
                autoComplete="new-password"
                required
                minLength={4}
                placeholder={t('collection.create.adminPasswordPlaceholder') ?? ''}
                style={inputWithToggle}
              />
              <button
                type="button"
                aria-label={showAdminPw ? 'hide' : 'show'}
                onClick={() => setShowAdminPw((v) => !v)}
                style={{
                  position: 'absolute',
                  top: 0,
                  right: 0,
                  height: 38,
                  width: 36,
                  border: 'none',
                  background: 'transparent',
                  color: c.sub,
                  cursor: 'pointer',
                }}
              >
                {showAdminPw ? <EyeOff size={15} /> : <Eye size={15} />}
              </button>
            </div>
            <div style={helperStyle}>
              {t('collection.create.adminPasswordHint')}
            </div>
          </div>

          {/* Right card — LIFETIME (mirrors parts/Expiry visually) */}
          <div style={cardStyle}>
            <div style={sectionLabelStyle}>
              {t('collection.create.lifetimeLabel')}
            </div>

            <div
              style={{
                display: 'grid',
                gridTemplateColumns: '1fr 1fr 1fr',
                gap: 6,
              }}
            >
              <PresetTile
                active={lifetimePreset === '1'}
                onClick={() => setLifetimePreset('1')}
              >
                {t('collection.create.lifetime1d')}
              </PresetTile>
              <PresetTile
                active={lifetimePreset === '7'}
                onClick={() => setLifetimePreset('7')}
              >
                {t('collection.create.lifetime7d')}
              </PresetTile>
              <PresetTile
                active={lifetimePreset === '30'}
                onClick={() => setLifetimePreset('30')}
              >
                {t('collection.create.lifetime30d')}
              </PresetTile>
              <PresetTile
                active={lifetimePreset === '365'}
                onClick={() => setLifetimePreset('365')}
              >
                {t('collection.create.lifetime365d')}
              </PresetTile>
              <PresetTile
                active={lifetimePreset === 'permanent'}
                onClick={() => setLifetimePreset('permanent')}
              >
                {t('collection.create.lifetimePermanent')}
              </PresetTile>
              <PresetTile
                active={lifetimePreset === 'custom'}
                onClick={() => setLifetimePreset('custom')}
              >
                {t('collection.create.lifetimeCustom')}
              </PresetTile>
            </div>

            {lifetimePreset === 'custom' && (
              <div
                style={{
                  marginTop: 12,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                }}
              >
                <span style={{ fontSize: 11, color: c.sub }}>
                  {t('washi.customDays')}:
                </span>
                <input
                  type="number"
                  min={1}
                  max={365}
                  value={customDays}
                  onChange={(e) => setCustomDays(e.target.value)}
                  placeholder="—"
                  style={{
                    flex: 1,
                    padding: '7px 10px',
                    border: `1px solid ${c.soft}`,
                    background: 'transparent',
                    color: c.ink,
                    borderRadius: 6,
                    fontFamily: 'inherit',
                    fontSize: 13,
                    outline: 'none',
                  }}
                />
                <span style={{ fontSize: 11, color: c.sub }}>
                  {t('collection.create.customDaysUnit')}
                </span>
              </div>
            )}

            {/* Expiry preview — gives the right column a footer to match
                the helper text on the left column, and surfaces a real
                date so the user knows what they just picked. */}
            <div style={{ ...helperStyle, marginTop: 14 }}>
              {(() => {
                if (lifetimePreset === 'permanent') {
                  return t('collection.create.expiresPreviewPermanent');
                }
                let days: number;
                if (lifetimePreset === 'custom') {
                  const n = parseInt(customDays, 10);
                  if (!Number.isFinite(n) || n < 1) {
                    return t('collection.create.expiresPreviewInvalid');
                  }
                  days = Math.min(n, 365);
                } else {
                  days = parseInt(lifetimePreset, 10);
                }
                const dt = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
                const formatted = dt.toLocaleDateString(undefined, {
                  year: 'numeric',
                  month: 'short',
                  day: 'numeric',
                });
                return t('collection.create.expiresPreview', {
                  date: formatted,
                });
              })()}
            </div>
          </div>
        </div>

        {/* Full-width CTA — matches the SendFile "Forge code →" voice. */}
        <button
          type="submit"
          disabled={!canSubmit}
          style={{
            marginTop: 20,
            width: '100%',
            padding: '14px 18px',
            background: canSubmit ? c.accent : c.soft,
            color: canSubmit ? c.paper : c.sub,
            border: 'none',
            borderRadius: 8,
            cursor: canSubmit ? 'pointer' : (submitting ? 'wait' : 'not-allowed'),
            fontFamily: 'inherit',
            fontWeight: 600,
            fontSize: 15,
            opacity: submitting ? 0.7 : 1,
          }}
        >
          {submitting
            ? t('collection.create.submitting')
            : `${t('collection.create.submit')}  →`}
        </button>
      </form>
    </div>
  );
}

export default function Create() {
  return <CollectionShell>{(c) => <Inner c={c} />}</CollectionShell>;
}
