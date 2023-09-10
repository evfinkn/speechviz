export default {
  plugins: ["@prettier/plugin-pug", "@ianvs/prettier-plugin-sort-imports"],
  importOrder: [
    "<BUILT_IN_MODULES>",
    "",
    "<THIRD_PARTY_MODULES>",
    "",
    "^\\.?/(?!routes)", // any of our files other than routes
    "",
    "^\\./routes", // separate ./routes so it's easier to see what's what
  ],
};
