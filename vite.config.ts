// Compatibility entry point for preserved frontend-only browser configs.
// Never imports or starts the application backend.
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
import { rejectLegalTemplateSourcePaths } from "./scripts/brikvest-source-access";

export default defineConfig({
  plugins: [
    react(),
    {
      name: "brikvest-private-legal-sources",
      configureServer(server) { server.middlewares.use(rejectLegalTemplateSourcePaths); },
    },
  ],
  root: path.resolve(import.meta.dirname, "artifacts/brikvest"),
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "artifacts/brikvest/src"),
      "@shared": path.resolve(import.meta.dirname, "shared"),
      "@assets": path.resolve(import.meta.dirname, "attached_assets"),
    },
    dedupe: ["react", "react-dom"],
  },
  server: {
    allowedHosts: true,
    fs: {
      strict: true,
      allow: [path.resolve(import.meta.dirname, "artifacts/brikvest"), path.resolve(import.meta.dirname, "shared"), path.resolve(import.meta.dirname, "lib/brikvest-shared/src"), path.resolve(import.meta.dirname, "attached_assets"), path.resolve(import.meta.dirname, "node_modules")],
      deny: ["**/.*", "**/*.docx", "**/template-assets/**", "**/.migration-backup/**"],
    },
  },
});
