import { Icon } from './IconSprite';

export interface CodeReadyV2Props {
  code: string;
  onReset: () => void;
}

/** Success state shared by v2 send-file / send-text. */
export function CodeReadyV2({ code, onReset }: CodeReadyV2Props) {
  const link = `${window.location.origin}/s/${code}`;
  const copy = (text: string) => void navigator.clipboard?.writeText(text).catch(() => {});
  return (
    <div style={{ padding: '34px 22px 30px', textAlign: 'center' }}>
      <div style={{ fontSize: 12, color: 'var(--tx3)', marginBottom: 12 }}>取件码已生成</div>
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
        <button type="button" data-yd="btn" onClick={() => copy(code)} style={button}>
          <Icon name="i-copy" size={14} />复制码
        </button>
        <button type="button" data-yd="btn" onClick={() => copy(link)} style={button}>
          <Icon name="i-link" size={14} />复制链接
        </button>
        <button type="button" data-yd="quiet" onClick={onReset} style={{ ...button, background: 'transparent', color: 'var(--tx2)', border: '1px solid var(--ln)' }}>
          再发一个
        </button>
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
