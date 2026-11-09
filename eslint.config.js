import js from "@eslint/js";
import ts from "typescript-eslint";
export default ts.config(
  {
    ignores: [
      "**/dist/**",
      "**/node_modules/**",
      "**/.wrangler/**",
      "**/migrations/**",
      "test-results/**",
      "playwright-report/**",
    ],
  },
  js.configs.recommended,
  ...ts.configs.recommended,
  {
    files: ["apps/web/**/*.{ts,tsx}", "packages/contracts/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            "@coago/db",
            "@coago/db/*",
            "**/packages/db/**",
            "**/db/**",
            "**/api/**",
            "**/apps/api/**",
            "node:*",
            "pg",
            "drizzle-orm*",
          ],
        },
      ],
    },
  },
);
