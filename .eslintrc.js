// I left the keys in quotes so that it's easier to move this to JSON if we wanted to
module.exports = {
  extends: ["eslint:recommended", "prettier"],
  parserOptions: {
    ecmaVersion: "latest",
    sourceType: "module",
  },
  env: {
    browser: true,
    node: true,
    es6: true,
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
};
