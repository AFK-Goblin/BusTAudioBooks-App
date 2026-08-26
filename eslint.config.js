const expoConfig = require("eslint-config-expo/flat");
const { defineConfig } = require("eslint/config");

module.exports = defineConfig([
  expoConfig,
  {
    ignores: ["dist/**", "dist-check/**", ".tmp-export-*/**", ".worktrees/**"],
  },
  {
    files: ["**/*.js", "**/*.jsx"],
    rules: {
      "import/namespace": "warn",
      "react/no-unescaped-entities": "warn",
      "react-hooks/globals": "warn",
      "react-hooks/purity": "warn",
      "react-hooks/refs": "warn",
      "react-hooks/set-state-in-effect": "warn",
    },
  },
  {
    files: ["jest.setup.js", "**/__tests__/**/*"],
    languageOptions: {
      globals: {
        jest: "readonly",
        describe: "readonly",
        it: "readonly",
        expect: "readonly",
      },
    },
  },
]);
