const path = require('path');

module.exports = {
  mode: 'development',
  entry: './src/index.js',
  stats: 'errors-only',
  output: {
    filename: 'main.js',
    path: path.resolve(__dirname, 'public/js'),
  },
};
