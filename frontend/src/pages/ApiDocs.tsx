/**
 * /docs — Public API documentation for drop.leod.me.
 *
 * Rendered in the washi style so it feels like a sibling page of the home
 * uploader. Sticky-left TOC + scrollable content on desktop, single column
 * on mobile. All copy lives here (no i18n) — the audience is developers
 * and 主人 himself, who reads both Chinese and English fluently.
 */
import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { useTranslation } from "react-i18next";

import { Header } from "../variants/washi/Header";
import { PaperTexture } from "../variants/washi/PaperTexture";
import {
  WASHI_DARK,
  WASHI_PALETTES,
  type WashiColors,
  type WashiMode,
  type WashiPaletteName,
} from "../variants/washi/palettes";
import type { WashiLang } from "../variants/washi/pickers/LangPicker";
import { CodeBlock } from "./api-docs/CodeBlock";
import { EndpointBlock } from "./api-docs/EndpointBlock";

const LS_PALETTE_KEY = "yui-washi-palette";
const LS_MODE_KEY = "yui-washi-mode";
const LS_LANG_KEY = "yui-washi-lang";

function readLs<T extends string>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  const v = window.localStorage.getItem(key);
  return (v as T) || fallback;
}

function resolveMode(mode: WashiMode): "light" | "dark" {
  if (mode !== "auto") return mode;
  if (typeof window === "undefined" || !window.matchMedia) return "light";
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function pickColors(palette: WashiPaletteName, mode: WashiMode): WashiColors {
  return resolveMode(mode) === "dark" ? WASHI_DARK[palette] : WASHI_PALETTES[palette];
}

const TOC_ITEMS: Array<{ id: string; label: string }> = [
  { id: "intro", label: "介绍" },
  { id: "auth", label: "鉴权 Authentication" },
  { id: "upload", label: "POST /upload" },
  { id: "multipart-init", label: "POST /upload/init" },
  { id: "multipart-sign", label: "POST /upload/{id}/sign-part" },
  { id: "multipart-complete", label: "POST /upload/{id}/complete" },
  { id: "multipart-abort", label: "DELETE /upload/{id}" },
  { id: "list-shares", label: "GET /shares" },
  { id: "get-share", label: "GET /shares/{code}" },
  { id: "expire-styles", label: "expire_style 取值" },
  { id: "errors", label: "错误码" },
  { id: "quota", label: "配额说明" },
  { id: "request-key", label: "申请 key" },
];

// ── Endpoint payload constants (kept outside JSX to avoid template-literal /
// JSX parser interactions with bare { } in the JSON examples) ──────────────

const UPLOAD_RESPONSE = [
  "{",
  '  "code": 2000,',
  '  "message": "ok",',
  '  "detail": {',
  '    "code": "abc12345",',
  '    "name": "hello.txt",',
  '    "size": 12,',
  '    "expired_at": "2026-05-28T00:00:00+00:00",',
  '    "expired_count": -1,',
  '    "url": "https://drop.leod.me/api/share/download/abc12345",',
  '    "short_url": "https://drop.leod.me/s/abc12345"',
  "  }",
  "}",
].join("\n");

const UPLOAD_CURL = [
  "curl -X POST https://drop.leod.me/api/v1/upload \\",
  '  -H "Authorization: Bearer yd_xxxxxxxx_yyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyy" \\',
  '  -F "file=@./hello.txt" \\',
  '  -F "expire_value=1" \\',
  '  -F "expire_style=day"',
].join("\n");

const MULTIPART_INIT_RESPONSE = [
  "{",
  '  "code": 2000,',
  '  "detail": {',
  '    "upload_id": "8f3a2c...",',
  '    "key": "2026/05/27/hello.bin",',
  '    "part_size": 5242880,',
  '    "parts_total": 12,',
  '    "expires_at": "2026-05-27T13:00:00+00:00"',
  "  }",
  "}",
].join("\n");

const MULTIPART_INIT_CURL = [
  "curl -X POST https://drop.leod.me/api/v1/upload/init \\",
  '  -H "Authorization: Bearer yd_..." \\',
  '  -H "Content-Type: application/json" \\',
  '  -d \'{"file_name":"big.bin","file_size":62914560,"expire_value":1,"expire_style":"day"}\'',
].join("\n");

const SIGN_PART_RESPONSE = [
  "{",
  '  "code": 2000,',
  '  "detail": {',
  '    "url": "https://<bucket>.r2.cloudflarestorage.com/...&X-Amz-Signature=...",',
  '    "headers": {},',
  '    "expires_at": "2026-05-27T13:00:00+00:00",',
  '    "part_number": 1',
  "  }",
  "}",
].join("\n");

const SIGN_PART_CURL = [
  "curl -X POST https://drop.leod.me/api/v1/upload/8f3a2c.../sign-part \\",
  '  -H "Authorization: Bearer yd_..." \\',
  '  -H "Content-Type: application/json" \\',
  '  -d \'{"part_number": 1}\'',
].join("\n");

const COMPLETE_RESPONSE = [
  "{",
  '  "code": 2000,',
  '  "detail": {',
  '    "code": "abc12345",',
  '    "name": "big.bin",',
  '    "size": 62914560,',
  '    "expired_at": "2026-05-28T00:00:00+00:00",',
  '    "expired_count": -1,',
  '    "url": "https://drop.leod.me/api/share/download/abc12345",',
  '    "short_url": "https://drop.leod.me/s/abc12345"',
  "  }",
  "}",
].join("\n");

const COMPLETE_CURL = [
  "curl -X POST https://drop.leod.me/api/v1/upload/8f3a2c.../complete \\",
  '  -H "Authorization: Bearer yd_..." \\',
  '  -H "Content-Type: application/json" \\',
  '  -d \'{"parts": [{"part_number": 1, "etag": "abc"}, ...]}\'',
].join("\n");

const ABORT_RESPONSE = [
  "{",
  '  "code": 2000,',
  '  "detail": { "upload_id": "8f3a2c...", "aborted": true }',
  "}",
].join("\n");

const ABORT_CURL = [
  "curl -X DELETE https://drop.leod.me/api/v1/upload/8f3a2c... \\",
  '  -H "Authorization: Bearer yd_..."',
].join("\n");

const LIST_RESPONSE = [
  "{",
  '  "code": 2000,',
  '  "detail": {',
  '    "total": 2,',
  '    "items": [',
  "      {",
  '        "code": "abc12345",',
  '        "name": "hello.txt",',
  '        "size": 12,',
  '        "kind": "file",',
  '        "expired_at": "2026-05-28T00:00:00+00:00",',
  '        "expired_count": -1,',
  '        "used_count": 0,',
  '        "created_at": "2026-05-27T01:23:45+00:00",',
  '        "url": "https://drop.leod.me/api/share/download/abc12345",',
  '        "short_url": "https://drop.leod.me/s/abc12345"',
  "      }",
  "    ]",
  "  }",
  "}",
].join("\n");

const LIST_CURL = [
  "curl https://drop.leod.me/api/v1/shares?limit=10 \\",
  '  -H "Authorization: Bearer yd_..."',
].join("\n");

const GET_RESPONSE = [
  "{",
  '  "code": 2000,',
  '  "detail": { /* 与 /shares 的列表项相同 */ }',
  "}",
].join("\n");

const GET_CURL = [
  "curl https://drop.leod.me/api/v1/shares/abc12345 \\",
  '  -H "Authorization: Bearer yd_..."',
].join("\n");

const AUTH_HEADER_EXAMPLE = "Authorization: Bearer yd_<8char_id>_<32char_secret>";


export default function ApiDocs() {
  // i18n hook present for Header consistency; no translation keys used here.
  useTranslation();

  const [palette, setPalette] = useState<WashiPaletteName>(() =>
    readLs<WashiPaletteName>(LS_PALETTE_KEY, "sumi"),
  );
  const [mode, setMode] = useState<WashiMode>(() => readLs<WashiMode>(LS_MODE_KEY, "auto"));
  const [lang, setLang] = useState<WashiLang>(() => readLs<WashiLang>(LS_LANG_KEY, "zh"));

  useEffect(() => {
    window.localStorage.setItem(LS_PALETTE_KEY, palette);
  }, [palette]);
  useEffect(() => {
    window.localStorage.setItem(LS_MODE_KEY, mode);
  }, [mode]);
  useEffect(() => {
    window.localStorage.setItem(LS_LANG_KEY, lang);
  }, [lang]);

  const c = useMemo(() => pickColors(palette, mode), [palette, mode]);

  // Apply page-level background so the iOS safe areas match.
  useEffect(() => {
    const prev = document.body.style.background;
    document.body.style.background = c.paper;
    return () => {
      document.body.style.background = prev;
    };
  }, [c.paper]);

  return (
    <div
      style={{
        background: c.paper,
        color: c.ink,
        minHeight: "100vh",
        fontFamily:
          '"Noto Sans JP", "Noto Sans SC", -apple-system, BlinkMacSystemFont, sans-serif',
      }}
    >
      <PaperTexture color={c.paper} />
      <div style={{ maxWidth: 1100, margin: "0 auto", padding: "28px 24px 80px" }}>
        <Header
          c={c}
          palette={palette}
          setPalette={setPalette}
          mode={mode}
          setMode={setMode}
          lang={lang}
          setLang={setLang}
        />

        <header style={{ marginTop: 36, marginBottom: 8 }}>
          <h1 style={{ fontSize: 34, margin: 0, letterSpacing: "-0.01em" }}>drop API</h1>
          <p style={{ marginTop: 6, color: c.sub, fontSize: 14, lineHeight: 1.6 }}>
            为主人和 Yui 准备的小巧上传接口 ✨ — 用一个 API key 把文件丢上来，拿到一个可分享的短链接。
          </p>
        </header>

        <div
          className="api-docs-grid"
          style={{
            display: "grid",
            gridTemplateColumns: "minmax(0, 1fr)",
            gap: 32,
            marginTop: 24,
          }}
        >
          <style>{`@media (min-width: 900px) { .api-docs-grid { grid-template-columns: 200px minmax(0, 1fr) !important; } }`}</style>

          <nav
            style={{
              position: "sticky",
              top: 16,
              alignSelf: "start",
              fontSize: 13,
              borderLeft: "2px solid " + c.soft,
              paddingLeft: 14,
            }}
          >
            <div
              style={{
                fontSize: 10.5,
                letterSpacing: "0.18em",
                color: c.sub,
                textTransform: "uppercase",
                marginBottom: 10,
              }}
            >
              Contents
            </div>
            <ul
              style={{
                listStyle: "none",
                padding: 0,
                margin: 0,
                display: "flex",
                flexDirection: "column",
                gap: 6,
              }}
            >
              {TOC_ITEMS.map((it) => (
                <li key={it.id}>
                  <a href={"#" + it.id} style={{ color: c.sub, textDecoration: "none", fontSize: 12.5 }}>
                    {it.label}
                  </a>
                </li>
              ))}
            </ul>
          </nav>

          <main style={{ minWidth: 0 }}>

            <section id="intro" style={sectionStyle(c)}>
              <h2 style={h2Style(c)}>介绍</h2>
              <p style={pStyle(c)}>
                drop API 是 yui-drop（drop.leod.me）的公开 HTTP 接口。设计目标是让 Yui、其他自动化脚本、或主人未来的任何项目，都能用一行 curl 把文件丢到这个文件柜里，拿到一个短链接和可选的过期时间。
              </p>
              <ul style={ulStyle(c)}>
                <li>
                  <strong>基础 URL：</strong>
                  <code style={inlineCode(c)}>https://drop.leod.me/api/v1</code>
                </li>
                <li>
                  <strong>所有响应：</strong>统一封装为
                  {" "}
                  <code style={inlineCode(c)}>{"{ code, message, detail }"}</code>，
                  <code style={inlineCode(c)}>code === 2000</code> 表示成功。
                </li>
                <li>
                  <strong>不开放自助注册：</strong>API key 由主人在 admin 后台手动签发，详见
                  <a href="#request-key" style={linkStyle(c)}>申请 key</a>。
                </li>
              </ul>
            </section>

            <section id="auth" style={sectionStyle(c)}>
              <h2 style={h2Style(c)}>鉴权 Authentication</h2>
              <p style={pStyle(c)}>
                所有 <code style={inlineCode(c)}>/api/v1/*</code> 端点都要求在
                {" "}<code style={inlineCode(c)}>Authorization</code>{" "}header 里带 Bearer token：
              </p>
              <CodeBlock c={c} language="HTTP" code={AUTH_HEADER_EXAMPLE} />
              <p style={pStyle(c)}>
                key 格式固定是 <code style={inlineCode(c)}>yd_</code> + 8 位公开 ID + <code style={inlineCode(c)}>_</code> + 32 位密钥。前 11 个字符是公开前缀，会出现在 admin 后台和日志里；完整明文只在签发时显示一次，不存在任何地方可以再看到。
              </p>
              <ul style={ulStyle(c)}>
                <li><code style={inlineCode(c)}>4011</code> · 401 — 缺失或无效的 key</li>
                <li><code style={inlineCode(c)}>4012</code> · 401 — key 已撤销或过期</li>
                <li><code style={inlineCode(c)}>4031</code> · 403 — scope 不足（你的 key 没有 <code style={inlineCode(c)}>upload</code> 或 <code style={inlineCode(c)}>read</code>）</li>
              </ul>
            </section>

            <EndpointBlock
              c={c}
              id="upload"
              method="POST"
              path="/api/v1/upload"
              title="简单上传 — 文件 ≤ 10 MiB"
              description={
                <span>
                  把一个小文件以 multipart/form-data 上传。响应里的{" "}
                  <code style={inlineCode(c)}>code</code> 是 5-8 字符的取件码，
                  <code style={inlineCode(c)}>url</code> 是下载直链，
                  <code style={inlineCode(c)}>short_url</code> 是短链。文件{" > "}10 MiB（服务端 simple-upload 上限）请改用下面的分片接口。
                </span>
              }
              requestParams={[
                { name: "file", type: "file", required: true, description: "multipart 字段，文件本体" },
                { name: "expire_value", type: "int", description: "过期数值（≥ 1），默认 1" },
                { name: "expire_style", type: "enum", description: "过期单位，默认 day；见 expire_style 取值" },
              ]}
              responseShape={UPLOAD_RESPONSE}
              curlExample={UPLOAD_CURL}
            />

            <EndpointBlock
              c={c}
              id="multipart-init"
              method="POST"
              path="/api/v1/upload/init"
              title="分片上传 — 第一步：初始化"
              description={
                <span>
                  大文件（{" > "}10 MiB）走 R2 multipart presigned URL 协议。客户端先 init 申请一个{" "}
                  <code style={inlineCode(c)}>upload_id</code>，然后按{" "}
                  <code style={inlineCode(c)}>parts_total</code> 数量逐个请求 part presigned URL，PUT 上传完整后 complete 收尾。
                </span>
              }
              requestParams={[
                { name: "file_name", type: "string", required: true, description: "文件名，1-512 字符" },
                { name: "file_size", type: "int", required: true, description: "字节数，≥ 1，必须 ≤ max_file_size" },
                { name: "content_type", type: "string", description: "MIME 类型，可空" },
                { name: "expire_value", type: "int", description: "过期数值，默认 1" },
                { name: "expire_style", type: "enum", description: "过期单位，默认 day" },
              ]}
              responseShape={MULTIPART_INIT_RESPONSE}
              curlExample={MULTIPART_INIT_CURL}
            />

            <EndpointBlock
              c={c}
              id="multipart-sign"
              method="POST"
              path="/api/v1/upload/{upload_id}/sign-part"
              title="分片上传 — 第二步：取单 part presigned URL"
              description={
                <span>
                  对每个 part（1 到 <code style={inlineCode(c)}>parts_total</code>）调一次，拿到一个 R2 的 PUT presigned URL，然后客户端直接把这一段字节 PUT 上去，记录返回头里的 <code style={inlineCode(c)}>ETag</code>。
                </span>
              }
              requestParams={[
                { name: "part_number", type: "int", required: true, description: "1-10000" },
              ]}
              responseShape={SIGN_PART_RESPONSE}
              curlExample={SIGN_PART_CURL}
            />

            <EndpointBlock
              c={c}
              id="multipart-complete"
              method="POST"
              path="/api/v1/upload/{upload_id}/complete"
              title="分片上传 — 第三步：完成"
              description={
                <span>
                  全部 part PUT 完后调一次。服务端把 part 清单交给 R2 拼接成最终对象，校验大小（{" > "}5% 偏差会失败），创建 FileCode 并返回与简单上传一致的响应。
                </span>
              }
              requestParams={[
                {
                  name: "parts",
                  type: "array",
                  required: true,
                  description: "全部 part 的 number+ETag 清单，长度必须等于 parts_total",
                },
              ]}
              responseShape={COMPLETE_RESPONSE}
              curlExample={COMPLETE_CURL}
            />

            <EndpointBlock
              c={c}
              id="multipart-abort"
              method="DELETE"
              path="/api/v1/upload/{upload_id}"
              title="分片上传 — 取消"
              description={
                <span>放弃一个进行中的分片会话。R2 上已经传的 part 会被回收，DB 里的 session 行被删除。</span>
              }
              responseShape={ABORT_RESPONSE}
              curlExample={ABORT_CURL}
            />

            <EndpointBlock
              c={c}
              id="list-shares"
              method="GET"
              path="/api/v1/shares"
              title="列出本 key 签发过的分享"
              description={
                <span>
                  分页查询用当前 key 上传的所有分享。<code style={inlineCode(c)}>status</code> 默认{" "}
                  <code style={inlineCode(c)}>active</code>，可改成 <code style={inlineCode(c)}>expired</code> 或{" "}
                  <code style={inlineCode(c)}>all</code>。
                </span>
              }
              requestParams={[
                { name: "limit", type: "int", description: "1-200，默认 50" },
                { name: "offset", type: "int", description: "≥ 0，默认 0" },
                { name: "status", type: "enum", description: "active / expired / all" },
              ]}
              responseShape={LIST_RESPONSE}
              curlExample={LIST_CURL}
            />

            <EndpointBlock
              c={c}
              id="get-share"
              method="GET"
              path="/api/v1/shares/{code}"
              title="查询单个分享"
              description={
                <span>
                  返回与列表项相同的形状。<strong>仅返回当前 key 创建的分享</strong>，否则 404（防止用别人的 key 探测分享存在与否）。
                </span>
              }
              responseShape={GET_RESPONSE}
              curlExample={GET_CURL}
            />

            <section id="expire-styles" style={sectionStyle(c)}>
              <h2 style={h2Style(c)}>expire_style 取值</h2>
              <table style={tableStyle(c)}>
                <thead>
                  <tr style={{ background: c.soft }}>
                    <th style={thS(c)}>value</th>
                    <th style={thS(c)}>含义</th>
                  </tr>
                </thead>
                <tbody>
                  <tr><td style={tdS(c, true)}>minute</td><td style={tdS(c, false)}>N 分钟后过期</td></tr>
                  <tr><td style={tdS(c, true)}>hour</td><td style={tdS(c, false)}>N 小时后过期</td></tr>
                  <tr><td style={tdS(c, true)}>day</td><td style={tdS(c, false)}>N 天后过期（默认）</td></tr>
                  <tr><td style={tdS(c, true)}>week</td><td style={tdS(c, false)}>N 周后过期</td></tr>
                  <tr><td style={tdS(c, true)}>month</td><td style={tdS(c, false)}>N 月后过期</td></tr>
                  <tr><td style={tdS(c, true)}>year</td><td style={tdS(c, false)}>N 年后过期</td></tr>
                  <tr><td style={tdS(c, true)}>count</td><td style={tdS(c, false)}>被下载 N 次后失效（expired_count 计数）</td></tr>
                  <tr><td style={tdS(c, true)}>forever</td><td style={tdS(c, false)}>永不过期</td></tr>
                </tbody>
              </table>
              <p style={{ ...pStyle(c), fontSize: 12.5 }}>
                <code style={inlineCode(c)}>expire_value</code> 是上面公式里的 N，必须 ≥ 1（<code style={inlineCode(c)}>forever</code> 忽略此值）。
              </p>
            </section>

            <section id="errors" style={sectionStyle(c)}>
              <h2 style={h2Style(c)}>错误码</h2>
              <table style={tableStyle(c)}>
                <thead>
                  <tr style={{ background: c.soft }}>
                    <th style={thS(c)}>code</th>
                    <th style={thS(c)}>HTTP</th>
                    <th style={thS(c)}>含义</th>
                  </tr>
                </thead>
                <tbody>
                  <tr><td style={tdS(c, true)}>4011</td><td style={tdS(c, true)}>401</td><td style={tdS(c, false)}>缺失 / 无效 API key</td></tr>
                  <tr><td style={tdS(c, true)}>4012</td><td style={tdS(c, true)}>401</td><td style={tdS(c, false)}>key 已撤销或已过期</td></tr>
                  <tr><td style={tdS(c, true)}>4031</td><td style={tdS(c, true)}>403</td><td style={tdS(c, false)}>scope 不足（key 没有所需权限）</td></tr>
                  <tr><td style={tdS(c, true)}>4292</td><td style={tdS(c, true)}>429</td><td style={tdS(c, false)}>当日字节配额已用尽</td></tr>
                  <tr><td style={tdS(c, true)}>4293</td><td style={tdS(c, true)}>413</td><td style={tdS(c, false)}>文件超过 max_file_size</td></tr>
                  <tr><td style={tdS(c, true)}>4040</td><td style={tdS(c, true)}>404</td><td style={tdS(c, false)}>分享 / upload 会话不存在或不属于当前 key</td></tr>
                </tbody>
              </table>
            </section>

            <section id="quota" style={sectionStyle(c)}>
              <h2 style={h2Style(c)}>配额说明</h2>
              <p style={pStyle(c)}>
                每把 API key 都有三个独立配额，admin 在签发时可以单独覆盖。默认值是：
              </p>
              <ul style={ulStyle(c)}>
                <li><code style={inlineCode(c)}>max_file_size</code>: <strong>500 MiB</strong> — 单个文件上限</li>
                <li><code style={inlineCode(c)}>quota_daily_bytes</code>: <strong>5 GiB / 天</strong> — 当 UTC 日累计字节</li>
                <li><code style={inlineCode(c)}>quota_per_minute</code>: <strong>30 / 分钟</strong> — 调用频率（暂未上线，预留）</li>
              </ul>
              <p style={pStyle(c)}>
                配额 <code style={inlineCode(c)}>quota_daily_bytes = 0</code> 表示不限。配额查询走 <code style={inlineCode(c)}>api_key_usage</code> 表的当日汇总行，简单上传在响应成功后才计入，分片上传在 complete 阶段才计入。
              </p>
            </section>

            <section id="request-key" style={sectionStyle(c)}>
              <h2 style={h2Style(c)}>申请 key</h2>
              <p style={pStyle(c)}>
                drop API 目前 <strong>不开放自助注册</strong>。如果你想要一把 key 来跑自己的脚本或者把 drop 接入你的项目，直接联系：
              </p>
              <ul style={ulStyle(c)}>
                <li>📮 邮箱：<a href="mailto:leo@leod.me" style={linkStyle(c)}>leo@leod.me</a></li>
                <li>💬 Discord：<code style={inlineCode(c)}>@leeeo.d</code></li>
              </ul>
              <p style={{ ...pStyle(c), fontSize: 12.5, color: c.sub }}>
                每把 key 签发时可以独立设置备注、配额、scope 和过期时间。明文 key 只在签发那一刻显示一次，请立即保存。
              </p>
            </section>

          </main>
        </div>
      </div>
    </div>
  );
}

// ── Style helpers (inline, washi-friendly) ─────────────────────────────────

function sectionStyle(c: WashiColors): CSSProperties {
  return {
    scrollMarginTop: 24,
    marginTop: 32,
    padding: 20,
    background: c.paper,
    border: "1px solid " + c.ink + "1a",
    borderRadius: 12,
  };
}

function h2Style(c: WashiColors): CSSProperties {
  return {
    fontSize: 20,
    margin: "0 0 10px",
    color: c.ink,
    letterSpacing: "-0.005em",
  };
}

function pStyle(c: WashiColors): CSSProperties {
  return {
    color: c.ink,
    fontSize: 14,
    lineHeight: 1.7,
    margin: "8px 0",
  };
}

function ulStyle(c: WashiColors): CSSProperties {
  return {
    color: c.ink,
    fontSize: 14,
    lineHeight: 1.85,
    paddingLeft: 22,
    margin: "8px 0",
  };
}

function inlineCode(c: WashiColors): CSSProperties {
  return {
    background: c.soft,
    color: c.ink,
    padding: "1px 6px",
    borderRadius: 4,
    fontFamily: '"JetBrains Mono", "SF Mono", "Menlo", ui-monospace, monospace',
    fontSize: 12.5,
  };
}

function linkStyle(c: WashiColors): CSSProperties {
  return {
    color: c.accent,
    textDecoration: "underline",
    textDecorationThickness: 1,
  };
}

function tableStyle(c: WashiColors): CSSProperties {
  return {
    width: "100%",
    borderCollapse: "collapse",
    fontSize: 13,
    marginTop: 8,
    border: "1px solid " + c.ink + "14",
    borderRadius: 8,
    overflow: "hidden",
  };
}

function thS(c: WashiColors): CSSProperties {
  return {
    textAlign: "left",
    padding: "8px 12px",
    fontWeight: 600,
    fontSize: 11.5,
    letterSpacing: "0.1em",
    textTransform: "uppercase",
    color: c.sub,
  };
}

function tdS(c: WashiColors, mono: boolean): CSSProperties {
  return {
    padding: "8px 12px",
    color: c.ink,
    verticalAlign: "top",
    borderTop: "1px solid " + c.ink + "10",
    fontFamily: mono ? '"JetBrains Mono", "SF Mono", "Menlo", ui-monospace, monospace' : "inherit",
    fontSize: mono ? 12.5 : 13,
  };
}
