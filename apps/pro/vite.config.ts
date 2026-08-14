import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: "prompt",
      injectRegister: null,
      manifest: false,
      workbox: {
        globPatterns: ["**/*.{html,js,css,svg,webmanifest}"],
        navigateFallback: "index.html",
        cleanupOutdatedCaches: true,
      },
    }),
  ],
  build: {
    sourcemap: false,
    rollupOptions: {
      output: {
        manualChunks(id) {
          const moduleId = id.replaceAll("\\", "/");
          if (/\/node_modules\/(?:\.pnpm\/)?(?:recharts|d3-|victory-vendor|@reduxjs|redux|reselect|immer)/.test(moduleId)) {
            return "charts-vendor";
          }
          if (/\/node_modules\/(?:\.pnpm\/)?(?:motion|motion-dom|motion-utils)/.test(moduleId)) {
            return "motion-vendor";
          }
          if (/\/node_modules\/(?:\.pnpm\/)?dexie/.test(moduleId)) return "storage-vendor";
          if (/\/node_modules\/(?:\.pnpm\/)?(?:react|react-dom|scheduler)/.test(moduleId)) return "react-vendor";
          if (/\/node_modules\/(?:\.pnpm\/)?react-router/.test(moduleId)) return "router-vendor";
          return undefined;
        },
      },
    },
  },
});
