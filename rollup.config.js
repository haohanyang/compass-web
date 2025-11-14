const path = require('path');
const alias = require('@rollup/plugin-alias');
const json = require('@rollup/plugin-json');
const commonjs = require('@rollup/plugin-commonjs');
const { dependencies } = require('./package.json');

const isProduction = process.env.NODE_ENV === 'production';

/** @type {import('rollup').RollupOptions} */
const options = {
  input: './src/server.js',
  output: {
    format: 'cjs',
    file: './dist/server.js',
  },
  external: [
    ...require('module').builtinModules,
    ...Object.keys(dependencies),
    'yargs/helpers',
    'mongodb/lib/connection_string',
    'mongodb/lib/utils',
    'stream-json/Parser',
    'stream-json/streamers/StreamValues',
    'stream-json/streamers/StreamArray',
    'openai',
    'openai/helpers/zod',
    'lowdb',
    'lowdb/node',
  ],
  plugins: [
    json(),
    commonjs(),
    alias({
      entries: [
        {
          find: 'compass-preferences-model/provider',
          replacement: path.resolve(
            __dirname,
            'vendors/compass-preferences-model-provider'
          ),
        },
        {
          find: 'debug',
          replacement: path.resolve(
            __dirname,
            isProduction ? 'vendors/debug' : 'vendors/debug-dev'
          ),
        },
        {
          find: 'mongodb-ns',
          replacement: path.resolve(__dirname, 'vendors/mongodb-ns'),
        },
        {
          find: 'hadron-document',
          replacement: path.resolve(__dirname, 'vendors/hadron-document'),
        },
        {
          find: 'bson',
          replacement: path.resolve(__dirname, 'vendors/bson'),
        },
      ],
    }),
  ],
};

module.exports = options;
