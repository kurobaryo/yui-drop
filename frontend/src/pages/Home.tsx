/**
 * Home — hero + tabs + recent shares.
 *
 * Layout (all three locales share the exact same structure; only text changes):
 *   1. Hero pill badge (amber dot + tagline)
 *   2. Two-line serif hero title — line 2 in accent colour
 *   3. Tab bar: Retrieve (lock) / Send file (upload) / Send text (lines).
 *      Retrieve is the default tab.
 *   4. The active tab panel.
 *   5. Recent shares — only rendered when localStorage has entries.
 */
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Lock, UploadCloud, AlignLeft } from 'lucide-react';
import { Header } from '@/components/layout/Header';
import { Footer } from '@/components/layout/Footer';
import { GridBg } from '@/components/fx/GridBg';
import RetrieveTab from './RetrieveTab';
import SendFileTab from './SendFileTab';
import SendTextTab from './SendTextTab';
import RecentList from './RecentList';
import { cn } from '@/lib/cn';

type Tab = 'retrieve' | 'sendFile' | 'sendText';

const TABS: Array<{ key: Tab; labelKey: string; Icon: typeof Lock }> = [
  { key: 'retrieve', labelKey: 'tabs.retrieve', Icon: Lock },
  { key: 'sendFile', labelKey: 'tabs.sendFile', Icon: UploadCloud },
  { key: 'sendText', labelKey: 'tabs.sendText', Icon: AlignLeft },
];

export default function Home() {
  const { t } = useTranslation();
  const [tab, setTab] = useState<Tab>('retrieve');

  return (
    <>
      <GridBg />
      <Header />
      <main className="mx-auto max-w-6xl px-4 md:px-6 pt-12 pb-24">
        <section className="text-center">
          <div
            className={cn(
              'inline-flex items-center gap-2 rounded-full',
              'border border-[--border] bg-[--bg-1] px-3 py-1 text-xs text-[--text-2]',
            )}
          >
            <span
              aria-hidden="true"
              className="inline-block h-1.5 w-1.5 rounded-full bg-[hsl(var(--accent-h)_var(--accent-s)_var(--accent-l))]"
            />
            <span>{t('hero.badge')}</span>
          </div>
          <h1
            className="mt-6 font-serif font-normal tracking-tight"
            style={{ fontSize: 'clamp(2rem, 4.5vw, 4.5rem)', lineHeight: 1.05 }}
          >
            <span className="block text-[--text-1]">{t('hero.titleLine1')}</span>
            <span className="block text-[hsl(var(--accent-h)_var(--accent-s)_var(--accent-l))]">
              {t('hero.titleLine2')}
            </span>
          </h1>
        </section>

        <nav
          aria-label="actions"
          className="mt-10 flex items-center justify-center gap-1 border-b border-[--border]"
        >
          {TABS.map(({ key, labelKey, Icon }) => {
            const active = tab === key;
            return (
              <button
                key={key}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => setTab(key)}
                className={cn(
                  'relative inline-flex items-center gap-1.5 px-4 py-2.5 text-sm transition-colors duration-150',
                  '-mb-px border-b-2',
                  active
                    ? 'border-[hsl(var(--accent-h)_var(--accent-s)_var(--accent-l))] text-[--text-1]'
                    : 'border-transparent text-[--text-2] hover:text-[--text-1]',
                )}
              >
                <Icon className="h-4 w-4" aria-hidden="true" />
                <span>{t(labelKey)}</span>
              </button>
            );
          })}
        </nav>

        <section className="mt-8">
          {tab === 'retrieve' && <RetrieveTab />}
          {tab === 'sendFile' && <SendFileTab />}
          {tab === 'sendText' && <SendTextTab />}
        </section>

        <RecentList />
      </main>
      <Footer />
    </>
  );
}
