/**
 * Theme registry — the single place that knows which templates exist.
 *
 * ★ THE EXTENSIBILITY CONTRACT ★
 *
 * A "template" is a complete visual language. Adding one is meant to be a
 * *data* change, not a refactor:
 *
 *   1. Append a `[data-template="<slug>"]` block (light + dark) to
 *      `src/styles/templates.css`, defining the full token contract.
 *   2. Append one entry to TEMPLATES below.
 *
 * That's it — no component edits. Components never branch on the template
 * slug; they read CSS variables (shape/density/depth) and, for the handful of
 * places where two templates genuinely need different *markup*, they read a
 * named **structure slot** from the template entry (see `StructureSlots`).
 *
 * Why slots instead of `template === 'apple' ? … : …` scattered inline:
 * with if/else, adding template #3 means hunting down and editing every
 * branch point. With slots, a new template just *declares which existing
 * variant it wants* — zero code changes. Only a genuinely new layout needs
 * new code, and then it's one component + one union member.
 *
 * The backend deliberately does NOT validate the slug against a whitelist,
 * so the frontend is the source of truth. Unknown slugs (e.g. a template that
 * was removed) fall back to DEFAULT_TEMPLATE via `resolveTemplate()`.
 */

/**
 * The ~5 places where the two approved designs genuinely differ in DOM
 * structure, not just in tokens. Each slot is a small closed union; a
 * template picks one option per slot.
 *
 * Derived from a structural diff of the two prototypes: they are 86%
 * tag-identical, and these are the divergences that survived removing all
 * styling.
 */
export interface StructureSlots {
  /**
   * Admin logs / files rendering.
   *  - 'table' : real <table> with a header row (Linear — dense, scannable)
   *  - 'cards' : stacked rows with an icon tile (Apple — touch-friendly)
   */
  dataDisplay: 'table' | 'cards';
  /**
   * Settings form rows.
   *  - 'label'   : <label> wrapping the control (Linear — compact)
   *  - 'listrow' : iOS-style list row, title left / control right (Apple)
   */
  formRow: 'label' | 'listrow';
  /**
   * Home hero composition.
   *  - 'inline'   : badge pill + meta on one line, left-aligned (Linear)
   *  - 'stacked'  : centered headline, meta on its own line (Apple)
   */
  hero: 'inline' | 'stacked';
  /**
   * The pickup-code paste affordance.
   *  - 'keyhint' : a small ⌘V keycap hint next to the tabs (Linear)
   *  - 'button'  : a full-width "paste code" button under the cells (Apple)
   */
  pasteAffordance: 'keyhint' | 'button';
  /**
   * Secondary buttons.
   *  - 'quiet' : bordered, transparent fill (Linear)
   *  - 'soft'  : filled tint, no border (Apple)
   */
  secondaryButton: 'quiet' | 'soft';
}

export interface AccentOption {
  /** Slug persisted in settings_kv / `data-accent`. */
  id: string;
  /** Human label shown in the admin picker. */
  label: string;
  /** Swatch colour for the picker dot (light-mode value). */
  hex: string;
}

export interface TemplateDef {
  /** Slug — must match the `[data-template="…"]` block in templates.css. */
  id: string;
  /** Display name in the admin theme picker. */
  name: string;
  /** One-line description under the name. */
  description: string;
  /** Preview swatch triplet for the admin template card. */
  preview: { c1: string; c2: string; c3: string };
  /** Accents this template offers (in addition to "custom"). */
  accents: AccentOption[];
  /** Which accent to use when the admin hasn't picked one. */
  defaultAccent: string;
  /** Structural choices — see StructureSlots. */
  slots: StructureSlots;
}

export const TEMPLATES: TemplateDef[] = [
  {
    id: 'linear',
    name: 'Linear 式',
    description: '紧凑工具感 · 小圆角',
    preview: { c1: '#3f7bb3', c2: '#11141b', c3: '#e3e5ea' },
    accents: [
      { id: 'sky', label: '灰蓝', hex: '#3f7bb3' },
      { id: 'linear-blue', label: '蓝紫', hex: 'hsl(232 68% 56%)' },
      { id: 'sapphire', label: '宝蓝', hex: 'hsl(217 91% 52%)' },
      { id: 'emerald', label: '翡绿', hex: 'hsl(160 84% 34%)' },
    ],
    defaultAccent: 'sky',
    slots: {
      dataDisplay: 'table',
      formRow: 'label',
      hero: 'inline',
      pasteAffordance: 'keyhint',
      secondaryButton: 'quiet',
    },
  },
  {
    id: 'apple',
    name: '苹果式',
    description: '大圆角 · 留白多',
    preview: { c1: '#0071e3', c2: '#f5f5f7', c3: '#1c1c1e' },
    accents: [
      { id: 'blue', label: '蓝', hex: '#0071e3' },
      { id: 'sky', label: '灰蓝', hex: '#3f7bb3' },
      { id: 'graphite', label: '石墨', hex: '#3a3a3c' },
      { id: 'teal', label: '青', hex: '#0a8a8a' },
    ],
    defaultAccent: 'blue',
    slots: {
      dataDisplay: 'cards',
      formRow: 'listrow',
      hero: 'stacked',
      pasteAffordance: 'button',
      secondaryButton: 'soft',
    },
  },
];

export const DEFAULT_TEMPLATE = 'linear';

/** Look up a template by slug, falling back to the default for unknown ones. */
export function resolveTemplate(id: string | null | undefined): TemplateDef {
  const found = TEMPLATES.find((t) => t.id === id);
  if (found) return found;
  return TEMPLATES.find((t) => t.id === DEFAULT_TEMPLATE) ?? TEMPLATES[0];
}

/** All known template slugs — handy for validation / admin UI. */
export const TEMPLATE_IDS: string[] = TEMPLATES.map((t) => t.id);
