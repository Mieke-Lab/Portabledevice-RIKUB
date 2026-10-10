import tailwindcssAnimate from 'tailwindcss-animate';

/** @type {import('tailwindcss').Config} */
export default {
  darkMode: ['class'],
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    container: { center: true, padding: '1rem' },
    extend: {
      colors: {
        border: 'hsl(var(--border))',
        input: 'hsl(var(--input))',
        ring: 'hsl(var(--ring))',
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        primary: { DEFAULT: 'hsl(var(--primary))', foreground: 'hsl(var(--primary-foreground))' },
        secondary: { DEFAULT: 'hsl(var(--secondary))', foreground: 'hsl(var(--secondary-foreground))' },
        accent: { DEFAULT: 'hsl(var(--accent))', foreground: 'hsl(var(--accent-foreground))' },
        muted: { DEFAULT: 'hsl(var(--muted))', foreground: 'hsl(var(--muted-foreground))' },
        destructive: { DEFAULT: 'hsl(var(--destructive))', foreground: 'hsl(var(--destructive-foreground))' },
        card: { DEFAULT: 'hsl(var(--card))', foreground: 'hsl(var(--card-foreground))' },
        popover: { DEFAULT: 'hsl(var(--popover))', foreground: 'hsl(var(--popover-foreground))' },
        // Starbucks-inspired brand greens + reserved gold
        forest: '#006241',   // Starbucks Green — headings
        leaf: '#00754A',     // Green Accent — CTA
        house: '#1E3932',    // House Green — dark bands / footer
        uplift: '#2b5148',   // Green Uplift — decorative
        harvest: '#cba258',  // Gold — reserved accent
        cream: '#f2f0eb',    // Neutral Warm canvas
        ceramic: '#edebe9',
        sky: '#00754A',      // legacy alias -> green accent
        'gcs-primary': '#005bb3',
        'gcs-secondary': '#656100',
        'gcs-secondary-fixed': '#fbef00',
        'gcs-on-secondary-fixed': '#1e1c00',
        'gcs-surface': '#f7f9fb',
        'gcs-on-surface': '#191c1e',
        'gcs-muted': '#414754',
        'gcs-outline': '#c0c6d6',
        'gcs-error': '#ba1a1a',
        'gcs-bg': '#e2e8f0',
      },
      fontFamily: {
        sans: ['Inter Variable', 'Inter', 'Helvetica Neue', 'Helvetica', 'Arial', 'sans-serif'],
        headline: ['Anton', 'Anton Fallback', 'sans-serif'],
        data: ['Oswald', 'Oswald Fallback', 'sans-serif'],
        technical: ['JetBrains Mono', 'JetBrains Mono Fallback', 'monospace'],
        body: ['Oswald', 'Oswald Fallback', 'sans-serif'],
      },
      borderRadius: {
        lg: 'var(--radius)',
        md: 'calc(var(--radius) - 4px)',
        sm: 'calc(var(--radius) - 8px)',
      },
      boxShadow: {
        soft: '0 10px 34px rgba(20, 83, 45, 0.12)',
      },
      keyframes: {
        'fade-up': { from: { opacity: '0', transform: 'translateY(14px)' }, to: { opacity: '1', transform: 'none' } },
        sway: { '0%,100%': { transform: 'rotate(-6deg)' }, '50%': { transform: 'rotate(6deg)' } },
        drift: { '0%,100%': { transform: 'translate3d(0,0,0) scale(1)' }, '50%': { transform: 'translate3d(-3%,3%,0) scale(1.06)' } },
        rise: {
          '0%': { transform: 'translate3d(0,0,0) rotate(0)', opacity: '0' },
          '10%': { opacity: '0.7' },
          '90%': { opacity: '0.5' },
          '100%': { transform: 'translate3d(14px,-86vh,0) rotate(220deg)', opacity: '0' },
        },
        'pulse-ring': {
          '0%': { boxShadow: '0 0 0 0 rgba(34,197,94,0.5)' },
          '70%': { boxShadow: '0 0 0 8px rgba(34,197,94,0)' },
          '100%': { boxShadow: '0 0 0 0 rgba(34,197,94,0)' },
        },
      },
      animation: {
        'fade-up': 'fade-up 480ms cubic-bezier(0.16,1,0.3,1) both',
        sway: 'sway 3.6s ease-in-out infinite',
        drift: 'drift 24s ease-in-out infinite',
        rise: 'rise 9s linear infinite',
        'pulse-ring': 'pulse-ring 2s infinite',
      },
    },
  },
  plugins: [tailwindcssAnimate],
};
