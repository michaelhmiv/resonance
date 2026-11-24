// Metro config for the Expo monorepo (issue #53, P1-04 + P1-03).
// Standard Expo workspace setup: watch the workspace root and resolve
// node_modules from both the app and the root, so shared packages
// (@resonance/core, /theme, /ui, /screens) bundle on native.
const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '../..');

const config = getDefaultConfig(projectRoot);

config.watchFolders = [workspaceRoot];
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
];

// P1-03: the optional on-device ML modules are not installed in Phase 1.
// Map them to an empty stub so Metro can bundle the dynamic imports in
// embeddingService.ts / reflectionService.ts; callers already degrade
// gracefully when the native module is absent.
const nativeModuleStub = path.resolve(
  projectRoot,
  'src/embedding/nativeModuleStub.ts'
);
config.resolver.extraNodeModules = {
  ...(config.resolver.extraNodeModules || {}),
  'onnxruntime-react-native': nativeModuleStub,
  'llama.rn': nativeModuleStub,
};

module.exports = config;
