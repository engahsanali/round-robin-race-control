import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  build: {
    sourcemap: false,
    rollupOptions: {
      output: {
        manualChunks(id) {
          const moduleId = id.replaceAll("\\", "/");
          if (moduleId.includes("/node_modules/@supabase/") || moduleId.includes("/node_modules/.pnpm/@supabase+")) return "supabase-vendor";
          if (/\/node_modules\/(?:\.pnpm\/)?(?:react|react-dom|scheduler)/u.test(moduleId)) return "react-vendor";
          return undefined;
        },
      },
    },
  },
});
