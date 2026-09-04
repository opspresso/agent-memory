import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const architectureBoundaries = {
  files: ["src/**/*.{ts,tsx}"],
  rules: {
    "import/no-restricted-paths": [
      "error",
      {
        zones: [
          {
            target: "./src/domain",
            from: [
              "./src/application",
              "./src/infrastructure",
              "./src/app",
              "./src/lib"
            ],
            message: "domain must not depend on outer layers"
          },
          {
            target: "./src/application",
            from: ["./src/infrastructure", "./src/app", "./src/lib"],
            message: "application may only depend on domain"
          },
          {
            target: "./src/infrastructure",
            from: ["./src/application", "./src/app", "./src/lib"],
            message: "infrastructure may only implement domain ports"
          },
          {
            target: "./src/app",
            from: ["./src/infrastructure"],
            message: "app must use bound application use cases"
          }
        ]
      }
    ]
  }
};

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  architectureBoundaries,
  globalIgnores([
    ".next/**",
    ".next-e2e/**",
    "coverage/**",
    "drizzle/**",
    "out/**",
    "build/**",
    "playwright-report/**",
    "test-results/**",
    "next-env.d.ts"
  ])
]);

export default eslintConfig;
