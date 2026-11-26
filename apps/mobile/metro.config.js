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

// Optional LLM module (llama.rn) is not bundled; map it to an empty stub
// so Metro can bundle the dynamic import in reflectionService.ts.
// `onnxruntime-react-native` IS installed and natively linked for on-device
// Voyage-4-Nano embeddings and Qwen3-Reranker scoring.
const nativeModuleStub = path.resolve(
  projectRoot,
  'src/embedding/nativeModuleStub.ts'
);
config.resolver.extraNodeModules = {
  ...(config.resolver.extraNodeModules || {}),
  'llama.rn': nativeModuleStub,
};

module.exports = config;
