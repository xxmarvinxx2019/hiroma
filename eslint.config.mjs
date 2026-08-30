import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
  {
    // These two rules were introduced across a large legacy surface. Keep
    // reporting every occurrence while avoiding behavior-changing bulk
    // rewrites of request handlers and data-fetch effects during hardening.
    // New work should still avoid adding warnings; CI can promote them once
    // each module has dedicated interaction coverage.
    rules: {
      "@typescript-eslint/no-explicit-any": "warn",
      "react-hooks/set-state-in-effect": "warn",
    },
  },
  {
    files: [
      "src/proxy.ts",
      "src/app/api/city/deposits/route.ts",
      "src/app/api/city/reports/route.ts",
      "src/app/lib/branchCash.ts",
      "src/app/lib/depositNotifications.ts",
      "src/app/lib/posOfflineQueue.ts",
    ],
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
      "react-hooks/set-state-in-effect": "error",
    },
  },
]);

export default eslintConfig;
