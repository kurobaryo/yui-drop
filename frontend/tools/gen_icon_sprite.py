"""Convert the prototype's SVG sprite into a React component.

The prototype references icons as <use href="#i-name"/> against an inline
<svg width="0"> defs block. Reproducing that sprite verbatim keeps every icon
pixel-identical to the design and avoids hand-picking lucide-react imports.

Linear ships 35 icons, Apple 33 — we emit the union so either theme resolves.
"""
from __future__ import annotations

import re
from pathlib import Path

SPEC = Path("/home/ubuntu/yui-workspace/v2-spec")
OUT = Path(
    "/home/ubuntu/yui-workspace/yui-drop/frontend/src/v2/components/IconSprite.tsx"
)

groups: dict[str, str] = {}
for tag in ("linear", "apple"):
    sprite = (SPEC / f"{tag}.icons.svg").read_text(encoding="utf-8", errors="replace")
    for m in re.finditer(r'<g id="(i-[^"]+)"(.*?)</g>', sprite, re.S):
        name = m.group(1)
        groups.setdefault(name, f'<g id="{name}"{m.group(2)}</g>')

print(f"icons collected: {len(groups)}")
print(sorted(groups))

# JSX-ify: SVG attributes must be camelCased for React.
ATTR = {
    "stroke-width": "strokeWidth",
    "stroke-linecap": "strokeLinecap",
    "stroke-linejoin": "strokeLinejoin",
    "fill-rule": "fillRule",
    "clip-rule": "clipRule",
    "stroke-dasharray": "strokeDasharray",
}


def jsxify(s: str) -> str:
    for a, b in ATTR.items():
        s = s.replace(f"{a}=", f"{b}=")
    return s


body = "\n    ".join(jsxify(groups[k]) for k in sorted(groups))

tsx = f'''/**
 * Icon sprite — generated from the design prototype's inline <svg> defs.
 *
 * DO NOT hand-edit. Regenerate with tools/gen_icon_sprite.py after the
 * prototype changes.
 *
 * Rendered once near the app root; components reference icons with:
 *   <svg width={{16}} height={{16}} viewBox="0 0 24 24"><use href="#i-copy" /></svg>
 *
 * Using the prototype's own paths (rather than re-picking lucide-react icons)
 * guarantees the glyphs match the design exactly.
 *
 * Icons ({len(groups)}): {", ".join(sorted(groups))}
 */
export function IconSprite() {{
  return (
    <svg width={{0}} height={{0}} style={{{{ position: 'absolute' }}}} aria-hidden="true">
      <defs>
    {body}
      </defs>
    </svg>
  );
}}

/** Convenience wrapper so call sites stay short and consistent. */
export function Icon({{
  name,
  size = 16,
  className,
  style,
}}: {{
  name: string;
  size?: number;
  className?: string;
  style?: React.CSSProperties;
}}) {{
  return (
    <svg
      width={{size}}
      height={{size}}
      viewBox="0 0 24 24"
      className={{className}}
      style={{style}}
      aria-hidden="true"
    >
      <use href={{`#${{name}}`}} />
    </svg>
  );
}}

export default IconSprite;
'''

OUT.parent.mkdir(parents=True, exist_ok=True)
OUT.write_text(tsx, encoding="utf-8")
print("wrote", OUT, OUT.stat().st_size, "bytes")
