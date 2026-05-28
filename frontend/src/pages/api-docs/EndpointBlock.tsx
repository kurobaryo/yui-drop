/**
 * EndpointBlock — one HTTP endpoint card for the public /docs page.
 *
 * Layout (washi style, inline styles only):
 *   ┌──────────────────────────────────────────────────────┐
 *   │ [METHOD]  /api/v1/upload            ← title          │
 *   │ description paragraph                                │
 *   │ Request params (optional table)                      │
 *   │ Response                                             │
 *   │ <CodeBlock language="JSON" />                        │
 *   │ Example                                              │
 *   │ <CodeBlock language="BASH" />                        │
 *   └──────────────────────────────────────────────────────┘
 *
 * Method badge colours are constants (not palette tokens) so GET/POST/etc.
 * stay recognisable across washi palettes.
 */
import type { CSSProperties, ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { WashiColors } from '../../variants/washi/palettes';
import { CodeBlock } from './CodeBlock';

export type EndpointMethod = 'GET' | 'POST' | 'PATCH' | 'DELETE';

export interface RequestParam {
  name: string;
  type: string;
  required?: boolean;
  description: string;
}

export interface EndpointBlockProps {
  c: WashiColors;
  id?: string;
  method: EndpointMethod;
  path: string;
  title: string;
  description: ReactNode;
  requestParams?: RequestParam[];
  responseShape: string;
  curlExample: string;
}

const METHOD_COLORS: Record<EndpointMethod, string> = {
  GET: '#3b82f6',
  POST: '#10b981',
  PATCH: '#f59e0b',
  DELETE: '#ef4444',
};

export function EndpointBlock({
  c,
  id,
  method,
  path,
  title,
  description,
  requestParams,
  responseShape,
  curlExample,
}: EndpointBlockProps) {
  const { t } = useTranslation();
  const sectionStyle: CSSProperties = {
    marginTop: 32,
    padding: 20,
    background: `${c.paper}`,
    border: `1px solid ${c.ink}1a`,
    borderRadius: 12,
    boxShadow: `0 1px 0 ${c.ink}08`,
  };

  const badgeStyle: CSSProperties = {
    display: 'inline-block',
    background: METHOD_COLORS[method],
    color: '#fff',
    fontSize: 11,
    fontWeight: 700,
    letterSpacing: '0.08em',
    padding: '3px 9px',
    borderRadius: 5,
    fontFamily:
      '"JetBrains Mono", "SF Mono", "Menlo", ui-monospace, monospace',
    verticalAlign: 'middle',
  };

  const pathStyle: CSSProperties = {
    fontFamily:
      '"JetBrains Mono", "SF Mono", "Menlo", ui-monospace, monospace',
    fontSize: 14,
    color: c.ink,
    marginLeft: 10,
    wordBreak: 'break-all',
  };

  const titleStyle: CSSProperties = {
    fontSize: 13.5,
    color: c.sub,
    marginTop: 6,
    letterSpacing: '0.02em',
  };

  const sectionLabelStyle: CSSProperties = {
    fontSize: 11,
    letterSpacing: '0.2em',
    color: c.sub,
    textTransform: 'uppercase',
    marginTop: 18,
    marginBottom: 4,
  };

  return (
    <section id={id} style={sectionStyle}>
      <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap' }}>
        <span style={badgeStyle}>{method}</span>
        <span style={pathStyle}>{path}</span>
      </div>
      <div style={titleStyle}>{title}</div>

      <div style={{ marginTop: 12, fontSize: 14, lineHeight: 1.65, color: c.ink }}>
        {description}
      </div>

      {requestParams && requestParams.length > 0 ? (
        <>
          <div style={sectionLabelStyle}>{t('apiDocs.endpoint.request')}</div>
          <div
            style={{
              border: `1px solid ${c.ink}14`,
              borderRadius: 8,
              overflow: 'hidden',
              background: c.paper,
            }}
          >
            <table
              style={{
                width: '100%',
                borderCollapse: 'collapse',
                fontSize: 13,
              }}
            >
              <thead>
                <tr style={{ background: c.soft }}>
                  <th style={thStyle(c)}>{t('apiDocs.endpoint.fieldName')}</th>
                  <th style={thStyle(c)}>{t('apiDocs.endpoint.fieldType')}</th>
                  <th style={thStyle(c)}>{t('apiDocs.endpoint.fieldRequired')}</th>
                  <th style={thStyle(c)}>{t('apiDocs.endpoint.fieldDescription')}</th>
                </tr>
              </thead>
              <tbody>
                {requestParams.map((p, i) => (
                  <tr
                    key={p.name}
                    style={{
                      borderTop: i === 0 ? 'none' : `1px solid ${c.ink}10`,
                    }}
                  >
                    <td style={tdStyle(c, true)}>{p.name}</td>
                    <td style={tdStyle(c, true)}>{p.type}</td>
                    <td style={tdStyle(c, false)}>
                      {p.required ? (
                        <span style={{ color: c.accent, fontWeight: 600 }}>
                          {t('apiDocs.endpoint.required')}
                        </span>
                      ) : (
                        <span style={{ color: c.sub }}>{t('apiDocs.endpoint.optional')}</span>
                      )}
                    </td>
                    <td style={tdStyle(c, false)}>{p.description}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : null}

      <div style={sectionLabelStyle}>{t('apiDocs.endpoint.response')}</div>
      <CodeBlock c={c} code={responseShape} language="JSON" />

      <div style={sectionLabelStyle}>{t('apiDocs.endpoint.example')}</div>
      <CodeBlock c={c} code={curlExample} language="BASH" />
    </section>
  );
}

function thStyle(c: WashiColors): CSSProperties {
  return {
    textAlign: 'left',
    padding: '8px 12px',
    fontWeight: 600,
    fontSize: 11.5,
    letterSpacing: '0.1em',
    textTransform: 'uppercase',
    color: c.sub,
  };
}

function tdStyle(c: WashiColors, mono: boolean): CSSProperties {
  return {
    padding: '8px 12px',
    color: c.ink,
    verticalAlign: 'top',
    fontFamily: mono
      ? '"JetBrains Mono", "SF Mono", "Menlo", ui-monospace, monospace'
      : 'inherit',
    fontSize: mono ? 12.5 : 13,
  };
}

export default EndpointBlock;
