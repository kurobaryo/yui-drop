/**
 * V2App — the v2 shell.
 *
 * Owns the theme attributes, the frosted header, and the footer; renders the
 * active screen between them. Mounted only when the site theme selects a v2
 * template, so the legacy UI is untouched and remains switchable back.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

import { normalizeLang } from '@/i18n/normalize';
import { haptic } from './haptics';
import { useThemeStore } from '@/stores/theme';
import type { RecentEntry } from '@/lib/recent';
import { pushRecent } from '@/lib/recent';
import { shareSelect, type ShareSelectResponse } from '@/lib/api/share';
import { ApiError } from '@/lib/api';
import { usePublicConfig } from '@/lib/hooks/usePublicConfig';
import { toast } from '@/components/ui/Toast';
import { TurnstileWidget, type TurnstileWidgetHandle } from '@/components/TurnstileWidget';
import { IconSprite } from './components/IconSprite';
import { SiteFooter } from './components/SiteFooter';
import { SiteHeader } from './components/SiteHeader';
import { Home } from './screens/Home';
import { NewCollection } from './screens/NewCollection';
import { DocsV2 } from './screens/DocsV2';
import { RoomV2 } from './screens/RoomV2';
import { PickupDetail } from './components/PickupDetail';
import { getTheme } from './themes';
import { resolveMode, useApplyTheme, type Mode } from './applyTheme';

import './styles/index.css';

/**
 * Language switcher options. `code` must match a key in i18n's `supportedLngs`
 * so that `i18n.changeLanguage` actually resolves a translation table — the
 * first cut of v2 only cycled a local state value, so the chip label changed
 * but the UI stayed Chinese.
 */
const LANGS = [
  { code: 'zh-CN', label: '中' },
  { code: 'en', label: 'EN' },
  { code: 'ja', label: '日' },
];

export function V2App() {
  const location = useLocation();
  const navigate = useNavigate();
  const config = usePublicConfig();
  const turnstileRef = useRef<TurnstileWidgetHandle | null>(null);
  const [pickup, setPickup] = useState<ShareSelectResponse | null>(null);
  const resolving = useRef<string | null>(null);
  // Theme identity is admin-owned and arrives via /api/config; appearance is
  // the visitor's own preference. Both live in the shared store already.
  const template = useThemeStore((s) => s.template);
  const mode = useThemeStore((s) => s.mode) as Mode;
  const setMode = useThemeStore((s) => s.setMode);
  const accent = useThemeStore((s) => s.accent);
  const accentCustom = useThemeStore((s) => s.accentCustom);
  const brandName = useThemeStore((s) => s.brandName);
  const heroTitle = useThemeStore((s) => s.heroTitle);
  const heroSubtitle = useThemeStore((s) => s.heroSubtitle);

  useApplyTheme({ theme: template, mode, accent, accentCustom });

  // Track the resolved appearance so the header shows the right glyph, and
  // keep it live while `mode === 'auto'`.
  const [dark, setDark] = useState(() => resolveMode(mode) === 'dark');
  useEffect(() => {
    setDark(resolveMode(mode) === 'dark');
    if (mode !== 'auto' || typeof window === 'undefined' || !window.matchMedia) return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => setDark(mq.matches);
    mq.addEventListener?.('change', onChange);
    return () => mq.removeEventListener?.('change', onChange);
  }, [mode]);

  // Language is owned by i18next (it persists to localStorage and drives every
  // `t()` call); the chip label is derived from it rather than tracked
  // separately, so the two can never disagree.
  const { i18n: i18nInstance } = useTranslation();
  const { t } = useTranslation();
  const langIndex = Math.max(
    0,
    LANGS.findIndex((l) => l.code === normalizeLang(i18nInstance.language)),
  );
  const cycleLang = useCallback(() => {
    haptic();
    const next = LANGS[(langIndex + 1) % LANGS.length];
    void i18nInstance.changeLanguage(next.code);
  }, [i18nInstance, langIndex]);

  const toggleMode = useCallback(() => {
    setMode(dark ? 'light' : 'dark');
  }, [dark, setMode]);

  const fontStack = useMemo(() => getTheme(template).fontStack, [template]);

  const onSubmitCode = useCallback(async (raw: string) => {
    const code = raw.toUpperCase();
    if (/^C\d{5}$/.test(code)) {
      navigate(`/c/${code}`);
      return;
    }
    if (!/^\d{6}$/.test(code) || resolving.current === code) return;
    resolving.current = code;
    try {
      let token: string | null = null;
      if (config.turnstileProtectPickup && config.turnstileSiteKey) {
        token = (await turnstileRef.current?.executeAndWaitForToken()) ?? null;
        if (!token) throw new Error(t('v2.send.turnstileRequired'));
      }
      const item = await shareSelect(code, token);
      pushRecent({ code: item.code, kind: item.kind, name: item.name, size: item.size,
        type: item.content_type, fileCount: item.file_count, totalSize: item.total_size,
        created_at: new Date().toISOString(), expires_at: item.expired_at });
      haptic('success');
      setPickup(item);
      turnstileRef.current?.reset();
    } catch (e) {
      haptic('error');
      toast.error(e instanceof ApiError ? e.message : ((e as Error)?.message || t('v2.pickupFailed')));
      turnstileRef.current?.reset();
    } finally {
      resolving.current = null;
    }
  }, [config.turnstileProtectPickup, config.turnstileSiteKey, navigate]);

  const onOpenRecent = useCallback((e: RecentEntry) => {
    if (e.kind === 'collection') navigate(`/c/${e.code}`);
    else void onSubmitCode(e.code);
  }, [navigate, onSubmitCode]);

  // Direct SPA deep paths (when the reverse proxy forwards them) and the
  // backend's canonical 302 target `/?code=XXXXXX` both open the same dialog.
  useEffect(() => {
    const pathCode = /^\/(?:s|v|m)\/([A-Za-z0-9]{6})$/.exec(location.pathname)?.[1];
    const queryCode = new URLSearchParams(location.search).get('code') || undefined;
    const code = pathCode || queryCode;
    if (code && /^[A-Za-z0-9]{6}$/.test(code)) void onSubmitCode(code);
  }, [location.pathname, location.search, onSubmitCode]);

  const copy = useCallback((text: string) => {
    void navigator.clipboard?.writeText(text).catch(() => {
      /* clipboard blocked — non-fatal */
    });
  }, []);

  return (
    <div
      data-yd-root="1"
      style={{
        minHeight: '100vh',
        display: 'flex',
        flexDirection: 'column',
        background: 'var(--bg)',
        color: 'var(--tx1)',
        fontFamily: fontStack,
        fontSize: 14,
        lineHeight: 1.55,
      }}
    >
      <IconSprite />
      <SiteHeader
        brandName={brandName}
        dark={dark}
        onToggleMode={toggleMode}
        langLabel={LANGS[langIndex].label}
        onCycleLang={cycleLang}
      />
      {location.pathname.startsWith('/c/') ? (
        <RoomV2 />
      ) : location.pathname === '/collection/new' ? (
        <NewCollection />
      ) : location.pathname === '/docs' ? (
        <DocsV2 />
      ) : (
        <Home
          heroTitle={heroTitle}
          heroSubtitle={heroSubtitle}
          onSubmitCode={onSubmitCode}
          onOpenRecent={onOpenRecent}
          onCopyCode={(e) => copy(e.code)}
          onCopyLink={(e) =>
            copy(`${window.location.origin}/${e.kind === 'collection' ? 'c' : 's'}/${e.code}`)
          }
        />
      )}
      <SiteFooter />
      {config.turnstileProtectPickup && config.turnstileSiteKey && (
        <div style={{ position: 'absolute', width: 0, height: 0, overflow: 'hidden' }}>
          <TurnstileWidget ref={turnstileRef} mode="invisible-on-submit" siteKey={config.turnstileSiteKey} onVerify={() => {}} onExpire={() => {}} onError={() => {}} />
        </div>
      )}
      {pickup && <PickupDetail item={pickup} onClose={() => {
        setPickup(null);
        if (/^\/(?:s|v|m)\//.test(location.pathname) || new URLSearchParams(location.search).has('code')) navigate('/', { replace: true });
      }} />}
    </div>
  );
}

export default V2App;
