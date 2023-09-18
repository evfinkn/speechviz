import fs from "fs/promises";
import path from "path";
import url from "url";

const serverDir = path.dirname(url.fileURLToPath(import.meta.url));
const speechvizDir = path.join(serverDir, "../");
// dataDir may be a symlink, so we need to resolve it
const dataDir = await fs.realpath(path.join(speechvizDir, "data"));

export { speechvizDir, dataDir };
export default {
  speechvizDir,
  dataDir,
};
