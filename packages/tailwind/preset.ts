import type { Config } from "tailwindcss";

export const grainBasketPreset = {
  theme: {
    extend: {
      colors: {
        // Warm, earthy palette — wheat, jute, terracotta.
        brand: {
          50: "#fdf8ef",
          100: "#faedd4",
          200: "#f4d8a6",
          300: "#ecbd70",
          400: "#e39d42",
          500: "#d97f24",
          600: "#c0631a",
          700: "#9f4a18",
          800: "#813c1a",
          900: "#6b3218",
          950: "#3c180a",
        },
        wheat: {
          50: "#fbf8f1",
          100: "#f5eeda",
          200: "#eadcb8",
          300: "#dcc38c",
          400: "#cca55e",
          500: "#be8c41",
          600: "#a87236",
          700: "#8a582e",
          800: "#71472c",
          900: "#5e3b28",
        },
      },
      fontFamily: {
        sans: ["var(--font-sans)", "system-ui", "sans-serif"],
        devanagari: ["var(--font-devanagari)", "var(--font-sans)", "sans-serif"],
      },
      borderRadius: {
        card: "0.875rem",
      },
    },
  },
} satisfies Config;
