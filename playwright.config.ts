import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./tests/browser",
  webServer: {
    command: "pnpm --filter @coago/web dev",
    url: "http://localhost:5173",
    reuseExistingServer: !process.env.CI,
  },
  use: { baseURL: "http://localhost:5173" },
  projects: [
    { name: "desktop", use: { viewport: { width: 1440, height: 900 } } },
    { name: "mobile", use: { viewport: { width: 390, height: 844 } } },
  ],
});
