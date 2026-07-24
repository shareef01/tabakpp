/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        // Dynamic Accent using CSS Variables
        'accent': 'var(--accent)',
        'accent-soft': 'rgba(var(--accent-rgb), 0.12)',
        'accent-glow': 'rgba(var(--accent-rgb), 0.5)',

        // High-Fidelity Base Colors (Android Parity)
        'bg-base': '#000000', // Pure OLED Black
        'bg-panel': '#09090B', // Grounded Zinc
        'bg-card': '#0A0A0B',  // Machined Card
        'bg-control': '#141416', // Tactile Control

        'danger': '#FF1111', // Aggressive Red
        'success': '#10B981', // Emerald Standard
        'warning': '#FACC15', // Amber Alert

        'text-main': '#FFFFFF',
        'text-muted': '#A1A1AA', // Zinc-400
        'text-dim': '#52525B',   // Zinc-600

        'border-subtle': 'rgba(255,255,255,0.05)',
        'border-glass': 'rgba(255,255,255,0.08)',
      },
      fontFamily: {
        inter: ['Inter', 'sans-serif'],
      },
      borderRadius: {
        'card': '32px',
        'card-lg': '42px',
        'control': '14px',
      },
      animation: {
        'pulse-slow': 'pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite',
      }
    },
  },
  plugins: [],
}
