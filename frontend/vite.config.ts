
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

const apiTarget = process.env.VITE_API_TARGET ?? "http://127.0.0.1:8000";

export default defineConfig({
  plugins: [react()],
  server: { host: true, port: 5173, proxy: { "/api": { target: apiTarget, changeOrigin: true } } },
  test: { environment: "jsdom", setupFiles: ["./src/test/setup.ts"], globals: true },
});
