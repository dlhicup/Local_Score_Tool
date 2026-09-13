/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        ink: {
          950: '#05070A',
          900: '#080B10',
          850: '#0B0F15',
          800: '#10151D',
          750: '#151B25',
          700: '#1C232F',
          600: '#28313F',
          500: '#3A4557',
          400: '#5A6779',
          300: '#8593A5',
          200: '#B4C0CE',
          100: '#DDE4EC',
        },
        pitch: {
          400: '#5BF5A0',
          500: '#22E37D',
          600: '#12C566',
          700: '#0C9A4F',
        },
        avoid: { 500: '#FF4D5E' },
      },
      fontSize: {
        // One deliberate step below `xs`, so small print is a choice rather than
        // eight different hand-picked pixel values.
        '2xs': ['0.6875rem', { lineHeight: '0.95rem' }],
      },
      fontFamily: {
        sans: ['Inter', 'ui-sans-serif', 'system-ui', '-apple-system', 'Segoe UI', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
      boxShadow: {
        glow: '0 0 0 1px rgba(34,227,125,.25), 0 8px 40px -8px rgba(34,227,125,.35)',
        lift: '0 20px 50px -20px rgba(0,0,0,.85)',
      },
      backgroundImage: {
        'grid-fade':
          'radial-gradient(ellipse 80% 60% at 50% -10%, rgba(34,227,125,.14), transparent 70%)',
      },
      keyframes: {
        shimmer: { '0%': { backgroundPosition: '-200% 0' }, '100%': { backgroundPosition: '200% 0' } },
        pulseRing: {
          '0%': { boxShadow: '0 0 0 0 rgba(34,227,125,.5)' },
          '70%': { boxShadow: '0 0 0 12px rgba(34,227,125,0)' },
          '100%': { boxShadow: '0 0 0 0 rgba(34,227,125,0)' },
        },
      },
      animation: {
        shimmer: 'shimmer 2.2s linear infinite',
        pulseRing: 'pulseRing 2s ease-out infinite',
      },
    },
  },
  plugins: [],
};
