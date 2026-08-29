import type { Config } from 'tailwindcss'

export default {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: { DEFAULT: '#141c22', 2: '#3d4b55', 3: '#6b7a84' },
        paper: '#f6f7f5',
        surface: { DEFAULT: '#ffffff', 2: '#eef0ec' },
        rule: { DEFAULT: '#dcdfd9', 2: '#c6cbc3' },
        brand: { DEFAULT: '#0d6a68', soft: '#e2eeed' },
        // Triage dispositions are semantic, not decorative.
        green: { DEFAULT: '#2f6d45', bg: '#e4efe6' },
        amber: { DEFAULT: '#8f6408', bg: '#f6ecd7' },
        red: { DEFAULT: '#9b2f2f', bg: '#f5e3e1' },
        slate: { DEFAULT: '#4a5a66', bg: '#e7ebee' },
      },
      fontFamily: {
        sans: ['var(--font-sans)', 'system-ui', 'sans-serif'],
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
    },
  },
  plugins: [],
} satisfies Config
