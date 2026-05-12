/** @type {import('tailwindcss').Config} */
// Tailwind v3.4 config. We keep the palette extremely small here because
// almost all "themed" colors are emitted through CSS variables (see
// src/styles/tokens.css). Tailwind handles spacing, layout, and the few
// fixed status colors. accent-* utilities reference the live --accent-h/s/l.
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: ['class', '[data-theme="dark"]'],
  theme: {
    extend: {
      fontFamily: {
        sans: [
          '-apple-system',
          'BlinkMacSystemFont',
          '"Segoe UI"',
          'system-ui',
          'sans-serif',
        ],
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
      fontSize: {
        xs: ['12px', { lineHeight: '1.5' }],
        sm: ['13px', { lineHeight: '1.5' }],
        base: ['14px', { lineHeight: '1.5' }],
        md: ['15px', { lineHeight: '1.5' }],
        lg: ['17px', { lineHeight: '1.4' }],
        xl: ['20px', { lineHeight: '1.3' }],
        '2xl': ['24px', { lineHeight: '1.25' }],
        '3xl': ['32px', { lineHeight: '1.2' }],
        '4xl': ['44px', { lineHeight: '1.1' }],
      },
      borderRadius: {
        sm: '6px',
        DEFAULT: '8px',
        md: '10px',
        lg: '12px',
        xl: '16px',
      },
      colors: {
        // Surfaces — driven by CSS vars set per theme in tokens.css.
        bg: 'var(--bg)',
        'bg-1': 'var(--bg-1)',
        'bg-2': 'var(--bg-2)',
        text: 'var(--text)',
        'text-1': 'var(--text-1)',
        'text-2': 'var(--text-2)',
        muted: 'var(--text-muted)',
        border: 'var(--border)',
        'border-strong': 'var(--border-strong)',
        // accent — computed from --accent-h/s/l. Use accent / accent-soft.
        accent: 'hsl(var(--accent-h) var(--accent-s) var(--accent-l))',
        'accent-soft':
          'hsl(var(--accent-h) var(--accent-s) var(--accent-l) / 0.18)',
        // Fixed status colors.
        error: '#ef4444',
        warn: '#f59e0b',
      },
      boxShadow: {
        // Subtle ring used for focused inputs / hovered cards.
        focus: '0 0 0 1px hsl(var(--accent-h) var(--accent-s) var(--accent-l))',
        card: '0 1px 0 0 var(--border) inset',
      },
      keyframes: {
        shiny: {
          '0%': { backgroundPosition: '200% 0' },
          '100%': { backgroundPosition: '-200% 0' },
        },
        float: {
          '0%, 100%': { transform: 'translateY(0px)' },
          '50%': { transform: 'translateY(-10px)' },
        },
        fadeUp: {
          '0%': { opacity: '0', transform: 'translateY(6px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
      },
      animation: {
        shiny: 'shiny 4s ease-in-out infinite',
        float: 'float 7s ease-in-out infinite',
        fadeUp: 'fadeUp 0.4s ease-out both',
      },
    },
  },
  plugins: [],
};
