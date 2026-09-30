const path = require('path');
const { getDefaultConfig } = require('expo/metro-config');

/** @type {import('expo/metro-config').MetroConfig} */
const config = getDefaultConfig(__dirname);

// The app lives in the Allegra monorepo but is not a root workspace: it imports
// shared code from ../../packages (the `@shared/*` path in tsconfig.json) while
// every npm package must come from THIS app's node_modules. The repo root has
// its own node_modules (the web's React, Convex); resolving into it would put
// two copies of React in the bundle — which is why packages/ code imports no npm
// packages at all (tests/infra asserts it).
const repoRoot = path.resolve(__dirname, '../..');
config.watchFolders = [...(config.watchFolders ?? []), path.join(repoRoot, 'packages')];

// Increase timeout for slower connections
config.server = {
  ...config.server,
  enhanceMiddleware: (middleware) => {
    return (req, res, next) => {
      // Increase timeout to 5 minutes for slow networks
      req.setTimeout(300000);
      res.setTimeout(300000);
      return middleware(req, res, next);
    };
  },
};

// Increase resolver timeout
config.resolver = {
  ...config.resolver,
  resolverMainFields: ['react-native', 'browser', 'main'],
  nodeModulesPaths: [path.join(__dirname, 'node_modules')],
};

module.exports = config;
