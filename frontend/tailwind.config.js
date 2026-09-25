/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: '#1c1915',
        paper: '#f4f0e6',
        card: '#fffdf8',
        line: '#e3d9c8',
        pine: '#1d6b4a',
        clay: '#9a5b2e',
        wine: '#8e3140',
        mist: '#6d675e',
      },
      fontFamily: {
        sans: ['"Source Sans 3"', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        display: ['Fraunces', 'Georgia', 'serif'],
      },
      boxShadow: {
        card: '0 1px 0 rgba(28, 25, 21, 0.04), 0 12px 32px rgba(28, 25, 21, 0.04)',
      },
    },
  },
  plugins: [],
};
