const path = require('path');

module.exports = {
  mode: 'development',
  entry: {
      init: './src/init.js',
      index: '/src/index.js',
      faceCluster: '/src/faceCluster.js'
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
