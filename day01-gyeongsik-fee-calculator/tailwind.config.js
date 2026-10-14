/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        // 금융결제원 CI 계열 색상. 주색(brand-700)과 보조색(accent-500)만 바꾸면 전체 화면에 반영된다.
        brand: {
          50: '#eef5fc',
          100: '#d9e9f7',
          200: '#b3d2ee',
          300: '#7fb2e0',
          400: '#3f8ccf',
          500: '#1a72bd',
          600: '#0063b3',
          700: '#005bac',
          800: '#004a8f',
          900: '#003a70',
          950: '#002850',
        },
        accent: {
          50: '#e6f6fd',
          100: '#c7ebfa',
          200: '#8fd6f5',
          300: '#4fc0ef',
          400: '#1fb0ec',
          500: '#00a0e9',
          600: '#0086c4',
          700: '#006b9c',
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
