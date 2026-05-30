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

  const sectionStyle: CSSProperties = {
    border: `1px solid ${c.soft}`,
    borderRadius: 12,
    padding: '18px 20px',
    marginTop: 16,
  };
  const labelStyle: CSSProperties = {
    fontSize: 13,
    color: c.sub,
    letterSpacing: '0.06em',
    marginBottom: 8,
    display: 'block',
  };
  const inputStyle: CSSProperties = {
    width: '100%',
    height: 42,
    border: `1px solid ${c.soft}`,
    borderRadius: 8,
    background: 'transparent',
    color: c.ink,
    padding: '0 12px',
    fontSize: 14,
    boxSizing: 'border-box',
    outline: 'none',
  };
  const inputWithToggle: CSSProperties = { ...inputStyle, paddingRight: 40 };
  const radioRowStyle: CSSProperties = {
    display: 'flex',
    flexWrap: 'wrap',
    gap: 14,
    rowGap: 10,
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
      }}
    >
      {children}
    </button>
  );

  return (
    <div style={{ maxWidth: 560, margin: '0 auto' }}>
      <h1
        style={{
          fontFamily: '"Noto Serif JP", "Noto Serif SC", serif',
          fontSize: 36,
          margin: 0,
          marginBottom: 6,
        }}
      >
        {t('collection.create.title')}
      </h1>
      <p style={{ color: c.sub, fontSize: 14, marginTop: 0, marginBottom: 10 }}>
        {t('collection.create.subtitle')}
      </p>

      <form onSubmit={onSubmit}>
        <div style={sectionStyle}>
          <label style={labelStyle}>{t('collection.create.nameLabel')}</label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={80}
            placeholder={t('collection.create.namePlaceholder') ?? ''}
            style={inputStyle}
          />
        </div>

        <div style={sectionStyle}>
          <label style={labelStyle}>
            {t('collection.create.visibilityLabel')}
          </label>
          <div style={radioRowStyle}>
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
          <div style={{ fontSize: 12, color: c.sub, marginTop: 10 }}>
            {visibility === 'public'
              ? t('collection.create.visibilityPublicHint')
              : t('collection.create.visibilityCreatorOnlyHint')}
          </div>
        </div>

        <div style={sectionStyle}>
          <label style={labelStyle}>
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
                height: 42,
                width: 40,
                border: 'none',
                background: 'transparent',
                color: c.sub,
                cursor: 'pointer',
              }}
            >
              {showEntryPw ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
          </div>
        </div>

        <div style={sectionStyle}>
          <label style={labelStyle}>
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
                height: 42,
                width: 40,
                border: 'none',
                background: 'transparent',
                color: c.sub,
                cursor: 'pointer',
              }}
            >
              {showAdminPw ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
          </div>
          <div style={{ fontSize: 12, color: c.sub, marginTop: 6 }}>
            {t('collection.create.adminPasswordHint')}
          </div>
        </div>

        <div style={sectionStyle}>
          <label style={labelStyle}>
            {t('collection.create.lifetimeLabel')}
          </label>
          <div style={radioRowStyle}>
            <Pill
              active={lifetimePreset === '1'}
              onClick={() => setLifetimePreset('1')}
            >
              {t('collection.create.lifetime1d')}
            </Pill>
            <Pill
              active={lifetimePreset === '7'}
              onClick={() => setLifetimePreset('7')}
            >
              {t('collection.create.lifetime7d')}
            </Pill>
            <Pill
              active={lifetimePreset === '30'}
              onClick={() => setLifetimePreset('30')}
            >
              {t('collection.create.lifetime30d')}
            </Pill>
            <Pill
              active={lifetimePreset === '365'}
              onClick={() => setLifetimePreset('365')}
            >
              {t('collection.create.lifetime365d')}
            </Pill>
            <Pill
              active={lifetimePreset === 'custom'}
              onClick={() => setLifetimePreset('custom')}
            >
              {t('collection.create.lifetimeCustom')}
            </Pill>
            <Pill
              active={lifetimePreset === 'permanent'}
              onClick={() => setLifetimePreset('permanent')}
            >
              {t('collection.create.lifetimePermanent')}
            </Pill>
          </div>
          {lifetimePreset === 'custom' && (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                marginTop: 12,
              }}
            >
              <input
                type="number"
                min={1}
                max={365}
                value={customDays}
                onChange={(e) => setCustomDays(e.target.value)}
                style={{ ...inputStyle, width: 120 }}
              />
              <span style={{ color: c.sub, fontSize: 13 }}>
                {t('collection.create.customDaysUnit')}
              </span>
            </div>
          )}
        </div>

        <button
          type="submit"
          disabled={submitting}
          style={{
            marginTop: 22,
            width: '100%',
            height: 50,
            border: 'none',
            borderRadius: 10,
            background: c.accent,
            color: '#fff',
            fontSize: 15,
            letterSpacing: '0.06em',
            cursor: submitting ? 'wait' : 'pointer',
            opacity: submitting ? 0.6 : 1,
          }}
        >
          {submitting
            ? t('collection.create.submitting')
            : t('collection.create.submit')}
        </button>
      </form>
    </div>
  );
}

export default function Create() {
  return <CollectionShell>{(c) => <Inner c={c} />}</CollectionShell>;
}
