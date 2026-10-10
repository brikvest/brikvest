import { defineConfig } from "vitest/config";
import config from "./vitest.legal.config";

export default defineConfig({
  ...config,
  oxc: { jsx: { runtime: "automatic" } },
  test: {
    ...config.test,
    include: ["tests/footer-socials.test.tsx", "tests/developer-navigation-ui.test.ts"],
  },
});
