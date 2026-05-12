/**
 * Paper texture / noise SVG defs. Currently exposes nothing visible — the
 * source design uses it as a hook for future texture overlays. Kept as a
 * dedicated component so we can swap in an actual <feTurbulence>-driven
 * pattern without touching `WashiApp`.
 */
export function PaperTexture(_props: { color: string }) {
  return (
    <svg width="0" height="0" style={{ position: 'absolute' }}>
      <defs>
        <filter id="washi-noise">
          <feTurbulence baseFrequency="0.9" numOctaves={2} />
        </filter>
      </defs>
    </svg>
  );
}

export default PaperTexture;
