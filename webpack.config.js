// https://stackoverflow.com/a/50052194
// import { dirname, resolve } from 'path';
// import { fileURLToPath } from 'url';

// const __dirname = dirname(fileURLToPath(import.meta.url));
const path = require("path");

module.exports = {
  mode: "development",
  entry: {
    init: "./src/init.ts",
    index: "./src/index.ts",
    faceCluster: "./src/faceCluster.ts",
  },
  stats: "errors-only",
  output: {
    filename: "[name].js",
    path: path.resolve(__dirname, "public/js"),
  },
  // Enable sourcemaps for debugging webpack's output.
  devtool: "source-map",
  experiments: {
    topLevelAwait: true,
  },
  resolve: {
    extensions: [".ts", ".tsx", ".js"],
  },
  module: {
    rules: [
      // All files with a '.ts' or '.tsx' extension will be handled by 'ts-loader'.
      { test: /\.tsx?$/, loader: "ts-loader", exclude: /node_modules/ },
      // All output '.js' files will have any sourcemaps
      // re-processed by 'source-map-loader'.
      { enforce: "pre", test: /\.js$/, loader: "source-map-loader" },
    ],
  },
};
