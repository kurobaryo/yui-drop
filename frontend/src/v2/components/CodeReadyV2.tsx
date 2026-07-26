import { Icon } from './IconSprite';
import { HapticTap } from './HapticTap';
import { haptic } from '../haptics';
import { useTranslation } from 'react-i18next';

export interface CodeReadyV2Props {
  code: string;
  onReset: () => void;
}

/** Success state shared by v2 send-file / send-text. */
export function CodeReadyV2({ code, onReset }: CodeReadyV2Props) {
  const { t } = useTranslation();
  const link = `${window.location.origin}/s/${code}`;
  const copy = (text: string) => {
    haptic('success');
    void navigator.clipboard?.writeText(text).catch(() => {});
  };
  return (
    <div style={{ padding: '34px 22px 30px', textAlign: 'center' }}>
      <div style={{ fontSize: 12, color: 'var(--tx3)', marginBottom: 12 }}>{t('v2.codeReady.title')}</div>
      <div
        style={{
          display: 'inline-flex',
          gap: 10,
          fontFamily: "'JetBrains Mono',monospace",
          fontSize: 34,
          fontWeight: 600,
          letterSpacing: '.12em',
          color: 'var(--tx)',
          background: 'var(--acs)',
          border: '1px solid var(--ac)',
          borderRadius: 12,
          padding: '12px 18px 12px 22px',
        }}
      >
        {code}
      </div>
      <div style={{ marginTop: 18, display: 'flex', gap: 8, justifyContent: 'center', flexWrap: 'wrap' }}>
        <HapticTap onTap={() => copy(code)} pattern="success" radius={10} label={t('v2.codeReady.copyCode')}>
          <span data-yd="btn" style={button}>
            <Icon name="i-copy" size={14} />{t('v2.codeReady.copyCode')}
          </span>
        </HapticTap>
        <HapticTap onTap={() => copy(link)} pattern="success" radius={10} label={t('v2.codeReady.copyLink')}>
          <span data-yd="btn" style={button}>
            <Icon name="i-link" size={14} />{t('v2.codeReady.copyLink')}
          </span>
        </HapticTap>
        <HapticTap onTap={onReset} radius={10} label={t('v2.codeReady.again')}>
          <span data-yd="quiet" style={{ ...button, background: 'transparent', color: 'var(--tx2)', border: '1px solid var(--ln)' }}>
            {t('v2.codeReady.again')}
          </span>
        </HapticTap>
      </div>
    </div>
  );
}

const button: React.CSSProperties = {
  height: 38,
  border: 'none',
  borderRadius: 9,
  background: 'var(--ac)',
  color: '#fff',
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  padding: '0 13px',
  fontFamily: 'inherit',
  fontWeight: 600,
  cursor: 'pointer',
};
