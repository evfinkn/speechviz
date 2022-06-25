const path = require('path');

module.exports = {
  mode: 'development',
  entry: './src/viz.js',
  stats: 'errors-only',
  output: {
    filename: 'viz.js',
    path: path.resolve(__dirname, 'public/js'),
  },
};
