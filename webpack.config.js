const path = require('path');
const { webpack, merge } = require('@mongodb-js/webpack-config-compass');
const compassWebConfig = require('./compass/packages/compass-web/webpack.config');
const CopyPlugin = require('copy-webpack-plugin');

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
  const config = compassWebConfig(env, args);

  delete config.externals;
  delete config.resolve.alias.stream;

  config.output = {
    path: config.output.path,
    filename: config.output.filename,
    assetModuleFilename: config.output.assetModuleFilename,
  };

  return merge(config, {
    context: __dirname,
    entry: path.resolve(__dirname, 'src', 'index.tsx'),
    plugins: [
      new CopyPlugin({
        patterns: ['src/index.html', 'src/favicon.svg'],
      }),
      new webpack.DefinePlugin({
        'process.env.ENABLE_DEBUG': args.mode != 'production',
        'process.env.ENABLE_INFO': args.mode != 'production',
      }),
    ],
    devtool: args.mode == 'production' ? false : 'source-map',
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
        'fs/promises': localPolyfill('fs/promises'),
        'stream/promises': localPolyfill('stream/promises'),
        fs: localPolyfill('fs'),
        stream: localPolyfill('stream'),
      },
    },
    performance: {
      hints: 'warning',
    },
  });
};
