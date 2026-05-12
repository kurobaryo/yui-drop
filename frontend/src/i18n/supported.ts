/**
 * The whitelist of language codes we ship resources for. Pulled into its
 * own module so `normalize.ts` can import without dragging the full
 * i18next bootstrap (which runs side-effects) along for the ride.
 */
export const SUPPORTED_LANGS = ['en', 'zh-CN', 'ja'] as const;
export type SupportedLang = (typeof SUPPORTED_LANGS)[number];
