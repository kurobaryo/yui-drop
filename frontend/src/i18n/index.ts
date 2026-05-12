/**
 * i18n bootstrap.
 *
 * Languages: en (fallback), zh-CN, ja.
 * Detection order: localStorage → navigator language → fallback (en).
 * The selected language key is persisted under `yui-drop:lang`.
 *
 * Historical bug (fixed here): the language detector hands i18next codes
 * like `zh-Hans-CN` (Chrome on macOS) or `zh` (Firefox), neither of
 * which is in our resource map. Combined with `nonExplicitSupportedLngs`
 * and the default `load: 'currentOnly'`, this caused i18next to silently
 * fall back to `en` whenever a Chinese visitor showed up. Three coordinated
 * fixes:
 *   1. Register `zh` as an alias of `zh-CN` in `resources`.
 *   2. `load: 'languageOnly'` so the loader collapses regional subtags.
 *   3. A custom `convertDetectedLanguage` that pins every detected code
 *      to one of `en | zh-CN | ja`.
 *   4. A startup migration that wipes a stale `yui-drop:lang` cache
 *      pointing at an unsupported value (e.g. an old `zh-Hans`).
 */
import i18n from 'i18next';
import LanguageDetector from 'i18next-browser-languagedetector';
import { initReactI18next } from 'react-i18next';

import en from './en.json';
import zhCN from './zh-CN.json';
import ja from './ja.json';
import { normalizeLang, isSupportedLang } from './normalize';

export { SUPPORTED_LANGS, type SupportedLang } from './supported';
export { normalizeLang } from './normalize';

const LANG_STORAGE_KEY = 'yui-drop:lang';

// (4) Prune a cached value the user can no longer reach via the switcher.
// Must run BEFORE i18next reads the cache, otherwise the detector picks up
// the stale code and i18next happily fails to resolve it.
if (typeof window !== 'undefined') {
  try {
    const cached = window.localStorage.getItem(LANG_STORAGE_KEY);
    if (cached && !isSupportedLang(cached)) {
      window.localStorage.removeItem(LANG_STORAGE_KEY);
    }
  } catch {
    // localStorage may throw in private mode / sandboxed iframes — ignore.
  }
}

void i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: {
      en: { translation: en },
      'zh-CN': { translation: zhCN },
      // (1) Alias: when i18next collapses `zh-CN` to `zh` during fallback
      // resolution, it still finds a real translation table here.
      zh: { translation: zhCN },
      ja: { translation: ja },
    },
    fallbackLng: 'en',
    supportedLngs: ['en', 'zh-CN', 'zh', 'ja'],
    nonExplicitSupportedLngs: true,
    // (2) Strip region subtag at load time — keeps `zh-Hans-CN` from being
    // requested verbatim and 404-ing into the English fallback.
    load: 'languageOnly',
    interpolation: { escapeValue: false }, // React already escapes
    detection: {
      order: ['localStorage', 'navigator', 'htmlTag'],
      lookupLocalStorage: LANG_STORAGE_KEY,
      caches: ['localStorage'],
      // (3) Hand i18next a code it can actually load.
      convertDetectedLanguage: (code: string) => normalizeLang(code),
    },
  });

// Keep <html lang="…"> in sync — useful for screen readers and CSS :lang().
i18n.on('languageChanged', (lng) => {
  if (typeof document !== 'undefined') {
    document.documentElement.lang = lng;
  }
});

export default i18n;
