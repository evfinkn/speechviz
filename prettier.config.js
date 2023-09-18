export default {
  plugins: ["@prettier/plugin-pug", "@ianvs/prettier-plugin-sort-imports"],
  importOrder: [
    "<BUILT_IN_MODULES>",
    "",
    "<THIRD_PARTY_MODULES>",
    "",
    // \.* to match /, ./, or ../ (i.e., any of our files)
    "^\\.*/(?!routes)",
    "",
    // separate ./routes so it's easier to see what's what
    "^\\.*/routes",
  ],
};
