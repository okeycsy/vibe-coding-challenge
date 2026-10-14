/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        navy: {
          50: '#f2f5fa',
          100: '#e3e9f3',
          200: '#c3cfe3',
          300: '#94a9cb',
          400: '#5f7cab',
          500: '#3d5c8f',
          600: '#2c4675',
          700: '#22375e',
          800: '#1a2b4a',
          900: '#121f36',
          950: '#0b1424',
        },
      },
      fontFamily: {
        sans: ['Pretendard', 'Apple SD Gothic Neo', 'Malgun Gothic', 'system-ui', 'sans-serif'],
      },
      keyframes: {
        fadein: { from: { opacity: 0, transform: 'translateY(4px)' }, to: { opacity: 1, transform: 'none' } },
      },
      animation: { fadein: 'fadein .25s ease-out' },
    },
  },
  plugins: [],
};
