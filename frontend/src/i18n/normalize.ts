/**
 * Single source of truth for collapsing arbitrary BCP-47 codes
 * (`zh-Hans-CN`, `zh-TW`, `en-US`, `ja-JP`, etc.) onto the three
 * resource buckets we actually ship: `en`, `zh-CN`, `ja`.
 *
 * Both the i18next `convertDetectedLanguage` hook and the manual
 * `LangSwitcher` consume this so a single rule governs the whole app —
 * preventing the historical bug where the detector handed i18next a
 * code it couldn't load (e.g. `zh-Hans-CN`) and the resource lookup
 * silently fell through to `en`.
 */
import { SUPPORTED_LANGS, type SupportedLang } from './supported';

export function normalizeLang(code: string | undefined | null): SupportedLang {
  if (!code) return 'en';
  const base = code.split('-')[0]?.toLowerCase();
  if (base === 'zh') return 'zh-CN';
  if (base === 'ja') return 'ja';
  return 'en';
}

export function isSupportedLang(code: string | null | undefined): code is SupportedLang {
  return !!code && (SUPPORTED_LANGS as readonly string[]).includes(code);
}
