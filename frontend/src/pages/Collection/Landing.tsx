/**
 * Landing — `/collection`.
 *
 * Two affordances:
 *   1. Enter a 6-digit room code → navigate to `/c/{code}`.
 *   2. "Create a new collection" link → `/collection/new`.
 *
 * Mirrors the inline-style washi look used by the home page so the
 * transition feels of-a-piece.
 */
import { useState, type CSSProperties, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Plus } from 'lucide-react';
import { CollectionShell } from './Shell';
import type { WashiColors } from '@/variants/washi/palettes';

function Inner({ c }: { c: WashiColors }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);

  const sanitized = code.replace(/\D/g, '').slice(0, 6);

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (sanitized.length !== 6) {
      setError(t('collection.landing.invalidCode'));
      return;
    }
    navigate(`/c/${sanitized}`);
  };

  const cardStyle: CSSProperties = {
    border: `1px solid ${c.soft}`,
    borderRadius: 14,
    padding: '28px 28px',
    background: c.paper,
  };
  const inputStyle: CSSProperties = {
    fontFamily: '"Noto Sans Mono", ui-monospace, SFMono-Regular, Menlo, monospace',
    fontSize: 28,
    letterSpacing: '0.4em',
    textAlign: 'center',
    width: '100%',
    height: 64,
    border: `1px solid ${c.soft}`,
    borderRadius: 10,
    background: 'transparent',
    color: c.ink,
    outline: 'none',
    boxSizing: 'border-box',
  };
  const btnStyle: CSSProperties = {
    marginTop: 16,
    width: '100%',
    height: 48,
    border: 'none',
    borderRadius: 10,
    background: c.accent,
    color: '#fff',
    fontSize: 15,
    letterSpacing: '0.06em',
    cursor: 'pointer',
  };

  return (
    <div style={{ maxWidth: 480, margin: '0 auto' }}>
      <h1
        style={{
          fontFamily: '"Noto Serif JP", "Noto Serif SC", serif',
          fontSize: 40,
          margin: 0,
          marginBottom: 8,
        }}
      >
        {t('collection.landing.title')}
      </h1>
      <p style={{ color: c.sub, fontSize: 14, marginTop: 0, marginBottom: 28 }}>
        {t('collection.landing.subtitle')}
      </p>

      <form onSubmit={onSubmit} style={cardStyle}>
        <label
          style={{
            display: 'block',
            fontSize: 13,
            color: c.sub,
            letterSpacing: '0.08em',
            marginBottom: 12,
          }}
        >
          {t('collection.landing.codeLabel')}
        </label>
        <input
          autoFocus
          inputMode="numeric"
          pattern="\d{6}"
          maxLength={6}
          value={sanitized}
          onChange={(e) => {
            setCode(e.target.value);
            setError(null);
          }}
          placeholder="000000"
          style={inputStyle}
        />
        {error && (
          <div style={{ color: '#c44', fontSize: 13, marginTop: 8 }}>{error}</div>
        )}
        <button type="submit" style={btnStyle}>
          {t('collection.landing.enter')}
        </button>
      </form>

      <div
        style={{
          marginTop: 18,
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          gap: 6,
          fontSize: 14,
        }}
      >
        <Plus size={14} style={{ color: c.accent }} />
        <a
          href="/collection/new"
          onClick={(e) => {
            e.preventDefault();
            navigate('/collection/new');
          }}
          style={{ color: c.accent, textDecoration: 'none' }}
        >
          {t('collection.landing.createLink')}
        </a>
      </div>
    </div>
  );
}

export default function Landing() {
  return <CollectionShell>{(c) => <Inner c={c} />}</CollectionShell>;
}
