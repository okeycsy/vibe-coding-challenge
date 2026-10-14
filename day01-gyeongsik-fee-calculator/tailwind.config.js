/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        // 금융결제원 CI 심벌마크(public/kftc-symbol.png)의 그라데이션에서 뽑은 색상.
        // brand-700~800이 심벌의 짙은 블루, accent-500이 밝은 블루다.
        brand: {
          50: '#eef4fc',
          100: '#d9e6f8',
          200: '#b3ccf0',
          300: '#80a9e3',
          400: '#4a84d4',
          500: '#2468c4',
          600: '#1657bb',
          700: '#0e45aa',
          800: '#0d389e',
          900: '#0a2d80',
          950: '#071f5c',
        },
        accent: {
          50: '#e8f3fc',
          100: '#cbe5f8',
          200: '#97caf1',
          300: '#5fadea',
          400: '#3399e2',
          500: '#178cdc',
          600: '#1274bd',
          700: '#0e5c96',
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
