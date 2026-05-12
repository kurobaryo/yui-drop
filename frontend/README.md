# Frontend — Yui-Drop

React 18 + Vite + TypeScript + Tailwind. See [`../docs/ARCHITECTURE.md`](../docs/ARCHITECTURE.md) for the high-level design.

## Local dev

```bash
pnpm install
pnpm dev      # → http://localhost:5173, /api proxied to :8000
pnpm build    # → dist/
pnpm preview  # → serves the built bundle locally
```

Lint: `pnpm lint`
Type-check: `pnpm tsc --noEmit`
