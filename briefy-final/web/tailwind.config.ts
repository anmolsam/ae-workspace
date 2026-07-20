import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        status: {
          ready: '#16a34a',
          pending: '#d97706',
          error: '#dc2626',
          unavailable: '#6b7280',
        },
      },
    },
  },
  plugins: [],
};

export default config;
