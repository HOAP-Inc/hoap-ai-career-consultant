#!/bin/bash
# --- Environment bootstrap for Codex CI ---
npm install --legacy-peer-deps
if [ ! -f ".eslintrc.json" ]; then
  cat <<'EOC' > .eslintrc.json
{
  "extends": ["next", "next/core-web-vitals"],
  "env": {
    "browser": true,
    "es2021": true,
    "node": true
  },
  "rules": {
    "no-unused-vars": ["error", { "argsIgnorePattern": "^_" }],
    "no-undef": "error",
    "semi": ["error", "always"]
  }
}
EOC
fi
if [ ! -f "jest.config.js" ]; then
  echo 'module.exports = { testEnvironment: "node" }' > jest.config.js
fi
npm run lint -- --no-error-on-unmatched-pattern || true
