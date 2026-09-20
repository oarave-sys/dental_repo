import type { Config } from 'tailwindcss'

/**
 * A calm clinical palette. Trust in this product comes from looking like
 * something a practice already uses, not from decoration — so there are no
 * gradients, the accent appears sparingly, and confidence levels are the only
 * place colour carries meaning.
 */
export default {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: { DEFAULT: '#14202b', 2: '#42525e', 3: '#6d7c88' },
        paper: '#f6f8f9',
        surface: { DEFAULT: '#ffffff', 2: '#eef2f3' },
        rule: { DEFAULT: '#dde4e6', 2: '#c5d0d3' },
        brand: {
          DEFAULT: '#0b6b62',
          hover: '#095a52',
          soft: '#e4f1ef',
          ring: '#0b6b6233',
        },
        // Semantic only: confidence, warnings, documentation status.
        high: { DEFAULT: '#1f6b43', bg: '#e6f2ea', border: '#bcdcc8' },
        medium: { DEFAULT: '#8a6106', bg: '#fbf0d9', border: '#e8d3a2' },
        low: { DEFAULT: '#9a3a2f', bg: '#f9e7e4', border: '#eec5be' },
        info: { DEFAULT: '#28566f', bg: '#e6eef3', border: '#c2d5e0' },
      },
      fontFamily: {
        sans: ['var(--font-sans)', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
      boxShadow: {
        card: '0 1px 2px rgba(20, 32, 43, 0.04), 0 1px 3px rgba(20, 32, 43, 0.06)',
        lift: '0 2px 4px rgba(20, 32, 43, 0.06), 0 8px 20px rgba(20, 32, 43, 0.08)',
      },
      maxWidth: { content: '76rem' },
    },
  },
  plugins: [],
} satisfies Config
