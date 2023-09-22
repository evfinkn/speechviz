import fs from "fs/promises";
import path from "path";
import process from "process";
import url from "url";

const serverDir = path.dirname(url.fileURLToPath(import.meta.url));
const speechvizDir = path.join(serverDir, "../");
// dataDir may be a symlink, so we need to resolve it
const dataDir = await fs.realpath(path.join(speechvizDir, "data"));
// platform is "win32" even on 64-bit Windows
const isWindows = process.platform === "win32";

export { speechvizDir, dataDir, isWindows };
export default {
  speechvizDir,
  dataDir,
  isWindows,
};
