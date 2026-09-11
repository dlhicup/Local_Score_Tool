/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        ink: {
          900: '#0C120F', 800: '#141C18', 700: '#1B241F', 600: '#556158',
          500: '#6E7D74', 400: '#A9B7AF', 300: '#C7D2CB', 200: '#DCE4DC', 100: '#E8F0EA',
        },
        pitch: {
          300: '#6EE7B0', 400: '#34D399', 500: '#22C55E', 600: '#16A34A', 700: '#15803D',
        },
        avoid: { 400: '#F0837A', 500: '#EF4444' },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['"IBM Plex Mono"', 'ui-monospace', 'monospace'],
      },
      fontSize: { '2xs': '0.6875rem' },
      boxShadow: { lift: '0 12px 40px rgba(0,0,0,.5)' },
    },
  },
  plugins: [],
};
