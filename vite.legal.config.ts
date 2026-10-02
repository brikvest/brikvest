import { mergeConfig } from "vite";
import config from "./vite.config";

// Frontend-only browser fixtures intercept every API. Never start server/index.
export default mergeConfig(config, { server: { allowedHosts: true } });