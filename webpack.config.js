const path = require('path');
const { execSync } = require('child_process');
const { webpack, merge } = require('./compass/configs/webpack-config-compass');
const compassWebConfig = require('./compass/packages/compass-web/webpack.config');
const CopyPlugin = require('copy-webpack-plugin');
const TsconfigPathsPlugin = require('tsconfig-paths-webpack-plugin');

const isProduction = process.env.NODE_ENV === 'production';

/** @type {Array<string>} */
const monorepoWorkspaces = JSON.parse(
  execSync('npx lerna list --all --json', {
    encoding: 'utf-8',
    stdio: ['ignore', 'pipe', 'ignore'],
    cwd: path.resolve(__dirname, 'compass'),
  })
).map((ws) => ws.name);

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
        '@mongodb-js/compass-data-modeling/web': resolveFromCompass(
          '@mongodb-js/compass-data-modeling/web'
        ),
        'compass-preferences-model/provider': resolveFromCompass(
          'compass-preferences-model/provider'
        ),
        './coordinates-minichart.css': path.resolve(
          __dirname,
          'compass/packages/compass-schema/src/components/coordinates-minichart/coordinates-minichart.css'
        ),
        'marker-popup.module.less': path.resolve(
          __dirname,
          'compass/packages/compass-schema/src/components/coordinates-minichart/marker-popup.module.less'
        ),
        'ag-grid-dist.css': path.resolve(
          __dirname,
          'compass/packages/compass-crud/src/components/table-view/ag-grid-dist.css'
        ),
        'document-table-view.less': path.resolve(
          __dirname,
          'compass/packages/compass-crud/src/components/table-view/document-table-view.less'
        ),
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
      },
      plugins: [
        {
          apply: (resolver) => {
            resolver
              .getHook('resolve')
              .tapAsync(
                'ResolveCompassModulesPlugin',
                (request, context, callback) => {
                  if (
                    request.request.startsWith('@mongodb-js/') &&
                    request.request.endsWith('/provider')
                  ) {
                    return callback(null, {
                      ...request,
                      path: resolveFromCompass(request.request),
                    });
                  }

                  if (monorepoWorkspaces.includes(request.request)) {
                    console.log('Resolving workspace:', request.request);
                    return callback(null, {
                      ...request,
                      path: resolveFromCompass(request.request),
                    });
                  }

                  callback();
                }
              );
          },
        },
      ],
    },
    performance: {
      hints: 'warning',
    },
  });
};
