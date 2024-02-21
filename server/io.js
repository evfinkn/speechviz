import { createWriteStream, promises as fs } from "fs";

/**
 * Asynchronously writes data to a file.
 *
 * @param {string} path - The file path to write to.
 * @param {(string|Buffer)} content - The data to write to the file.
 * @param {Object} [options] - Options to pass to `fs.createWriteStream` (which is
 *    used internally). For example, to throw an error if the file already exists, you
 *    can pass `{ flags: "wx" }`.
 */
const write = (path, content, options) => {
  return new Promise((resolve, reject) => {
    // createWriteStream is used instead of writeFile for better performance
    const writeStream = createWriteStream(path, options);
    writeStream.on("error", reject);
    writeStream.on("finish", resolve);
    writeStream.write(content);
    writeStream.end();
  });
};

// ".DS_STORE" is a hidden file on mac in all folders
// ".fslckout" is a hidden file in fossil repos
const defaultExcluded = new Set([".DS_Store", ".fslckout"]);
const readdirAndFilter = async (
  path,
  excluded = [],
  { excludeDefault = true } = {},
) => {
  const files = await fs.readdir(path);
  excluded = excludeDefault
    ? new Set([...defaultExcluded, ...excluded])
    : new Set(excluded);
  return files.filter((file) => !excluded.has(file));
};

// export write and readdirAndFilter
export { write, readdirAndFilter };
export default { write, readdirAndFilter };
