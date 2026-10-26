import js from "@eslint/js";
import globals from "globals";
import prettier from "eslint-config-prettier/flat";

export default [
  {
    ignores: [
      "api/**",
      "frontend/**",
      "worker/**",
      "web/**",
      "node_modules/**",
      "runtime-data/**",
      "recordings/**",
      ".venv/**",
    ],
  },
  {
    ...js.configs.recommended,
    files: ["scripts/**/*.{js,mjs,cjs}", "eslint.config.mjs"],
    languageOptions: { globals: globals.node },
  },
  prettier,
];
