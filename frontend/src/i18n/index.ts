/**
 * i18n bootstrap.
 *
 * Languages: en (fallback), zh-CN, ja.
 * Detection order: localStorage → navigator language → fallback (en).
 * The selected language key is persisted under `yui-drop:lang`.
 */
import i18n from 'i18next';
import LanguageDetector from 'i18next-browser-languagedetector';
import { initReactI18next } from 'react-i18next';

import en from './en.json';
import zhCN from './zh-CN.json';
import ja from './ja.json';

export const SUPPORTED_LANGS = ['en', 'zh-CN', 'ja'] as const;
export type SupportedLang = (typeof SUPPORTED_LANGS)[number];

void i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: {
      en: { translation: en },
      'zh-CN': { translation: zhCN },
      ja: { translation: ja },
    },
    fallbackLng: 'en',
    supportedLngs: SUPPORTED_LANGS as unknown as string[],
    nonExplicitSupportedLngs: true,
    interpolation: { escapeValue: false }, // React already escapes
    detection: {
      order: ['localStorage', 'navigator', 'htmlTag'],
      lookupLocalStorage: 'yui-drop:lang',
      caches: ['localStorage'],
    },
  });

// Keep <html lang="…"> in sync — useful for screen readers and CSS :lang().
i18n.on('languageChanged', (lng) => {
  if (typeof document !== 'undefined') {
    document.documentElement.lang = lng;
  }
});

export default i18n;
