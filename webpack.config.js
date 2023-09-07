import path from "path";
import url from "url";

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
export default {
  mode: "development",
  entry: {
    init: "./src/init.js",
    index: "/src/index.js",
    faceCluster: "/src/faceCluster.js",
  },
  stats: "errors-only",
  output: {
    filename: "[name].js",
    path: path.resolve(__dirname, "public/js"),
  },
  experiments: {
    topLevelAwait: true,
  },
  module: {
    rules: [
      {
        // solves issue with webpack not being able
        // to resolve imports without extensions
        resolve: {
          fullySpecified: false,
        },
      },
    ],
  },
};
