const path = require('path');
const { webpack, merge } = require('./compass/configs/webpack-config-compass');
const compassWebConfig = require('./compass/packages/compass-web/webpack.config');
const CopyPlugin = require('copy-webpack-plugin');

const isProduction = process.env.NODE_ENV === 'production';

function resolveFromCompass(name) {
  return require.resolve(name, {
    paths: [path.resolve(__dirname, 'compass')],
  });
}

function localPolyfill(name) {
  return path.resolve(
    __dirname,
    'src',
    'polyfills',
    ...name.split('/'),
    'index.js'
  );
}

module.exports = (env, args) => {
  const config = compassWebConfig({}, {});

  delete config.externals;
  delete config.resolve.alias.stream;

  config.output = {
    path: config.output.path,
    filename: 'compass.js',
    assetModuleFilename: config.output.assetModuleFilename,
  };

  return merge(config, {
    mode: isProduction ? 'production' : 'development',
    context: __dirname,
    entry: path.resolve(__dirname, 'src', 'index.tsx'),
    plugins: [
      new CopyPlugin({
        patterns: ['src/index.eta', 'src/favicon.svg'],
      }),
      new webpack.DefinePlugin({
        'process.env.ENABLE_DEBUG': !isProduction,
        'process.env.ENABLE_INFO': !isProduction,
      }),
    ],
    devtool: isProduction ? false : 'source-map',
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
        'react-redux': resolveFromCompass('react-redux'),
        lodash: path.resolve(__dirname, 'compass', 'node_modules', 'lodash'),
        tls: path.resolve(
          __dirname,
          'compass',
          'packages',
          'compass-web',
          'polyfills',
          'tls',
          'index.ts'
        ),
        'fs/promises': localPolyfill('fs/promises'),
        'stream/promises': localPolyfill('stream/promises'),
        fs: localPolyfill('fs'),
        stream: resolveFromCompass('readable-stream'),
      },
      fallback: {
        '@leafygreen-ui/emotion': resolveFromCompass('@leafygreen-ui/emotion'),
        '@leafygreen-ui/palette': resolveFromCompass('@leafygreen-ui/palette'),
        '@leafygreen-ui/tokens': resolveFromCompass('@leafygreen-ui/tokens'),
        'worker-runtime': localPolyfill('worker-runtime'),
      },
    },
    performance: {
      hints: 'warning',
    },
  });
};
