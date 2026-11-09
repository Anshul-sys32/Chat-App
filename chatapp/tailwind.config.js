/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        accent: {
          DEFAULT: "var(--theme-accent)",
          text: "var(--theme-accent-text)",
          deep: "var(--theme-accent-deep)",
          soft: "var(--theme-accent-soft)",
          border: "var(--theme-accent-border)",
          hover: "var(--theme-accent-hover)",
          contrast: "var(--theme-accent-contrast)",
        },
      },
    },
  },
  plugins: [],
}