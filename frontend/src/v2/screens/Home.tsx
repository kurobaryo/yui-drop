/**
 * v2 Home — ported from the design prototype's `isHome` screen.
 *
 * Prototype reference: `v2-spec/linear-screens/00_issite.html`.
 *
 * Structure (matching the design exactly):
 *   badge row (🔒 匿名 · 无需账号 + capability line)
 *   h1 hero
 *   lede
 *   action card
 *     ├ tab bar (in-card) + ⌘V paste hint on the right
 *     └ active tab panel — pickup is a two-column split:
 *         left: caption + six code cells (+ mobile paste button)
 *         right: 支持的内容 list
 *   最近分享 list
 *
 * The `data-r` attributes are load-bearing: the theme stylesheets use them for
 * the responsive collapse (single column, scrollable tabs, grid code cells).
 */
import { useCallback, useState } from 'react';

import type { RecentEntry } from '@/lib/recent';
import { CodeCells } from '../components/CodeCells';
import { Icon } from '../components/IconSprite';
import { RecentList } from '../components/RecentList';
import { SendFilePanel } from '../components/SendFilePanel';
import { SendTextPanel } from '../components/SendTextPanel';
import { CollectionJoinPanel } from '../components/CollectionJoinPanel';

export type HomeTab = 'pickup' | 'file' | 'text' | 'collection';

const TABS: Array<{ id: HomeTab; label: string; icon: string }> = [
  { id: 'pickup', label: '取件', icon: 'i-in' },
  { id: 'file', label: '寄文件', icon: 'i-up' },
  { id: 'text', label: '寄文字', icon: 'i-pen' },
  { id: 'collection', label: '收集箱', icon: 'i-inbox' },
];

const SUPPORTED: Array<{ icon: string; text: string }> = [
  { icon: 'i-img', text: '图片 / PDF / 视频 / 音频 预览' },
  { icon: 'i-file', text: '文字与 Markdown 直接渲染' },
  { icon: 'i-box', text: '多文件打包，逐个下载' },
];

export interface HomeProps {
  heroTitle?: string;
  heroSubtitle?: string;
  onSubmitCode: (code: string) => void;
  onOpenRecent: (entry: RecentEntry) => void;
  onCopyCode: (entry: RecentEntry) => void;
  onCopyLink: (entry: RecentEntry) => void;
  /** Show the ⌘V hint (design exposes this as a prop, default on). */
  showKeyHint?: boolean;
}

export function Home({
  heroTitle,
  heroSubtitle,
  onSubmitCode,
  onOpenRecent,
  onCopyCode,
  onCopyLink,
  showKeyHint = true,
}: HomeProps) {
  const [tab, setTab] = useState<HomeTab>('pickup');
  const [code, setCode] = useState('');

  const handlePaste = useCallback(async () => {
    try {
      const text = await navigator.clipboard.readText();
      const cleaned = text.toUpperCase().replace(/[^0-9C]/g, '').slice(0, 6);
      if (cleaned) setCode(cleaned);
    } catch {
      /* clipboard permission denied — the user can still type */
    }
  }, []);

  return (
    <div
      data-r="pad"
      style={{
        maxWidth: 920,
        width: '100%',
        margin: '0 auto',
        padding: '52px 24px 40px',
        flex: 1,
      }}
    >
      {/* Badge row */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          marginBottom: 16,
          flexWrap: 'wrap',
        }}
      >
        <span
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            fontSize: 12,
            color: 'var(--tx2)',
            background: 'var(--p1)',
            border: '1px solid var(--ln)',
            padding: '4px 10px',
            borderRadius: 999,
          }}
        >
          <Icon name="i-lock" size={12} />
          匿名 · 无需账号
        </span>
        <span style={{ fontSize: 12, color: 'var(--tx3)' }}>
          单文件 10 GB · 浏览器直传对象存储
        </span>
      </div>

      <h1
        data-r="hero"
        style={{
          fontSize: 44,
          fontWeight: 700,
          lineHeight: 1.1,
          letterSpacing: '-0.03em',
          marginBottom: 10,
          color: 'var(--tx)',
        }}
      >
        {heroTitle || '丢入文件，取得六位取件码。'}
      </h1>
      <p style={{ fontSize: 15, color: 'var(--tx2)', margin: 0, maxWidth: 520 }}>
        {heroSubtitle || '把码告诉对方就行 —— 不用链接、不用邮件、不用注册。'}
      </p>

      {/* Action card */}
      <div
        style={{
          marginTop: 36,
          background: 'var(--pn)',
          border: '1px solid var(--ln)',
          borderRadius: 14,
          overflow: 'hidden',
          boxShadow: 'var(--sh)',
        }}
      >
        {/* Tab bar lives INSIDE the card (unlike the old UI) */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '10px 12px',
            borderBottom: '1px solid var(--ln)',
          }}
        >
          <div
            data-r="tabs"
            style={{
              display: 'flex',
              gap: 2,
              background: 'var(--p1)',
              border: '1px solid var(--ln)',
              borderRadius: 9,
              padding: 3,
            }}
          >
            {TABS.map((t) => {
              const active = tab === t.id;
              return (
                <button
                  key={t.id}
                  type="button"
                  data-yd="tab"
                  onClick={() => setTab(t.id)}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 6,
                    padding: '6px 13px',
                    borderRadius: 6,
                    fontSize: 13,
                    cursor: 'pointer',
                    whiteSpace: 'nowrap',
                    fontFamily: 'inherit',
                    border: 'none',
                    background: active ? 'var(--pn)' : 'transparent',
                    color: active ? 'var(--tx)' : 'var(--tx2)',
                    fontWeight: active ? 600 : 500,
                    boxShadow: active ? 'var(--sh)' : 'none',
                  }}
                >
                  <Icon name={t.icon} size={14} />
                  {t.label}
                </button>
              );
            })}
          </div>

          {showKeyHint && (
            <div
              data-r="hide-sm"
              style={{
                marginLeft: 'auto',
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                fontSize: 12,
                color: 'var(--tx3)',
              }}
            >
              <span style={keycap}>⌘</span>
              <span style={{ ...keycap, fontFamily: "'JetBrains Mono',monospace" }}>
                V
              </span>
              <span>粘贴取件码</span>
            </div>
          )}
        </div>

        {tab === 'pickup' && (
          <div
            data-r="two-col"
            style={{
              padding: '26px 22px 24px',
              display: 'grid',
              gridTemplateColumns: '1fr 280px',
              gap: 30,
              alignItems: 'start',
            }}
          >
            <div>
              <div style={{ fontSize: 12, color: 'var(--tx3)', marginBottom: 10 }}>
                取件码 · 输入完 6 位自动取件
              </div>
              <CodeCells
                value={code}
                onChange={setCode}
                onComplete={onSubmitCode}
                autoFocus
              />
              <div data-r="mob-only" style={{ marginTop: 12, alignItems: 'center' }}>
                <button
                  type="button"
                  data-yd="quiet"
                  onClick={handlePaste}
                  style={{
                    flex: 1,
                    justifyContent: 'center',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 6,
                    fontSize: 13,
                    color: 'var(--tx2)',
                    border: '1px solid var(--ln)',
                    borderRadius: 9,
                    padding: '10px 12px',
                    cursor: 'pointer',
                    whiteSpace: 'nowrap',
                    background: 'transparent',
                    fontFamily: 'inherit',
                  }}
                >
                  <Icon name="i-copy" size={14} />
                  粘贴取件码
                </button>
              </div>
            </div>

            <div
              data-r="side"
              style={{ borderLeft: '1px solid var(--ln)', paddingLeft: 24 }}
            >
              <div style={{ fontSize: 12, color: 'var(--tx3)', marginBottom: 12 }}>
                支持的内容
              </div>
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 10,
                  fontSize: 13,
                  color: 'var(--tx2)',
                }}
              >
                {SUPPORTED.map((s) => (
                  <div
                    key={s.text}
                    style={{ display: 'flex', gap: 9, alignItems: 'center' }}
                  >
                    <Icon
                      name={s.icon}
                      size={15}
                      style={{ color: 'var(--act)', flexShrink: 0 }}
                    />
                    {s.text}
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {tab === 'file' && <SendFilePanel />}
        {tab === 'text' && <SendTextPanel />}
        {tab === 'collection' && <CollectionJoinPanel />}
      </div>

      <RecentList
        onOpen={onOpenRecent}
        onCopyCode={onCopyCode}
        onCopyLink={onCopyLink}
      />
    </div>
  );
}

const keycap: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  minWidth: 18,
  height: 18,
  padding: '0 4px',
  borderRadius: 5,
  border: '1px solid var(--ln)',
  background: 'var(--p1)',
  fontSize: 11,
  color: 'var(--tx2)',
};

export default Home;
