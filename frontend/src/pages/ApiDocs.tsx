/**
 * /docs — Public API documentation for this instance.
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
  type WashiColors,
  type WashiMode,
  type WashiPaletteName,
} from "../variants/washi/palettes";
import { templateToWashi } from "@/themes/washiBridge";
import { useThemeStore } from "@/stores/theme";
import type { WashiLang } from "../variants/washi/pickers/LangPicker";
import { CodeBlock } from "./api-docs/CodeBlock";
import { EndpointBlock } from "./api-docs/EndpointBlock";

const LS_PALETTE_KEY = "yui-washi-palette";
// Mode is persisted by the shared theme store under its own key.
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

const TOC_IDS = [
  "intro",
  "auth",
  "key",
  "upload",
  "multipartInit",
  "multipartSign",
  "multipartComplete",
  "multipartAbort",
  "shareText",
  "multiCreate",
  "multiFile",
  "multiPart",
  "multiFileComplete",
  "multiFinalize",
  "multiAbort",
  "pickup",
  "listShares",
  "getShare",
  "revokeShare",
  "downloads",
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
  key: "key",
  upload: "upload",
  multipartInit: "multipart-init",
  multipartSign: "multipart-sign",
  multipartComplete: "multipart-complete",
  multipartAbort: "multipart-abort",
  shareText: "share-text",
  multiCreate: "multi-create",
  multiFile: "multi-file",
  multiPart: "multi-part",
  multiFileComplete: "multi-file-complete",
  multiFinalize: "multi-finalize",
  multiAbort: "multi-abort",
  pickup: "pickup",
  listShares: "list-shares",
  getShare: "get-share",
  revokeShare: "revoke-share",
  downloads: "downloads",
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

/** Examples use the address this page is served from, so every instance documents itself. */
const ORIGIN = typeof window !== "undefined" ? window.location.origin : "https://drop.example.com";
/** Shape of the signed `t` download token: share id . expiry . signature. */
const TOKEN = "42.1779840000.Qm9vay1leGFtcGxlLXNpZw";

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
  `    "url": "${ORIGIN}/api/share/download/abc12345?t=${TOKEN}",`,
  `    "short_url": "${ORIGIN}/s/abc12345"`,
  "  }",
  "}",
].join("\n");

const UPLOAD_CURL = [
  `curl -X POST ${ORIGIN}/api/v1/upload \\`,
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
  `curl -X POST ${ORIGIN}/api/v1/upload/init \\`,
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
  `curl -X POST ${ORIGIN}/api/v1/upload/8f3a2c.../sign-part \\`,
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
  `    "url": "${ORIGIN}/api/share/download/abc12345?t=${TOKEN}",`,
  `    "short_url": "${ORIGIN}/s/abc12345"`,
  "  }",
  "}",
].join("\n");

const COMPLETE_CURL = [
  `curl -X POST ${ORIGIN}/api/v1/upload/8f3a2c.../complete \\`,
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
  `curl -X DELETE ${ORIGIN}/api/v1/upload/8f3a2c... \\`,
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
  '        "status": "active",',
  '        "expired_at": "2026-05-28T00:00:00+00:00",',
  '        "expired_count": -1,',
  '        "used_count": 0,',
  '        "created_at": "2026-05-27T01:23:45+00:00",',
  `        "url": "${ORIGIN}/api/share/download/abc12345?t=${TOKEN}",`,
  `        "short_url": "${ORIGIN}/s/abc12345"`,
  "      }",
  "    ]",
  "  }",
  "}",
].join("\n");

const LIST_CURL = [
  `curl ${ORIGIN}/api/v1/shares?limit=10 \\`,
  '  -H "Authorization: Bearer yd_..."',
].join("\n");

const GET_RESPONSE = [
  "{",
  '  "code": 2000,',
  '  "detail": {',
  "    /* identical to a list item; include=content adds: */",
  '    "text": "Two files for you.",',
  '    "files": [',
  "      {",
  '        "file_id": "17",',
  '        "order": 1,',
  '        "name": "photo.jpg",',
  '        "size": 2048,',
  '        "content_type": "image/jpeg",',
  '        "force_download": false,',
  `        "url": "${ORIGIN}/api/share/download/abc12345/17?t=${TOKEN}"`,
  "      }",
  "    ]",
  "  }",
  "}",
].join("\n");

const GET_CURL = [
  `curl "${ORIGIN}/api/v1/shares/abc12345?include=content" \\`,
  '  -H "Authorization: Bearer yd_..."',
].join("\n");

const REVOKE_RESPONSE = '{ "code": 2000, "message": "ok", "detail": { "code": "abc12345", "deleted": true } }';

const REVOKE_CURL = [
  `curl -X DELETE ${ORIGIN}/api/v1/shares/abc12345 \\`,
  '  -H "Authorization: Bearer yd_..."',
].join("\n");

const KEY_RESPONSE = [
  "{",
  '  "code": 2000,',
  '  "detail": {',
  '    "key_id": "a1b2c3d4",',
  '    "scopes": ["upload", "read"],',
  '    "max_file_size": 524288000,',
  '    "quota_daily_bytes": 5368709120',
  "  }",
  "}",
].join("\n");

const KEY_CURL = [
  `curl ${ORIGIN}/api/v1/key \\`,
  '  -H "Authorization: Bearer yd_..."',
].join("\n");

const TEXT_RESPONSE = [
  "{",
  '  "code": 2000,',
  '  "detail": {',
  '    "code": "abc12345",',
  '    "name": null,',
  '    "size": 11,',
  '    "expired_at": "2026-05-28T00:00:00+00:00",',
  '    "expired_count": -1,',
  '    "url": null,',
  `    "short_url": "${ORIGIN}/s/abc12345"`,
  "  }",
  "}",
].join("\n");

const TEXT_CURL = [
  `curl -X POST ${ORIGIN}/api/v1/share/text \\`,
  '  -H "Authorization: Bearer yd_..." \\',
  '  -H "Content-Type: application/json" \\',
  '  -d \'{"text":"hello world","expire_value":1,"expire_style":"day"}\'',
].join("\n");

const MULTI_CREATE_RESPONSE = [
  "{",
  '  "code": 2000,',
  '  "detail": {',
  '    "share_id": "42",',
  '    "code": "abc12345",',
  '    "expired_at": "2026-06-03T00:00:00+00:00",',
  '    "expired_count": -1',
  "  }",
  "}",
].join("\n");

const MULTI_CREATE_CURL = [
  `curl -X POST ${ORIGIN}/api/v1/share/multi \\`,
  '  -H "Authorization: Bearer yd_..." \\',
  '  -H "Content-Type: application/json" \\',
  '  -d \'{"declared_file_count":2,"declared_total_size":7342080,"expire_value":7,"expire_style":"day","text":"Two files for you."}\'',
].join("\n");

const MULTI_FILE_RESPONSE = [
  "{",
  '  "code": 2000,',
  '  "detail": {',
  '    "file_id": "17",',
  '    "upload_id": "5d41402abc4b2a76b9719d911017c592",',
  '    "part_size": 6291456,',
  '    "parts_total": 2,',
  '    "expires_at": "2026-05-27T18:00:00+00:00"',
  "  }",
  "}",
].join("\n");

const MULTI_FILE_CURL = [
  `curl -X POST ${ORIGIN}/api/v1/share/multi/42/files \\`,
  '  -H "Authorization: Bearer yd_..." \\',
  '  -H "Content-Type: application/json" \\',
  '  -d \'{"name":"video.mp4","size":7340032,"content_type":"video/mp4"}\'',
].join("\n");

const MULTI_PART_RESPONSE =
  '{ "code": 2000, "message": "ok", "detail": { "part_number": 1, "etag": "9b2cf535f27731c974343645a3985328" } }';

const MULTI_PART_CURL = [
  `curl -X POST ${ORIGIN}/api/v1/share/multi/42/files/17/parts/1 \\`,
  '  -H "Authorization: Bearer yd_..." \\',
  '  -F "chunk=@./video.mp4.part1"',
].join("\n");

const MULTI_FILE_COMPLETE_RESPONSE =
  '{ "code": 2000, "message": "ok", "detail": { "file_id": "17", "name": "video.mp4", "size": 7340032 } }';

const MULTI_FILE_COMPLETE_CURL = [
  `curl -X POST ${ORIGIN}/api/v1/share/multi/42/files/17/complete \\`,
  '  -H "Authorization: Bearer yd_..." \\',
  '  -H "Content-Type: application/json" \\',
  '  -d \'{"parts":[{"part_number":1,"etag":"9b2c..."},{"part_number":2,"etag":"1f3a..."}]}\'',
].join("\n");

const MULTI_FINALIZE_RESPONSE = [
  "{",
  '  "code": 2000,',
  '  "detail": {',
  '    "code": "abc12345",',
  '    "name": null,',
  '    "size": null,',
  '    "kind": "multi",',
  '    "status": "active",',
  '    "expired_at": "2026-06-03T00:00:00+00:00",',
  '    "expired_count": -1,',
  '    "used_count": 0,',
  '    "created_at": "2026-05-27T12:00:00+00:00",',
  '    "url": null,',
  `    "short_url": "${ORIGIN}/s/abc12345",`,
  '    "file_count": 2,',
  '    "total_size": 7342080,',
  '    "has_note": true',
  "  }",
  "}",
].join("\n");

const MULTI_FINALIZE_CURL = [
  `curl -X POST ${ORIGIN}/api/v1/share/multi/42/finalize \\`,
  '  -H "Authorization: Bearer yd_..."',
].join("\n");

const MULTI_ABORT_RESPONSE = '{ "code": 2000, "message": "ok", "detail": { "share_id": "42", "aborted": true } }';

const MULTI_ABORT_CURL = [
  `curl -X DELETE ${ORIGIN}/api/v1/share/multi/42 \\`,
  '  -H "Authorization: Bearer yd_..."',
].join("\n");

const PICKUP_RESPONSE = [
  "{",
  '  "code": 2000,',
  '  "detail": {',
  '    "code": "abc12345",',
  '    "kind": "file",',
  '    "name": "hello.txt",',
  '    "size": 12,',
  '    "text": null,',
  `    "url": "${ORIGIN}/api/share/download/abc12345?t=${TOKEN}",`,
  '    "content_type": "text/plain; charset=utf-8",',
  '    "force_download": false,',
  '    "expired_at": null,',
  '    "expired_count": 0,',
  '    "used_count": 1',
  "  }",
  "}",
].join("\n");

const PICKUP_CURL = [
  `curl -X POST ${ORIGIN}/api/v1/pickup \\`,
  '  -H "Authorization: Bearer yd_..." \\',
  '  -H "Content-Type: application/json" \\',
  '  -d \'{"code":"abc12345"}\'',
].join("\n");


export default function ApiDocs() {
  const { t } = useTranslation();

  const [palette, setPalette] = useState<WashiPaletteName>(() =>
    readLs<WashiPaletteName>(LS_PALETTE_KEY, "sumi"),
  );
  // Appearance is owned by the shared theme store — see WashiApp for why.
  const storeMode = useThemeStore((s) => s.mode);
  const setStoreMode = useThemeStore((s) => s.setMode);
  const mode = storeMode as WashiMode;
  const setMode = (m: WashiMode) => setStoreMode(m as typeof storeMode);

  const [lang, setLang] = useState<WashiLang>(() => readLs<WashiLang>(LS_LANG_KEY, "zh"));
  const [tocOpen, setTocOpen] = useState(false);

  // Mode persistence belongs to the theme store now (it owns the key and the
  // server-default merge), so no local write for it here.
  useEffect(() => {
    window.localStorage.setItem(LS_LANG_KEY, lang);
  }, [lang]);

  // Colours follow the active template (admin setting via /api/config);
  // light/dark stays the visitor's own preference.
  const template = useThemeStore((s) => s.template);
  const storeAccent = useThemeStore((s) => s.accent);
  const storeAccentCustom = useThemeStore((s) => s.accentCustom);

  const c = useMemo(
    () =>
      templateToWashi(
        template,
        resolveMode(mode) === 'dark',
        storeAccent,
        storeAccentCustom,
      ),
    [template, mode, storeAccent, storeAccentCustom],
  );

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
                  <code style={inlineCode(c)}>{ORIGIN}/api/v1</code>
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
              id="key"
              method="GET"
              path="/api/v1/key"
              title={t("apiDocs.endpoints.key.title")}
              description={<span>{t("apiDocs.endpoints.key.description")}</span>}
              responseShape={KEY_RESPONSE}
              curlExample={KEY_CURL}
            />

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
              id="share-text"
              method="POST"
              path="/api/v1/share/text"
              title={t("apiDocs.endpoints.shareText.title")}
              description={<span>{t("apiDocs.endpoints.shareText.description")}</span>}
              requestParams={[
                { name: "text", type: "string", required: true, description: t("apiDocs.endpoints.shareText.paramText") },
                { name: "expire_value", type: "int", description: t("apiDocs.endpoints.upload.paramExpireValue") },
                { name: "expire_style", type: "enum", description: t("apiDocs.endpoints.upload.paramExpireStyle") },
              ]}
              responseShape={TEXT_RESPONSE}
              curlExample={TEXT_CURL}
            />

            <EndpointBlock
              c={c}
              id="multi-create"
              method="POST"
              path="/api/v1/share/multi"
              title={t("apiDocs.endpoints.multiCreate.title")}
              description={<span>{t("apiDocs.endpoints.multiCreate.description")}</span>}
              requestParams={[
                { name: "declared_file_count", type: "int", required: true, description: t("apiDocs.endpoints.multiCreate.paramCount") },
                { name: "declared_total_size", type: "int", required: true, description: t("apiDocs.endpoints.multiCreate.paramTotal") },
                { name: "expire_value", type: "int", description: t("apiDocs.endpoints.upload.paramExpireValue") },
                { name: "expire_style", type: "enum", description: t("apiDocs.endpoints.upload.paramExpireStyle") },
                { name: "text", type: "string", description: t("apiDocs.endpoints.multiCreate.paramText") },
              ]}
              responseShape={MULTI_CREATE_RESPONSE}
              curlExample={MULTI_CREATE_CURL}
            />

            <EndpointBlock
              c={c}
              id="multi-file"
              method="POST"
              path="/api/v1/share/multi/{share_id}/files"
              title={t("apiDocs.endpoints.multiFile.title")}
              description={<span>{t("apiDocs.endpoints.multiFile.description")}</span>}
              requestParams={[
                { name: "name", type: "string", required: true, description: t("apiDocs.endpoints.multiFile.paramName") },
                { name: "size", type: "int", required: true, description: t("apiDocs.endpoints.multiFile.paramSize") },
                { name: "content_type", type: "string", description: t("apiDocs.endpoints.multiFile.paramContentType") },
              ]}
              responseShape={MULTI_FILE_RESPONSE}
              curlExample={MULTI_FILE_CURL}
            />

            <EndpointBlock
              c={c}
              id="multi-part"
              method="POST"
              path="/api/v1/share/multi/{share_id}/files/{file_id}/parts/{n}"
              title={t("apiDocs.endpoints.multiPart.title")}
              description={<span>{t("apiDocs.endpoints.multiPart.description")}</span>}
              requestParams={[
                { name: "chunk", type: "file", required: true, description: t("apiDocs.endpoints.multiPart.paramChunk") },
              ]}
              responseShape={MULTI_PART_RESPONSE}
              curlExample={MULTI_PART_CURL}
            />

            <EndpointBlock
              c={c}
              id="multi-file-complete"
              method="POST"
              path="/api/v1/share/multi/{share_id}/files/{file_id}/complete"
              title={t("apiDocs.endpoints.multiFileComplete.title")}
              description={<span>{t("apiDocs.endpoints.multiFileComplete.description")}</span>}
              requestParams={[
                { name: "parts", type: "array", required: true, description: t("apiDocs.endpoints.multiFileComplete.paramParts") },
              ]}
              responseShape={MULTI_FILE_COMPLETE_RESPONSE}
              curlExample={MULTI_FILE_COMPLETE_CURL}
            />

            <EndpointBlock
              c={c}
              id="multi-finalize"
              method="POST"
              path="/api/v1/share/multi/{share_id}/finalize"
              title={t("apiDocs.endpoints.multiFinalize.title")}
              description={<span>{t("apiDocs.endpoints.multiFinalize.description")}</span>}
              responseShape={MULTI_FINALIZE_RESPONSE}
              curlExample={MULTI_FINALIZE_CURL}
            />

            <EndpointBlock
              c={c}
              id="multi-abort"
              method="DELETE"
              path="/api/v1/share/multi/{share_id}"
              title={t("apiDocs.endpoints.multiAbort.title")}
              description={<span>{t("apiDocs.endpoints.multiAbort.description")}</span>}
              responseShape={MULTI_ABORT_RESPONSE}
              curlExample={MULTI_ABORT_CURL}
            />

            <EndpointBlock
              c={c}
              id="pickup"
              method="POST"
              path="/api/v1/pickup"
              title={t("apiDocs.endpoints.pickup.title")}
              description={<span>{t("apiDocs.endpoints.pickup.description")}</span>}
              requestParams={[
                { name: "code", type: "string", required: true, description: t("apiDocs.endpoints.pickup.paramCode") },
              ]}
              responseShape={PICKUP_RESPONSE}
              curlExample={PICKUP_CURL}
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
              requestParams={[
                { name: "include", type: "string", description: t("apiDocs.endpoints.getShare.paramInclude") },
              ]}
              responseShape={GET_RESPONSE}
              curlExample={GET_CURL}
            />

            <EndpointBlock
              c={c}
              id="revoke-share"
              method="DELETE"
              path="/api/v1/shares/{code}"
              title={t("apiDocs.endpoints.revokeShare.title")}
              description={<span>{t("apiDocs.endpoints.revokeShare.description")}</span>}
              responseShape={REVOKE_RESPONSE}
              curlExample={REVOKE_CURL}
            />

            <section id="downloads" style={sectionStyle(c)}>
              <h2 style={h2Style(c)}>{t("apiDocs.downloads.heading")}</h2>
              <p style={pStyle(c)}>{t("apiDocs.downloads.p1")}</p>
              <p style={pStyle(c)}>{t("apiDocs.downloads.p2")}</p>
              <p style={pStyle(c)}>{t("apiDocs.downloads.p3")}</p>
            </section>

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
                  <tr><td style={tdS(c, true)}>4002</td><td style={tdS(c, true)}>400</td><td style={tdS(c, false)}>{t("apiDocs.errors.badPart")}</td></tr>
                  <tr><td style={tdS(c, true)}>4004</td><td style={tdS(c, true)}>400</td><td style={tdS(c, false)}>{t("apiDocs.errors.partList")}</td></tr>
                  <tr><td style={tdS(c, true)}>4007</td><td style={tdS(c, true)}>400</td><td style={tdS(c, false)}>{t("apiDocs.errors.shareLimits")}</td></tr>
                  <tr><td style={tdS(c, true)}>4011</td><td style={tdS(c, true)}>401</td><td style={tdS(c, false)}>{t("apiDocs.errors.missing")}</td></tr>
                  <tr><td style={tdS(c, true)}>4012</td><td style={tdS(c, true)}>401</td><td style={tdS(c, false)}>{t("apiDocs.errors.revoked")}</td></tr>
                  <tr><td style={tdS(c, true)}>4031</td><td style={tdS(c, true)}>403</td><td style={tdS(c, false)}>{t("apiDocs.errors.scope")}</td></tr>
                  <tr><td style={tdS(c, true)}>4292</td><td style={tdS(c, true)}>429</td><td style={tdS(c, false)}>{t("apiDocs.errors.quotaDaily")}</td></tr>
                  <tr><td style={tdS(c, true)}>4293</td><td style={tdS(c, true)}>413</td><td style={tdS(c, false)}>{t("apiDocs.errors.quotaFileSize")}</td></tr>
                  <tr><td style={tdS(c, true)}>4040</td><td style={tdS(c, true)}>404</td><td style={tdS(c, false)}>{t("apiDocs.errors.notFound")}</td></tr>
                  <tr><td style={tdS(c, true)}>4090</td><td style={tdS(c, true)}>409</td><td style={tdS(c, false)}>{t("apiDocs.errors.conflict")}</td></tr>
                  <tr><td style={tdS(c, true)}>4101</td><td style={tdS(c, true)}>410</td><td style={tdS(c, false)}>{t("apiDocs.errors.sessionExpired")}</td></tr>
                  <tr><td style={tdS(c, true)}>4133</td><td style={tdS(c, true)}>413</td><td style={tdS(c, false)}>{t("apiDocs.errors.fileTooLarge")}</td></tr>
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
