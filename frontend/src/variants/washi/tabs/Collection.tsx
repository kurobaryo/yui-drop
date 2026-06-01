/**
 * Collection — tab content for the "收集箱 / Collection" entry on the home page.
 *
 * v0.3.10: the home tab now shows the FULL create form inline (no more
 * "more options" link → /collection/new round-trip). All fields that used to
 * live only on the dedicated /collection/new page are surfaced directly here:
 *
 *   - name (optional)
 *   - visibility (public | creator_only) + hint
 *   - entry password (optional + show/hide)
 *   - admin password (required ≥4 + show/hide)
 *   - lifetime (1d / 7d / 30d / 365d / custom days / permanent) + expiry preview
 *
 * Layout mirrors SendFile / SendText / Create.tsx: a `data-yui="two-col"` grid
 * (left ROOM card + right LIFETIME card, folds to one column ≤720px) with a
 * full-width CTA underneath. The dedicated /collection/new page (Create.tsx) is
 * kept because the /collection landing page still links to it; this tab is now
 * functionally equivalent so most users never need to leave the home page.
 *
 * The admin password is required because every room MUST be lockable; without
 * one a hostile peer with the code could close / wipe the room.
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
import {
  createCollection,
  type CollectionVisibility,
} from '@/lib/api/collection';
import { ApiError } from '@/lib/api';
import { toast } from '@/components/ui/Toast';
import { useCollectionMemberStore } from '@/stores/collectionMember';
import { pushRecent } from '@/lib/recent';
import type { WashiColors } from '../palettes';

type LifetimePreset = '1' | '7' | '30' | '365' | 'custom' | 'permanent';

export interface CollectionProps {
  c: WashiColors;
}

export function Collection({ c }: CollectionProps) {
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
  const [creating, setCreating] = useState(false);

  // Mirrors the parts/Expiry treatment in SendFile / SendText / Create so all
  // forms read as the same family. Soft cream block, uppercase 12px section
  // label, 18px padding.
  const cardStyle: CSSProperties = {
    border: `1px solid ${c.soft}`,
    borderRadius: 10,
    padding: 18,
    background: `${c.ink}04`,
  };

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

  // First field label inside a card — no top margin so it sits directly under
  // the section title.
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

  const onCreate = async (e: FormEvent) => {
    e.preventDefault();
    if (creating) return;
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

    setCreating(true);
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
      // Surface this room in the "最近收集箱" panel so the user can hop back
      // in from the home page later.
      pushRecent({
        code: res.code,
        kind: 'collection',
        name: res.name ?? null,
        created_at: new Date().toISOString(),
        expires_at: res.expires_at ?? null,
        isCreator: true,
      });
      navigate(`/c/${res.code}?created=1`);
    } catch (err) {
      if (err instanceof ApiError) {
        toast.error(err.message || t('collection.errors.createFailed'));
      } else {
        toast.error(t('collection.errors.createFailed'));
      }
      setCreating(false);
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

  const canSubmit = adminPassword.length >= 4 && !creating;

  return (
    <form onSubmit={onCreate}>
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

          {/* Expiry preview — gives the right column a footer to match the
              helper text on the left column, and surfaces a real date so the
              user knows what they just picked. */}
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
          height: 46,
          border: 'none',
          borderRadius: 10,
          background: canSubmit ? c.accent : c.soft,
          color: canSubmit ? '#fff' : c.sub,
          fontSize: 14.5,
          letterSpacing: '0.06em',
          cursor: canSubmit ? 'pointer' : 'not-allowed',
          fontFamily: 'inherit',
        }}
      >
        {creating
          ? t('collection.create.submitting')
          : t('collection.quick.createBtn')}
      </button>
    </form>
  );
}

export default Collection;
