/**
 * Home — hero + tabs + recent list.
 */
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Header } from '@/components/layout/Header';
import { Footer } from '@/components/layout/Footer';
import { GridBg } from '@/components/fx/GridBg';
import { ShinyText } from '@/components/fx/ShinyText';
import { SplitText } from '@/components/fx/SplitText';
import RetrieveTab from './RetrieveTab';
import SendFileTab from './SendFileTab';
import SendTextTab from './SendTextTab';
import RecentList from './RecentList';
import { cn } from '@/lib/cn';

type Tab = 'retrieve' | 'sendFile' | 'sendText';

const TABS: Array<{ key: Tab; labelKey: string }> = [
  { key: 'retrieve', labelKey: 'tabs.retrieve' },
  { key: 'sendFile', labelKey: 'tabs.sendFile' },
  { key: 'sendText', labelKey: 'tabs.sendText' },
];

export default function Home() {
  const { t } = useTranslation();
  const [tab, setTab] = useState<Tab>('retrieve');

  return (
    <>
      <GridBg />
      <Header />
      <main className="mx-auto max-w-2xl px-4 md:px-6 pt-12 pb-24">
        <section className="text-center">
          <div
            className={cn(
              'inline-flex items-center gap-1.5 rounded-full',
              'border border-[--border] bg-[--bg-1] px-3 py-1 text-xs text-[--text-2]',
            )}
          >
            <span>{t('hero.badge')}</span>
          </div>
          <h1
            className="mt-5 font-bold tracking-tight"
            style={{ fontSize: 'clamp(2rem, 4.5vw, 4.5rem)', lineHeight: 1.1 }}
          >
            <ShinyText>{t('hero.title')}</ShinyText>
          </h1>
          <p
            className="mt-2 text-[--text-2]"
            style={{ fontSize: 'clamp(1rem, 1.6vw, 1.5rem)', lineHeight: 1.4 }}
          >
            <SplitText>{t('hero.subtitle')}</SplitText>
          </p>
        </section>

        <nav
          aria-label="actions"
          className="mt-10 flex items-center justify-center gap-1 border-b border-[--border]"
        >
          {TABS.map((it) => {
            const active = tab === it.key;
            return (
              <button
                key={it.key}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => setTab(it.key)}
                className={cn(
                  'relative px-4 py-2.5 text-sm transition-colors duration-150',
                  '-mb-px border-b-2',
                  active
                    ? 'border-[hsl(var(--accent-h)_var(--accent-s)_var(--accent-l))] text-[--text-1]'
                    : 'border-transparent text-[--text-2] hover:text-[--text-1]',
                )}
              >
                {t(it.labelKey)}
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
