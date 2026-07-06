/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        farm: {
          50: '#faf7f0',
          100: '#f3ecdc',
          200: '#e6d7b8',
          300: '#d4ba85',
          400: '#c29b5c',
          500: '#a87d3e',
          600: '#8a6431',
          700: '#6e4e2a',
          800: '#5b4026',
          900: '#4d3722',
        },
      },
    },
  },
  plugins: [],
};
