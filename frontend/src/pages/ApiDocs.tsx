/**
 * /docs — Public API documentation for drop.leod.me.
 *
 * Rendered in the washi style so it feels like a sibling page of the home
 * uploader. Sticky-left TOC + scrollable content on desktop, single column
 * on mobile. Copy is i18n'd through react-i18next; code-block payloads
 * (JSON, curl) stay as constants because they're identifiers, not prose.
 */
import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { Trans, useTranslation } from "react-i18next";
import { Menu } from "lucide-react";

import { Header } from "../variants/washi/Header";
import { Footer } from "../variants/washi/Footer";
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

const TOC_IDS = [
  "intro",
  "auth",
  "upload",
  "multipartInit",
  "multipartSign",
  "multipartComplete",
  "multipartAbort",
  "listShares",
  "getShare",
  "clients",
  "expireStyles",
  "errors",
  "quota",
  "requestKey",
] as const;

// Section id used in the URL hash differs slightly from the i18n key so
// existing bookmarks (intro/auth/upload/...) keep working.
const HASH_FOR_TOC: Record<(typeof TOC_IDS)[number], string> = {
  intro: "intro",
  auth: "auth",
  upload: "upload",
  multipartInit: "multipart-init",
  multipartSign: "multipart-sign",
  multipartComplete: "multipart-complete",
  multipartAbort: "multipart-abort",
  listShares: "list-shares",
  getShare: "get-share",
  clients: "clients",
  expireStyles: "expire-styles",
  errors: "errors",
  quota: "quota",
  requestKey: "request-key",
};

// ── Endpoint payload constants (kept outside JSX to avoid template-literal /
// JSX parser interactions with bare { } in the JSON examples) ──────────────

const ENVELOPE_EXAMPLE = '{ "code": 2000, "message": "ok", "detail": { ... } }';
const AUTH_HEADER_EXAMPLE = "Authorization: Bearer yd_<8char_id>_<32char_secret>";

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
  '  "detail": { /* identical to a list item */ }',
  "}",
].join("\n");

const GET_CURL = [
  "curl https://drop.leod.me/api/v1/shares/abc12345 \\",
  '  -H "Authorization: Bearer yd_..."',
].join("\n");

const CONTACT_EMAIL = "leo@leod.me";
const CONTACT_GITHUB_URL = "https://github.com/kurobaryo/yui-drop/issues";
const CONTACT_GITHUB_HANDLE = "kurobaryo";
const CONTACT_DISPLAY_NAME = "Leeeo.D";

export default function ApiDocs() {
  const { t } = useTranslation();

  const [palette, setPalette] = useState<WashiPaletteName>(() =>
    readLs<WashiPaletteName>(LS_PALETTE_KEY, "sumi"),
  );
  const [mode, setMode] = useState<WashiMode>(() => readLs<WashiMode>(LS_MODE_KEY, "auto"));
  const [lang, setLang] = useState<WashiLang>(() => readLs<WashiLang>(LS_LANG_KEY, "zh"));
  const [tocOpen, setTocOpen] = useState(false);

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
          <h1 style={{ fontSize: 34, margin: 0, letterSpacing: "-0.01em" }}>{t("apiDocs.title")}</h1>
          <p style={{ marginTop: 6, color: c.sub, fontSize: 14, lineHeight: 1.6 }}>
            {t("apiDocs.subtitle")}
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
          <style>{`
            @media (min-width: 768px) {
              .api-docs-grid { grid-template-columns: 200px minmax(0, 1fr) !important; }
              .api-docs-toc { display: block !important; }
              .api-docs-toc-hamburger { display: none !important; }
            }
            @media (max-width: 767.98px) {
              .api-docs-toc { display: none !important; }
              .api-docs-main pre { overflow-x: auto !important; max-width: 100% !important; }
              .api-docs-main table { display: block !important; overflow-x: auto !important; max-width: 100% !important; }
            }
          `}</style>

          <nav
            className="api-docs-toc"
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
              {t("apiDocs.contentsLabel")}
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
              {TOC_IDS.map((tocId) => (
                <li key={tocId}>
                  <a
                    href={"#" + HASH_FOR_TOC[tocId]}
                    style={{ color: c.sub, textDecoration: "none", fontSize: 12.5 }}
                  >
                    {t("apiDocs.toc." + tocId)}
                  </a>
                </li>
              ))}
            </ul>
          </nav>

          <main className="api-docs-main" style={{ minWidth: 0 }}>
            <button
              type="button"
              className="api-docs-toc-hamburger"
              onClick={() => setTocOpen(true)}
              aria-label={t("apiDocs.contentsLabel")}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 8,
                background: c.paper,
                color: c.ink,
                border: "1px solid " + c.soft,
                borderRadius: 8,
                padding: "8px 12px",
                marginBottom: 16,
                cursor: "pointer",
                fontFamily: "inherit",
                fontSize: 13,
              }}
            >
              <Menu size={16} />
              <span style={{ letterSpacing: "0.08em" }}>
                {t("apiDocs.contentsLabel")}
              </span>
            </button>

            <section id="intro" style={sectionStyle(c)}>
              <h2 style={h2Style(c)}>{t("apiDocs.intro.heading")}</h2>
              <p style={pStyle(c)}>{t("apiDocs.intro.p1")}</p>
              <ul style={ulStyle(c)}>
                <li>
                  <strong>{t("apiDocs.intro.baseUrlLabel")}</strong>{" "}
                  <code style={inlineCode(c)}>https://drop.leod.me/api/v1</code>
                </li>
                <li>
                  <strong>{t("apiDocs.intro.envelopeLabel")}</strong>{" "}
                  <code style={inlineCode(c)}>{ENVELOPE_EXAMPLE}</code>
                  {t("apiDocs.intro.envelopeSuffix")}
                </li>
                <li>
                  {t("apiDocs.intro.signupLabel")}{" "}
                  <a href="#request-key" style={linkStyle(c)}>{t("apiDocs.intro.signupLink")}</a>
                  {t("apiDocs.intro.signupSuffix")}
                </li>
                <li>
                  <strong>{t("apiDocs.intro.encryptionLabel")}</strong>
                  {t("apiDocs.intro.encryptionBody")}
                </li>
              </ul>
            </section>

            <section id="auth" style={sectionStyle(c)}>
              <h2 style={h2Style(c)}>{t("apiDocs.auth.heading")}</h2>
              <p style={pStyle(c)}>{t("apiDocs.auth.p1")}</p>
              <CodeBlock c={c} language="HTTP" code={AUTH_HEADER_EXAMPLE} />
              <p style={pStyle(c)}>{t("apiDocs.auth.p2")}</p>
              <p style={{ ...pStyle(c), marginBottom: 4 }}>{t("apiDocs.auth.errorsHeading")}</p>
              <ul style={ulStyle(c)}>
                <li><code style={inlineCode(c)}>4011</code> · {t("apiDocs.auth.errorMissing")}</li>
                <li><code style={inlineCode(c)}>4012</code> · {t("apiDocs.auth.errorRevoked")}</li>
                <li><code style={inlineCode(c)}>4031</code> · {t("apiDocs.auth.errorScope")}</li>
              </ul>
            </section>

            <EndpointBlock
              c={c}
              id="upload"
              method="POST"
              path="/api/v1/upload"
              title={t("apiDocs.endpoints.upload.title")}
              description={<span>{t("apiDocs.endpoints.upload.description")}</span>}
              requestParams={[
                { name: "file", type: "file", required: true, description: t("apiDocs.endpoints.upload.paramFile") },
                { name: "expire_value", type: "int", description: t("apiDocs.endpoints.upload.paramExpireValue") },
                { name: "expire_style", type: "enum", description: t("apiDocs.endpoints.upload.paramExpireStyle") },
              ]}
              responseShape={UPLOAD_RESPONSE}
              curlExample={UPLOAD_CURL}
            />

            <EndpointBlock
              c={c}
              id="multipart-init"
              method="POST"
              path="/api/v1/upload/init"
              title={t("apiDocs.endpoints.multipartInit.title")}
              description={<span>{t("apiDocs.endpoints.multipartInit.description")}</span>}
              requestParams={[
                { name: "file_name", type: "string", required: true, description: t("apiDocs.endpoints.multipartInit.paramFileName") },
                { name: "file_size", type: "int", required: true, description: t("apiDocs.endpoints.multipartInit.paramFileSize") },
                { name: "content_type", type: "string", description: t("apiDocs.endpoints.multipartInit.paramContentType") },
                { name: "expire_value", type: "int", description: t("apiDocs.endpoints.multipartInit.paramExpireValue") },
                { name: "expire_style", type: "enum", description: t("apiDocs.endpoints.multipartInit.paramExpireStyle") },
              ]}
              responseShape={MULTIPART_INIT_RESPONSE}
              curlExample={MULTIPART_INIT_CURL}
            />

            <EndpointBlock
              c={c}
              id="multipart-sign"
              method="POST"
              path="/api/v1/upload/{upload_id}/sign-part"
              title={t("apiDocs.endpoints.multipartSign.title")}
              description={<span>{t("apiDocs.endpoints.multipartSign.description")}</span>}
              requestParams={[
                { name: "part_number", type: "int", required: true, description: t("apiDocs.endpoints.multipartSign.paramPartNumber") },
              ]}
              responseShape={SIGN_PART_RESPONSE}
              curlExample={SIGN_PART_CURL}
            />

            <EndpointBlock
              c={c}
              id="multipart-complete"
              method="POST"
              path="/api/v1/upload/{upload_id}/complete"
              title={t("apiDocs.endpoints.multipartComplete.title")}
              description={<span>{t("apiDocs.endpoints.multipartComplete.description")}</span>}
              requestParams={[
                {
                  name: "parts",
                  type: "array",
                  required: true,
                  description: t("apiDocs.endpoints.multipartComplete.paramParts"),
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
              title={t("apiDocs.endpoints.multipartAbort.title")}
              description={<span>{t("apiDocs.endpoints.multipartAbort.description")}</span>}
              responseShape={ABORT_RESPONSE}
              curlExample={ABORT_CURL}
            />

            <EndpointBlock
              c={c}
              id="list-shares"
              method="GET"
              path="/api/v1/shares"
              title={t("apiDocs.endpoints.listShares.title")}
              description={<span>{t("apiDocs.endpoints.listShares.description")}</span>}
              requestParams={[
                { name: "limit", type: "int", description: t("apiDocs.endpoints.listShares.paramLimit") },
                { name: "offset", type: "int", description: t("apiDocs.endpoints.listShares.paramOffset") },
                { name: "status", type: "enum", description: t("apiDocs.endpoints.listShares.paramStatus") },
              ]}
              responseShape={LIST_RESPONSE}
              curlExample={LIST_CURL}
            />

            <EndpointBlock
              c={c}
              id="get-share"
              method="GET"
              path="/api/v1/shares/{code}"
              title={t("apiDocs.endpoints.getShare.title")}
              description={<span>{t("apiDocs.endpoints.getShare.description")}</span>}
              responseShape={GET_RESPONSE}
              curlExample={GET_CURL}
            />

            <section id="clients" style={sectionStyle(c)}>
              <h2 style={h2Style(c)}>{t("apiDocs.clients.heading")}</h2>
              <p style={pStyle(c)}>{t("apiDocs.clients.p1")}</p>
              <div style={{ display: "grid", gap: 12, marginTop: 8 }}>
                <ClientCard
                  c={c}
                  title={t("apiDocs.clients.curlTitle")}
                  body={t("apiDocs.clients.curlBody")}
                />
                <ClientCard
                  c={c}
                  title={t("apiDocs.clients.pythonTitle")}
                  body={t("apiDocs.clients.pythonBody")}
                />
                <ClientCard
                  c={c}
                  title={t("apiDocs.clients.uppyTitle")}
                  body={t("apiDocs.clients.uppyBody")}
                />
              </div>
            </section>

            <section id="expire-styles" style={sectionStyle(c)}>
              <h2 style={h2Style(c)}>{t("apiDocs.expireStyles.heading")}</h2>
              <table style={tableStyle(c)}>
                <thead>
                  <tr style={{ background: c.soft }}>
                    <th style={thS(c)}>{t("apiDocs.expireStyles.headerValue")}</th>
                    <th style={thS(c)}>{t("apiDocs.expireStyles.headerMeaning")}</th>
                  </tr>
                </thead>
                <tbody>
                  <tr><td style={tdS(c, true)}>minute</td><td style={tdS(c, false)}>{t("apiDocs.expireStyles.minute")}</td></tr>
                  <tr><td style={tdS(c, true)}>hour</td><td style={tdS(c, false)}>{t("apiDocs.expireStyles.hour")}</td></tr>
                  <tr><td style={tdS(c, true)}>day</td><td style={tdS(c, false)}>{t("apiDocs.expireStyles.day")}</td></tr>
                  <tr><td style={tdS(c, true)}>week</td><td style={tdS(c, false)}>{t("apiDocs.expireStyles.week")}</td></tr>
                  <tr><td style={tdS(c, true)}>month</td><td style={tdS(c, false)}>{t("apiDocs.expireStyles.month")}</td></tr>
                  <tr><td style={tdS(c, true)}>year</td><td style={tdS(c, false)}>{t("apiDocs.expireStyles.year")}</td></tr>
                  <tr><td style={tdS(c, true)}>count</td><td style={tdS(c, false)}>{t("apiDocs.expireStyles.count")}</td></tr>
                  <tr><td style={tdS(c, true)}>forever</td><td style={tdS(c, false)}>{t("apiDocs.expireStyles.forever")}</td></tr>
                </tbody>
              </table>
              <p style={{ ...pStyle(c), fontSize: 12.5 }}>{t("apiDocs.expireStyles.footnote")}</p>
            </section>

            <section id="errors" style={sectionStyle(c)}>
              <h2 style={h2Style(c)}>{t("apiDocs.errors.heading")}</h2>
              <table style={tableStyle(c)}>
                <thead>
                  <tr style={{ background: c.soft }}>
                    <th style={thS(c)}>{t("apiDocs.errors.headerCode")}</th>
                    <th style={thS(c)}>{t("apiDocs.errors.headerHttp")}</th>
                    <th style={thS(c)}>{t("apiDocs.errors.headerMeaning")}</th>
                  </tr>
                </thead>
                <tbody>
                  <tr><td style={tdS(c, true)}>4011</td><td style={tdS(c, true)}>401</td><td style={tdS(c, false)}>{t("apiDocs.errors.missing")}</td></tr>
                  <tr><td style={tdS(c, true)}>4012</td><td style={tdS(c, true)}>401</td><td style={tdS(c, false)}>{t("apiDocs.errors.revoked")}</td></tr>
                  <tr><td style={tdS(c, true)}>4031</td><td style={tdS(c, true)}>403</td><td style={tdS(c, false)}>{t("apiDocs.errors.scope")}</td></tr>
                  <tr><td style={tdS(c, true)}>4292</td><td style={tdS(c, true)}>429</td><td style={tdS(c, false)}>{t("apiDocs.errors.quotaDaily")}</td></tr>
                  <tr><td style={tdS(c, true)}>4293</td><td style={tdS(c, true)}>413</td><td style={tdS(c, false)}>{t("apiDocs.errors.quotaFileSize")}</td></tr>
                  <tr><td style={tdS(c, true)}>4040</td><td style={tdS(c, true)}>404</td><td style={tdS(c, false)}>{t("apiDocs.errors.notFound")}</td></tr>
                </tbody>
              </table>
            </section>

            <section id="quota" style={sectionStyle(c)}>
              <h2 style={h2Style(c)}>{t("apiDocs.quota.heading")}</h2>
              <p style={pStyle(c)}>{t("apiDocs.quota.p1")}</p>
              <ul style={ulStyle(c)}>
                <li><Trans i18nKey="apiDocs.quota.maxFileSize" components={{ code: <code style={inlineCode(c)} /> }} /></li>
                <li><Trans i18nKey="apiDocs.quota.quotaDailyBytes" components={{ code: <code style={inlineCode(c)} /> }} /></li>
                <li><Trans i18nKey="apiDocs.quota.quotaPerMinute" components={{ code: <code style={inlineCode(c)} /> }} /></li>
              </ul>
              <p style={pStyle(c)}>{t("apiDocs.quota.p2")}</p>
            </section>

            <section id="request-key" style={sectionStyle(c)}>
              <h2 style={h2Style(c)}>{t("apiDocs.requestKey.heading")}</h2>
              <p style={pStyle(c)}>{t("apiDocs.requestKey.p1")}</p>
              <ul style={ulStyle(c)}>
                <li>
                  📮 {t("apiDocs.requestKey.contactEmail")}{" "}
                  <a href={"mailto:" + CONTACT_EMAIL} style={linkStyle(c)}>{CONTACT_EMAIL}</a>
                </li>
                <li>
                  💬 {t("apiDocs.requestKey.contactGithub")}{" "}
                  <a href={CONTACT_GITHUB_URL} style={linkStyle(c)} target="_blank" rel="noreferrer">
                    {t("apiDocs.requestKey.githubLink")}
                  </a>{" "}
                  (<code style={inlineCode(c)}>@{CONTACT_GITHUB_HANDLE}</code> · {CONTACT_DISPLAY_NAME})
                </li>
              </ul>
              <p style={{ ...pStyle(c), fontSize: 12.5, color: c.sub }}>{t("apiDocs.requestKey.p2")}</p>
            </section>

          </main>
        </div>
        <Footer c={c} />
      </div>
      {tocOpen && typeof document !== "undefined"
        ? createPortal(
            <>
              <div
                onClick={() => setTocOpen(false)}
                style={{
                  position: "fixed",
                  inset: 0,
                  zIndex: 9000,
                  background: "rgba(0, 0, 0, 0.5)",
                  backdropFilter: "blur(6px)",
                  WebkitBackdropFilter: "blur(6px)",
                }}
              />
              <nav
                onClick={(e) => e.stopPropagation()}
                aria-label={t("apiDocs.contentsLabel")}
                style={{
                  position: "fixed",
                  top: 0,
                  left: 0,
                  bottom: 0,
                  zIndex: 9001,
                  width: "min(82vw, 320px)",
                  background: c.paper,
                  color: c.ink,
                  borderRight: `1px solid ${c.soft}`,
                  boxShadow: `0 30px 80px ${c.ink}66`,
                  padding: "24px 22px",
                  overflowY: "auto",
                  fontFamily:
                    '"Noto Sans JP", "Noto Sans SC", -apple-system, BlinkMacSystemFont, sans-serif',
                }}
              >
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    marginBottom: 14,
                  }}
                >
                  <span
                    style={{
                      fontSize: 10.5,
                      letterSpacing: "0.18em",
                      color: c.sub,
                      textTransform: "uppercase",
                    }}
                  >
                    {t("apiDocs.contentsLabel")}
                  </span>
                  <button
                    type="button"
                    onClick={() => setTocOpen(false)}
                    aria-label="close"
                    style={{
                      background: "transparent",
                      border: "none",
                      color: c.sub,
                      fontSize: 22,
                      lineHeight: 1,
                      cursor: "pointer",
                      padding: 0,
                    }}
                  >
                    ×
                  </button>
                </div>
                <ul
                  style={{
                    listStyle: "none",
                    padding: 0,
                    margin: 0,
                    display: "flex",
                    flexDirection: "column",
                    gap: 10,
                  }}
                >
                  {TOC_IDS.map((tocId) => (
                    <li key={tocId}>
                      <a
                        href={"#" + HASH_FOR_TOC[tocId]}
                        onClick={() => setTocOpen(false)}
                        style={{
                          color: c.ink,
                          textDecoration: "none",
                          fontSize: 14,
                          display: "block",
                          padding: "6px 0",
                        }}
                      >
                        {t("apiDocs.toc." + tocId)}
                      </a>
                    </li>
                  ))}
                </ul>
              </nav>
            </>,
            document.body,
          )
        : null}
    </div>
  );
}

// ── Style helpers ──────────────────────────────────────────────────────────

function ClientCard({ c, title, body }: { c: WashiColors; title: string; body: string }) {
  return (
    <div
      style={{
        padding: "12px 16px",
        background: c.paper,
        border: "1px solid " + c.ink + "14",
        borderRadius: 8,
      }}
    >
      <div style={{ fontSize: 13.5, fontWeight: 600, color: c.ink, marginBottom: 4 }}>{title}</div>
      <div style={{ fontSize: 13, color: c.sub, lineHeight: 1.6 }}>{body}</div>
    </div>
  );
}

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
  return { fontSize: 20, margin: "0 0 10px", color: c.ink, letterSpacing: "-0.005em" };
}

function pStyle(c: WashiColors): CSSProperties {
  return { color: c.ink, fontSize: 14, lineHeight: 1.7, margin: "8px 0" };
}

function ulStyle(c: WashiColors): CSSProperties {
  return { color: c.ink, fontSize: 14, lineHeight: 1.85, paddingLeft: 22, margin: "8px 0" };
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
  return { color: c.accent, textDecoration: "underline", textDecorationThickness: 1 };
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
