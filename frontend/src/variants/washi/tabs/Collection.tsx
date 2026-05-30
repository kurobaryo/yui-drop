/**
 * Collection — tab content for the "收集箱 / Collection" entry on the home page.
 *
 * Intentionally minimal so the home tab feels as light as Pickup/SendFile/
 * SendText. Two affordances stacked:
 *
 *   1. Enter an existing room code → navigate to /c/{code}
 *   2. Quick-create — a 3-field one-screen form (admin password +
 *      visibility + lifetime). Power users can still hit /collection/new
 *      for the full form with optional name + entry password + custom
 *      lifetime via the "more options" link.
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
import { Eye, EyeOff, Plus } from 'lucide-react';
import {
  createCollection,
  type CollectionVisibility,
} from '@/lib/api/collection';
import { ApiError } from '@/lib/api';
import { toast } from '@/components/ui/Toast';
import type { WashiColors } from '../palettes';

type QuickLifetime = '7' | '30' | 'permanent';

export interface CollectionProps {
  c: WashiColors;
}

export function Collection({ c }: CollectionProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();

  const [code, setCode] = useState('');
  const [codeError, setCodeError] = useState<string | null>(null);

  const [adminPassword, setAdminPassword] = useState('');
  const [showAdminPw, setShowAdminPw] = useState(false);
  const [visibility, setVisibility] = useState<CollectionVisibility>('public');
  const [lifetime, setLifetime] = useState<QuickLifetime>('7');
  const [creating, setCreating] = useState(false);

  const sanitizedCode = code.replace(/\D/g, '').slice(0, 6);

  const sectionStyle: CSSProperties = {
    border: `1px solid ${c.soft}`,
    borderRadius: 12,
    padding: '20px 22px',
    background: c.paper,
  };

  const labelStyle: CSSProperties = {
    display: 'block',
    fontSize: 12,
    color: c.sub,
    letterSpacing: '0.08em',
    marginBottom: 10,
    textTransform: 'uppercase',
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
    fontFamily: 'inherit',
  };

  const inputWithToggle: CSSProperties = { ...inputStyle, paddingRight: 40 };

  const codeInputStyle: CSSProperties = {
    fontFamily:
      '"Noto Sans Mono", ui-monospace, SFMono-Regular, Menlo, monospace',
    fontSize: 24,
    letterSpacing: '0.36em',
    textAlign: 'center',
    width: '100%',
    height: 56,
    border: `1px solid ${c.soft}`,
    borderRadius: 10,
    background: 'transparent',
    color: c.ink,
    outline: 'none',
    boxSizing: 'border-box',
  };

  const primaryBtnStyle: CSSProperties = {
    width: '100%',
    height: 46,
    border: 'none',
    borderRadius: 10,
    background: c.accent,
    color: '#fff',
    fontSize: 14.5,
    letterSpacing: '0.06em',
    cursor: 'pointer',
    fontFamily: 'inherit',
  };

  const onEnter = (e: FormEvent) => {
    e.preventDefault();
    if (sanitizedCode.length !== 6) {
      setCodeError(t('collection.landing.invalidCode'));
      return;
    }
    navigate(`/c/${sanitizedCode}`);
  };

  const onCreate = async (e: FormEvent) => {
    e.preventDefault();
    if (creating) return;
    if (adminPassword.length < 4) {
      toast.error(t('collection.errors.adminPasswordTooShort'));
      return;
    }
    const lifetime_days = lifetime === 'permanent' ? null : parseInt(lifetime, 10);

    setCreating(true);
    try {
      const res = await createCollection({
        name: null,
        visibility,
        entry_password: null,
        admin_password: adminPassword,
        lifetime_days,
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
        padding: '7px 14px',
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

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {/* Quick-create card */}
      <form onSubmit={onCreate} style={sectionStyle}>
        <label style={labelStyle}>{t('collection.quick.title')}</label>

        <div style={{ position: 'relative', marginBottom: 14 }}>
          <input
            type={showAdminPw ? 'text' : 'password'}
            value={adminPassword}
            onChange={(e) => setAdminPassword(e.target.value)}
            autoComplete="new-password"
            required
            minLength={4}
            placeholder={t('collection.quick.adminPasswordPlaceholder') ?? ''}
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

        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: 8,
            rowGap: 10,
            marginBottom: 16,
          }}
        >
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
          <span
            style={{
              borderLeft: `1px solid ${c.soft}`,
              margin: '0 4px',
              height: 24,
              alignSelf: 'center',
            }}
          />
          <Pill active={lifetime === '7'} onClick={() => setLifetime('7')}>
            {t('collection.create.lifetime7d')}
          </Pill>
          <Pill active={lifetime === '30'} onClick={() => setLifetime('30')}>
            {t('collection.create.lifetime30d')}
          </Pill>
          <Pill
            active={lifetime === 'permanent'}
            onClick={() => setLifetime('permanent')}
          >
            {t('collection.create.lifetimePermanent')}
          </Pill>
        </div>

        <button
          type="submit"
          disabled={creating}
          style={{
            ...primaryBtnStyle,
            cursor: creating ? 'wait' : 'pointer',
            opacity: creating ? 0.6 : 1,
          }}
        >
          {creating
            ? t('collection.create.submitting')
            : t('collection.quick.createBtn')}
        </button>

        <div
          style={{
            marginTop: 12,
            textAlign: 'center',
            fontSize: 12,
            color: c.sub,
          }}
        >
          <a
            href="/collection/new"
            onClick={(e) => {
              e.preventDefault();
              navigate('/collection/new');
            }}
            style={{ color: c.sub, textDecoration: 'underline' }}
          >
            <Plus size={11} style={{ verticalAlign: 'middle' }} />{' '}
            {t('collection.quick.moreOptions')}
          </a>
        </div>
      </form>

      {/* Enter existing room */}
      <form onSubmit={onEnter} style={sectionStyle}>
        <label style={labelStyle}>{t('collection.quick.enterTitle')}</label>
        <input
          inputMode="numeric"
          pattern="\d{6}"
          maxLength={6}
          value={sanitizedCode}
          onChange={(e) => {
            setCode(e.target.value);
            setCodeError(null);
          }}
          placeholder="000000"
          style={codeInputStyle}
        />
        {codeError && (
          <div style={{ color: '#c44', fontSize: 13, marginTop: 8 }}>
            {codeError}
          </div>
        )}
        <button
          type="submit"
          style={{
            ...primaryBtnStyle,
            marginTop: 14,
          }}
        >
          {t('collection.landing.enter')}
        </button>
      </form>
    </div>
  );
}

export default Collection;
