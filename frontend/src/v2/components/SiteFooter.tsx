/**
 * v2 site footer — ported from the design prototype.
 *
 * Prototype reference: `v2-spec/linear-screens/00_issite.html`, the closing
 * bar. The left string is a security/licence summary; the right side links to
 * docs, GitHub, and the admin login.
 */
import { Link } from 'react-router-dom';

export interface SiteFooterProps {
  githubUrl?: string;
}

export function SiteFooter({
  githubUrl = 'https://github.com/kurobaryo/yui-drop',
}: SiteFooterProps) {
  return (
    <div
      data-r="pad"
      style={{
        borderTop: '1px solid var(--ln)',
        padding: '16px 24px',
        display: 'flex',
        justifyContent: 'space-between',
        gap: 12,
        flexWrap: 'wrap',
        fontSize: 12,
        color: 'var(--tx3)',
      }}
    >
      <span>Yui-Drop · MIT · TLS 1.3 · 存储侧 AES-256</span>
      <span style={{ display: 'flex', gap: 16 }}>
        <Link to="/docs" style={{ color: 'inherit', cursor: 'pointer' }}>
          文档
        </Link>
        <a
          href={githubUrl}
          target="_blank"
          rel="noopener noreferrer"
          style={{ color: 'inherit' }}
        >
          GitHub
        </a>
        <Link to="/admin" style={{ color: 'inherit', cursor: 'pointer' }}>
          后台
        </Link>
      </span>
    </div>
  );
}

export default SiteFooter;
