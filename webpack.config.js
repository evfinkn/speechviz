const path = require('path');

module.exports = {
  mode: 'development',
  entry: {
      viz: './src/viz.js',
      index: './src/index.js'
  },
  stats: 'errors-only',
  output: {
    filename: '[name].js',
    path: path.resolve(__dirname, 'public/js'),
  },
};
