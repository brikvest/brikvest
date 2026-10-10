import { defineConfig, mergeConfig } from "vite";
import config from "./vite.config";

// Isolated browser verification: serves frontend assets only, with no API proxy.
export default mergeConfig(config, defineConfig({
  server: { host: "0.0.0.0", port: 5173, strictPort: true, allowedHosts: true },
}));
