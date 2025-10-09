/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html','./src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: { brand: { green: '#22c55e' } }
    }
  },
  plugins: []
};
