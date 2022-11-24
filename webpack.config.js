// https://stackoverflow.com/a/50052194
// import { dirname, resolve } from 'path';
// import { fileURLToPath } from 'url';

// const __dirname = dirname(fileURLToPath(import.meta.url));
const path = require('path');

module.exports = {
  mode: 'development',
  entry: {
      init: './src/init.js',
      index: '/src/index.js',
  },
  stats: 'errors-only',
  output: {
    filename: '[name].js',
    path: path.resolve(__dirname, 'public/js'),
  },
  experiments: {
    topLevelAwait: true,
  },
};
