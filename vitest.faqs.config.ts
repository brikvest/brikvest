import { defineConfig } from "vitest/config";
import config from "./vitest.footer-socials.config";

export default defineConfig({
  ...config,
  test: {
    ...config.test,
    include: ["tests/faqs.test.tsx", "tests/footer-socials.test.tsx", "tests/developer-navigation-ui.test.ts"],
  },
});
