/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        // Co-Elevator Design System
        primary: {
          DEFAULT: '#8B7355',
          dark: '#6B5344',
          light: '#C9B8A8',
        },
        background: {
          DEFAULT: '#FAF8F5',
          alt: '#F5F2ED',
        },
        text: {
          DEFAULT: '#2D2A26',
          muted: '#6B6560',
        },
        success: '#5D8B55',
        warning: '#C9A86C',
        error: '#B85C5C',
        // Additional shades for UI elements
        bronze: {
          50: '#FAF8F5',
          100: '#F5F2ED',
          200: '#E8E2D9',
          300: '#D4C9BB',
          400: '#C9B8A8',
          500: '#8B7355',
          600: '#6B5344',
          700: '#5A4538',
          800: '#48382D',
          900: '#2D2A26',
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
      },
      boxShadow: {
        'soft': '0 2px 8px rgba(45, 42, 38, 0.08)',
        'medium': '0 4px 16px rgba(45, 42, 38, 0.12)',
        'large': '0 8px 32px rgba(45, 42, 38, 0.16)',
      },
      borderRadius: {
        'xl': '0.875rem',
        '2xl': '1rem',
        '3xl': '1.5rem',
      },
      animation: {
        'pulse-slow': 'pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'fade-in': 'fadeIn 0.3s ease-in-out',
        'slide-up': 'slideUp 0.3s ease-out',
        'slide-down': 'slideDown 0.3s ease-out',
      },
      keyframes: {
        fadeIn: {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        slideUp: {
          '0%': { transform: 'translateY(10px)', opacity: '0' },
          '100%': { transform: 'translateY(0)', opacity: '1' },
        },
        slideDown: {
          '0%': { transform: 'translateY(-10px)', opacity: '0' },
          '100%': { transform: 'translateY(0)', opacity: '1' },
        },
      },
    },
  },
  plugins: [],
}
