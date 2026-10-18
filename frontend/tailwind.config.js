/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        page: "#0a101c",
        surface: "#0f1726",
        raised: "#152035",
        line: "#22304a",
        ink: { DEFAULT: "#f0efec", 2: "#c3c2b7", muted: "#8c8a84" },
        accent: { DEFAULT: "#2ee6a6", cyan: "#3fd0e8" },
        series: { solar: "#c98500", wind: "#3987e5", thermal: "#d95926", battery: "#199e70" },
        status: { good: "#0ca30c", warning: "#fab219", serious: "#ec835a", critical: "#d03b3b" },
      },
      fontFamily: {
        sans: ["Inter", "system-ui", "-apple-system", "Segoe UI", "sans-serif"],
        mono: ["JetBrains Mono", "ui-monospace", "SFMono-Regular", "monospace"],
      },
    },
  },
  plugins: [],
};
