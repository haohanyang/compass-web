const path = require('path');
const { merge } = require('@mongodb-js/webpack-config-compass');
const compassWebConfig = require('./compass/packages/compass-web/webpack.config');
const CopyPlugin = require('copy-webpack-plugin');

function resolveFromCompass(name) {
  return require.resolve(name, {
    paths: [path.resolve(__dirname, 'compass')],
  });
}
module.exports = (env, args) => {
  const config = merge(compassWebConfig(env, args), {
    context: __dirname,
    output: {
      filename: 'index.js',
    },
    entry: path.resolve(__dirname, 'src', 'index.tsx'),
    plugins: [
      new CopyPlugin({
        patterns: ['src/index.html', 'src/favicon.svg'],
      }),
    ],
    resolve: {
      alias: {
        'core-js/modules': path.resolve(
          __dirname,
          'compass',
          'node_modules',
          'core-js',
          'modules'
        ),
        'mongodb-ns': resolveFromCompass('mongodb-ns'),
        'react/jsx-runtime': resolveFromCompass('react/jsx-runtime'),
        react: resolveFromCompass('react'),
        'react-dom': resolveFromCompass('react-dom'),
        '@babel/runtime/helpers/extends': resolveFromCompass(
          '@babel/runtime/helpers/extends'
        ),
        tls: path.resolve(
          __dirname,
          'compass',
          'packages',
          'compass-web',
          'polyfills',
          'tls',
          'index.ts'
        ),
      },
    },
    performance: {
      hints: 'warning',
    },
  });

  delete config.externals;
  return config;
};
