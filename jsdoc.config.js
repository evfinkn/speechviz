module.exports = {
  plugins: [
    "node_modules/jsdoc/plugins/markdown",
    // "node_modules/jsdoc/plugins/summarize",
  ],
  source: {
    include: ["src"],
    includePattern: ".js$",
  },
  opts: {
    destination: "docs/js/",
    encoding: "utf8",
    readme: "README.md",
    verbose: true,
  },
  templates: {
    search: true,
    "better-docs": {
      name: "Speechviz Documentation",
      title: "Speechviz Documentation",
      navLinks: [
        {
          label: "GitLab",
          href: "https://research-git.uiowa.edu/uiowa-audiology-reu-2022/speechviz",
        },
      ],
    },
  },
};
