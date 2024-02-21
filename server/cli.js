import url from "url";

// From https://stackoverflow.com/a/63193714
/**
 * Checks if a module is the "main" module launched with the node process.
 * This means that the module was directly invoked by `node` from the command line
 * (e.g. `$ node main.js`), as opposed to being imported by another module.
 *
 * @example
 * // main.js
 * import lib from "./lib.js"
 * import { isMain } from "./cli.js"
 * if (isMain(import.meta.url)) {
 *   console.log("I print to stdout.")
 * }
 *
 * // lib.js
 * import { isMain } from "./cli.js"
 * if (isMain(import.meta.url)) {
 *   console.log("I don't run because I'm an imported module.")
 * }
 *
 * @param {(string|URL)} moduleUrl - The URL of the module to check. It should be
 *    `import.meta.url`.
 * @returns {boolean} Whether the module is the main module.
 */
export function isMain(moduleUrl) {
  const modulePath = url.fileURLToPath(moduleUrl);
  // "node" is first in argv, path to main script is second
  return modulePath === process.argv[1];
}
