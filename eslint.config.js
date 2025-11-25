import { nextJsConfig } from "@workspace/eslint-config/next-js"

/** @type {import("eslint").Linter.Config[]} */
export default [
  ...nextJsConfig,
  {
    ignores: ["**/._*"],
  },
  {
    files: ["**/*.js", "**/*.mjs", "**/*.cjs"],
    languageOptions: {
      globals: {
        __dirname: "readonly",
        global: "readonly",
        module: "readonly",
        process: "readonly",
        require: "readonly",
      },
    },
  },
  {
    files: ["**/*.js", "**/*.ts", "**/*.tsx"],
    rules: {
      "@typescript-eslint/ban-ts-comment": "off",
      "@typescript-eslint/no-base-to-string": "off",
      "@typescript-eslint/no-unnecessary-boolean-literal-compare": "off",
      "@typescript-eslint/no-unsafe-argument": "off",
      "@typescript-eslint/no-unsafe-call": "off",
      "@typescript-eslint/no-unsafe-member-access": "off",
      "@typescript-eslint/no-unsafe-return": "off",
      "@typescript-eslint/prefer-optional-chain": "off",
      "no-constant-binary-expression": "off",
      "react-hooks/exhaustive-deps": "off",
      "security/detect-non-literal-fs-filename": "off",
      "unicorn/consistent-function-scoping": "off",
      "unicorn/import-style": "off",
      "unicorn/no-null": "off",
      "unicorn/no-useless-undefined": "off",
      "unicorn/prefer-module": "off",
    },
  },
]
