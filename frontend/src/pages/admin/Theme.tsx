/**
 * Admin → 主题 (Theme).
 *
 * Mirrors the approved prototype: 「改动即时预览，保存后对所有访客生效」
 *
 *   - Template picker   (前台与后台共用同一套模板)
 *   - Appearance        (default mode + optional lock)
 *   - Accent            (per-template palette + custom hex/colour picker)
 *   - Branding & copy   (site name, hero title/subtitle, default language, logo)
 *
 * Editing anything calls `preview()` on the theme store, which flips the
 * <html> attributes immediately — so the admin sees the change live on the
 * page they're standing on. Nothing is persisted until "保存主题", which PUTs
 * to /api/admin/theme; from then on every visitor gets it via /api/config.
 * No rebuild, no redeploy.
 *
 * "重置" restores the last saved state (and re-applies it to the DOM).
 */
import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, RotateCcw } from 'lucide-react';
import {
  getAdminTheme,
  putAdminTheme,
  type ThemeConfigResponse,
} from '@/lib/api/admin';
import { ApiError } from '@/lib/api';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Spinner } from '@/components/ui/Spinner';
import { toast } from '@/components/ui/Toast';
import { TEMPLATES, resolveTemplate } from '@/themes/registry';
import { useThemeStore } from '@/stores/theme';

const MODE_OPTIONS: Array<{ id: string; label: string }> = [
  { id: 'auto', label: '跟随系统' },
  { id: 'light', label: '亮色' },
  { id: 'dark', label: '暗色' },
];

const LANG_OPTIONS: Array<{ id: string; label: string }> = [
  { id: '', label: '跟随浏览器' },
  { id: 'zh-CN', label: '简体中文' },
  { id: 'en', label: 'English' },
  { id: 'ja', label: '日本語' },
];

/** Section wrapper — title + optional hint, then the controls. */
function Section({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <Card className="p-5">
      <div className="mb-4">
        <h2 className="text-md font-semibold text-[--tx]">{title}</h2>
        {hint && <p className="mt-1 text-xs text-[--tx3]">{hint}</p>}
      </div>
      {children}
    </Card>
  );
}

/** Labelled row: description on the left, control on the right. */
function Row({
  label,
  desc,
  children,
}: {
  label: string;
  desc?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 py-2.5">
      <div className="min-w-0">
        <div className="text-sm text-[--tx1]">{label}</div>
        {desc && <div className="mt-0.5 text-xs text-[--tx3]">{desc}</div>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

/** Segmented control used for mode + language. */
function Segmented({
  options,
  value,
  onChange,
}: {
  options: Array<{ id: string; label: string }>;
  value: string;
  onChange: (id: string) => void;
}) {
  return (
    <div
      className="inline-flex rounded-[--rp] border border-[--ln] p-0.5"
      style={{ background: 'var(--p1)' }}
    >
      {options.map((o) => {
        const on = o.id === value;
        return (
          <button
            key={o.id || 'default'}
            type="button"
            onClick={() => onChange(o.id)}
            aria-pressed={on}
            className="rounded-[--rp] px-3 py-1.5 text-xs transition-colors"
            style={{
              background: on ? 'var(--p2)' : 'transparent',
              color: on ? 'var(--tx)' : 'var(--tx2)',
              fontWeight: on ? 600 : 400,
              boxShadow: on ? 'var(--sh)' : 'none',
            }}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

export default function AdminTheme() {
  const qc = useQueryClient();
  const preview = useThemeStore((s) => s.preview);

  const { data, isLoading } = useQuery({
    queryKey: ['admin', 'theme'],
    queryFn: getAdminTheme,
  });

  const [form, setForm] = useState<ThemeConfigResponse | null>(null);

  // Seed the form once the server value arrives.
  useEffect(() => {
    if (data && !form) setForm(data);
  }, [data, form]);

  // Live-preview every edit.
  function update(patch: Partial<ThemeConfigResponse>) {
    setForm((f) => {
      if (!f) return f;
      const next = { ...f, ...patch };
      preview(next);
      return next;
    });
  }

  const activeTemplate = useMemo(
    () => resolveTemplate(form?.template),
    [form?.template],
  );

  const save = useMutation({
    mutationFn: (body: ThemeConfigResponse) => putAdminTheme(body),
    onSuccess: (next) => {
      qc.setQueryData(['admin', 'theme'], next);
      // The public config carries the same block — drop it so the next
      // consumer refetches the new theme.
      qc.invalidateQueries({ queryKey: ['public-config'] });
      setForm(next);
      preview(next);
      toast.success('主题已保存 · 所有访客生效');
    },
    onError: (e: unknown) => {
      const msg = e instanceof ApiError ? e.message : (e as Error)?.message ?? '—';
      toast.error(msg);
    },
  });

  function onReset() {
    if (!data) return;
    setForm(data);
    preview(data);
  }

  if (isLoading || !form) {
    return (
      <div className="flex justify-center py-16">
        <Spinner />
      </div>
    );
  }

  const dirty = !!data && JSON.stringify(data) !== JSON.stringify(form);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold text-[--tx]">主题</h1>
        <p className="mt-1 text-sm text-[--tx2]">
          改动即时预览，保存后对所有访客生效。无需重新构建或重新部署。
        </p>
      </div>

      {/* ── Template ──────────────────────────────────────────────────── */}
      <Section title="主题模板" hint="前台与后台共用同一套模板">
        <div className="grid gap-3 sm:grid-cols-2">
          {TEMPLATES.map((t) => {
            const on = t.id === form.template;
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => {
                  // Switching template may invalidate the accent; mirror the
                  // store's fallback so the form and the DOM agree.
                  const nextTpl = resolveTemplate(t.id);
                  const keep =
                    form.accent === 'custom' ||
                    nextTpl.accents.some((a) => a.id === form.accent);
                  update({
                    template: t.id,
                    accent: keep ? form.accent : nextTpl.defaultAccent,
                  });
                }}
                className="flex items-center gap-3 rounded-[--rs] border p-3 text-left transition-colors"
                style={{
                  borderColor: on ? 'var(--ac)' : 'var(--ln)',
                  background: on ? 'var(--acs)' : 'transparent',
                }}
              >
                <span className="flex shrink-0 gap-1" aria-hidden="true">
                  {[t.preview.c1, t.preview.c2, t.preview.c3].map((c, i) => (
                    <span
                      key={i}
                      className="block h-8 w-4 rounded-[3px] border border-[--ln]"
                      style={{ background: c }}
                    />
                  ))}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5">
                    <span className="text-sm font-semibold text-[--tx]">
                      {t.name}
                    </span>
                    {on && (
                      <span
                        className="rounded-[--rt] px-1.5 py-0.5 text-[10px]"
                        style={{ background: 'var(--ac)', color: '#fff' }}
                      >
                        使用中
                      </span>
                    )}
                  </span>
                  <span className="mt-0.5 block text-xs text-[--tx3]">
                    {t.description}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      </Section>

      {/* ── Appearance ────────────────────────────────────────────────── */}
      <Section title="外观">
        <Row label="默认模式" desc="新访客首次打开时的亮/暗">
          <Segmented
            options={MODE_OPTIONS}
            value={form.mode}
            onChange={(id) => update({ mode: id })}
          />
        </Row>
        <div className="h-px bg-[--ln]" />
        <Row label="锁定模式" desc="开启后隐藏访客的亮/暗切换，强制使用上面的默认">
          <button
            type="button"
            role="switch"
            aria-checked={form.lock_mode}
            onClick={() => update({ lock_mode: !form.lock_mode })}
            className="relative h-6 w-11 rounded-full transition-colors"
            style={{
              background: form.lock_mode ? 'var(--ac)' : 'var(--ln2)',
            }}
          >
            <span
              className="absolute top-0.5 h-5 w-5 rounded-full bg-white transition-transform"
              style={{
                transform: form.lock_mode
                  ? 'translateX(22px)'
                  : 'translateX(2px)',
              }}
            />
          </button>
        </Row>
      </Section>

      {/* ── Accent ────────────────────────────────────────────────────── */}
      <Section
        title="强调色"
        hint="输入 6 位十六进制，或点色块取色；深浅色自动适配"
      >
        <div className="flex flex-wrap items-start gap-4">
          {activeTemplate.accents.map((a) => {
            const on = a.id === form.accent;
            return (
              <button
                key={a.id}
                type="button"
                onClick={() => update({ accent: a.id })}
                className="flex flex-col items-center gap-1.5"
              >
                <span
                  className="block h-9 w-9 rounded-full"
                  style={{
                    background: a.hex,
                    boxShadow: on
                      ? '0 0 0 2px var(--bg), 0 0 0 4px var(--ac)'
                      : '0 0 0 1px var(--ln2)',
                  }}
                />
                <span
                  className="text-xs"
                  style={{ color: on ? 'var(--tx)' : 'var(--tx3)' }}
                >
                  {a.label}
                </span>
              </button>
            );
          })}

          {/* Custom colour */}
          <div className="flex flex-col items-center gap-1.5">
            <label
              className="relative block h-9 w-9 cursor-pointer rounded-full"
              style={{
                background: form.accent_custom || '#6b9fd4',
                boxShadow:
                  form.accent === 'custom'
                    ? '0 0 0 2px var(--bg), 0 0 0 4px var(--ac)'
                    : '0 0 0 1px var(--ln2)',
              }}
            >
              <input
                type="color"
                value={form.accent_custom || '#6b9fd4'}
                onChange={(e) =>
                  update({ accent: 'custom', accent_custom: e.target.value })
                }
                className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
              />
            </label>
            <span
              className="text-xs"
              style={{
                color: form.accent === 'custom' ? 'var(--tx)' : 'var(--tx3)',
              }}
            >
              自定义
            </span>
          </div>

          <div className="w-32">
            <Input
              value={form.accent_custom}
              placeholder="#6b9fd4"
              onChange={(e) => {
                let v = e.target.value.trim();
                if (v && !v.startsWith('#')) v = '#' + v;
                const valid = /^#[0-9a-fA-F]{6}$/.test(v);
                update({
                  accent_custom: v,
                  accent: valid ? 'custom' : form.accent,
                });
              }}
            />
          </div>
        </div>
      </Section>

      {/* ── Branding ──────────────────────────────────────────────────── */}
      <Section title="品牌与文案" hint="留空则使用内置默认值">
        <div className="space-y-3">
          <Row label="站点名称">
            <div className="w-56">
              <Input
                value={form.brand_name}
                placeholder="Yui Drop"
                onChange={(e) => update({ brand_name: e.target.value })}
              />
            </div>
          </Row>
          <Row label="首页大标题">
            <div className="w-56">
              <Input
                value={form.hero_title}
                placeholder="丢入文件，取得六位取件码"
                onChange={(e) => update({ hero_title: e.target.value })}
              />
            </div>
          </Row>
          <Row label="副标题">
            <div className="w-56">
              <Input
                value={form.hero_subtitle}
                placeholder="匿名、无需账号。"
                onChange={(e) => update({ hero_subtitle: e.target.value })}
              />
            </div>
          </Row>
          <Row label="默认语言">
            <Segmented
              options={LANG_OPTIONS}
              value={form.default_lang}
              onChange={(id) => update({ default_lang: id })}
            />
          </Row>
          <Row label="站点图标" desc="SVG 或 PNG，建议 512×512；留空则用默认纸飞机">
            <div className="w-56">
              <Input
                value={form.logo_url}
                placeholder="https://… 或 /logo.svg"
                onChange={(e) => update({ logo_url: e.target.value })}
              />
            </div>
          </Row>
        </div>
      </Section>

      {/* ── Actions ───────────────────────────────────────────────────── */}
      <div className="flex items-center gap-2 pb-2">
        <Button
          onClick={() => save.mutate(form)}
          disabled={save.isPending || !dirty}
        >
          <Check className="mr-1.5 h-4 w-4" />
          {save.isPending ? '保存中…' : '保存主题'}
        </Button>
        <Button variant="ghost" onClick={onReset} disabled={!dirty}>
          <RotateCcw className="mr-1.5 h-4 w-4" />
          重置
        </Button>
        {dirty && (
          <span className="text-xs text-[--tx3]">有未保存的改动（当前为预览）</span>
        )}
      </div>
    </div>
  );
}
