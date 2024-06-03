import path from "path";

import { speechvizDir } from "./server/globals.js";

export default {
  mode: "development",
  entry: {
    init: "./src/init.js",
    index: "./src/index.js",
    vizrects: "./src/vizrects.js",
  },
  stats: "errors-only",
  output: {
    filename: "[name].js",
    path: path.join(speechvizDir, "public/js"),
  },
  experiments: {
    topLevelAwait: true,
  },
};
