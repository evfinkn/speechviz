module.exports = {
	plugins: [
		"node_modules/jsdoc/plugins/markdown",
		// "node_modules/jsdoc/plugins/summarize",
		"node_modules/better-docs/typedef-import",
	],
	source: {
		include: ["src"],
		includePattern: "\.js$",
	},
	opts: {
		destination: "doc/",
		encoding: "utf8",
		readme: "README.md",
		template: "node_modules/better-docs",
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