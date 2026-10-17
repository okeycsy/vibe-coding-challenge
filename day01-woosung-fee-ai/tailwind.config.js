/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        // 금융권 네이비 톤
        navy: {
          50: '#eef2f8',
          100: '#d6dfed',
          200: '#adbfdb',
          300: '#7d97c2',
          400: '#5172a6',
          500: '#34568c',
          600: '#254272',
          700: '#1b335c',
          800: '#13264a',
          900: '#0b1a36',
          950: '#071126',
        },
        gold: { 400: '#d9b45a', 500: '#c79a3a' },
      },
      fontFamily: {
        sans: ['Pretendard', 'Apple SD Gothic Neo', 'Malgun Gothic', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
};
