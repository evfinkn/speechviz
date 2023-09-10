import js from "@eslint/js";
import eslintConfigPrettier from "eslint-config-prettier";
import globals from "globals";

export default [
  js.configs.recommended,
  eslintConfigPrettier,
  {
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.node,
      },
      parserOptions: {
        ecmaVersion: "latest",
        sourceType: "module",
      },
    },
    rules: {
      "max-len": ["error", { code: 88, ignoreUrls: true }],
      "prefer-const": "error",
      "spaced-comment": [
        "error",
        "always",
        {
          block: {
            balanced: true,
          },
        },
      ],
    },
  },
];
