import { useCallback, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { CodeCells } from './CodeCells';
import { Icon } from './IconSprite';
import { useTranslation } from 'react-i18next';

/** Home 收集箱 tab: enter C+5 code or create a new room. */
export function CollectionJoinPanel() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [code, setCode] = useState('C');
  const enter = useCallback((v: string) => navigate(`/c/${v.toUpperCase()}`), [navigate]);
  const paste = useCallback(async () => {
    try {
      const t = (await navigator.clipboard.readText()).toUpperCase().replace(/[^0-9C]/g, '');
      const v = (t.startsWith('C') ? t : `C${t}`).slice(0, 6);
      setCode(v);
      if (v.length === 6) enter(v);
    } catch { /* clipboard denied */ }
  }, [enter]);

  return (
    <div data-r="two-col" style={{ padding: '26px 22px 24px', display: 'grid', gridTemplateColumns: '1fr 300px', gap: 30, alignItems: 'start' }}>
      <div>
        <div style={{ fontSize: 12, color: 'var(--tx3)', marginBottom: 10 }}>{t('v2.join.label')}</div>
        <CodeCells value={code} onChange={(v) => setCode(v.startsWith('C') ? v : `C${v}`.slice(0, 6))} onComplete={enter} autoFocus />
        <div data-r="mob-only" style={{ marginTop: 12, alignItems: 'center' }}>
          <button type="button" data-yd="quiet" onClick={() => void paste()} style={pasteButton}>
            <Icon name="i-copy" size={14} />{t('v2.join.paste')}
          </button>
        </div>
      </div>
      <div data-r="side" style={{ borderLeft: '1px solid var(--ln)', paddingLeft: 24 }}>
        <div style={{ fontSize: 12, color: 'var(--tx3)', marginBottom: 12 }}>{t('v2.join.none')}</div>
        <button type="button" data-yd="quiet" onClick={() => navigate('/collection/new')} style={newButton}>
          <Icon name="i-plus" size={16} />{t('v2.join.create')}
        </button>
        <div style={{ marginTop: 12, fontSize: 12, color: 'var(--tx3)', lineHeight: 1.6 }}>{t('v2.join.hint')}或清空。</div>
      </div>
    </div>
  );
}

const pasteButton: React.CSSProperties = { flex: 1, justifyContent: 'center', display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13, color: 'var(--tx2)', border: '1px solid var(--ln)', borderRadius: 9, padding: '10px 12px', cursor: 'pointer', whiteSpace: 'nowrap', background: 'transparent', fontFamily: 'inherit' };
const newButton: React.CSSProperties = { width: '100%', height: 44, border: '1px solid var(--ln2)', borderRadius: 10, background: 'transparent', color: 'var(--tx1)', fontFamily: 'inherit', fontSize: 14, fontWeight: 600, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8, whiteSpace: 'nowrap' };
