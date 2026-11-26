/**
 * Expo config plugin to make `onnxruntime-react-native@1.24.x` build & autolink
 * cleanly on Expo SDK 56 / React Native 0.85 / Gradle 9 (Android + iOS):
 *
 *   1. Removes `onnxruntime-react-native/unimodule.json` (microsoft/onnxruntime#29004):
 *      `expo-modules-autolinking` misclassifies packages with `unimodule.json` as
 *      legacy Expo modules and excludes them from React Native community autolinking,
 *      leaving `OnnxruntimePackage` unregistered and `NativeModules.Onnxruntime === null`.
 *   2. Patches `android/build.gradle` line `VersionNumber.parse(...)` ->
 *      `REACT_NATIVE_MINOR_VERSION < 71` (Gradle 9 removed `org.gradle.util.VersionNumber`).
 *   3. Patches `OnnxruntimeModule.java` to call
 *      `getReactApplicationContext().getJSCallInvokerHolder()` directly instead of the
 *      deprecated `.getCatalystInstance().getJSCallInvokerHolder()` (RN 0.85 bridgeless).
 *   4. Appends ONNX Runtime ProGuard keep rules to `android/app/proguard-rules.pro`.
 */

const fs = require('fs');
const path = require('path');
const { withDangerousMod, withGradleProperties } = require('@expo/config-plugins');

function resolveOrtPackageRoot(projectRoot) {
  const candidates = [
    path.join(projectRoot, 'node_modules', 'onnxruntime-react-native'),
    path.resolve(projectRoot, '..', '..', 'node_modules', 'onnxruntime-react-native'),
  ];
  for (const dir of candidates) {
    if (fs.existsSync(path.join(dir, 'package.json'))) {
      return dir;
    }
  }
  try {
    return path.dirname(require.resolve('onnxruntime-react-native/package.json', {
      paths: [projectRoot, path.resolve(projectRoot, '..', '..')],
    }));
  } catch {
    return null;
  }
}

function patchOnnxRuntimePackage(projectRoot) {
  const ortRoot = resolveOrtPackageRoot(projectRoot);
  if (!ortRoot) {
    console.warn('[withOnnxRuntimeFix] onnxruntime-react-native not found; skipping patch.');
    return;
  }

  // 1. Delete unimodule.json so expo-modules-autolinking registers OnnxruntimePackage
  const unimodulePath = path.join(ortRoot, 'unimodule.json');
  if (fs.existsSync(unimodulePath)) {
    fs.unlinkSync(unimodulePath);
    console.log('[withOnnxRuntimeFix] Removed unimodule.json to enable RN autolinking.');
  }

  // 2. Patch android/build.gradle for Gradle 9 (remove VersionNumber.parse)
  const gradlePath = path.join(ortRoot, 'android', 'build.gradle');
  if (fs.existsSync(gradlePath)) {
    const src = fs.readFileSync(gradlePath, 'utf8');
    const broken = 'if (VersionNumber.parse(REACT_NATIVE_VERSION) < VersionNumber.parse("0.71"))';
    const fixed = 'if (REACT_NATIVE_MINOR_VERSION < 71)';
    if (src.includes(broken)) {
      fs.writeFileSync(gradlePath, src.replace(broken, fixed), 'utf8');
      console.log('[withOnnxRuntimeFix] Patched android/build.gradle for Gradle 9.');
    }
  }

  // 3. Patch OnnxruntimeModule.java for React Native 0.85 bridgeless mode
  const moduleJavaPath = path.join(
    ortRoot,
    'android',
    'src',
    'main',
    'java',
    'ai',
    'onnxruntime',
    'reactnative',
    'OnnxruntimeModule.java'
  );
  if (fs.existsSync(moduleJavaPath)) {
    const src = fs.readFileSync(moduleJavaPath, 'utf8');
    const oldCall = 'getReactApplicationContext().getCatalystInstance().getJSCallInvokerHolder()';
    const newCall = 'getReactApplicationContext().getJSCallInvokerHolder()';
    if (src.includes(oldCall)) {
      fs.writeFileSync(moduleJavaPath, src.replace(oldCall, newCall), 'utf8');
      console.log('[withOnnxRuntimeFix] Patched OnnxruntimeModule.java for RN bridgeless mode.');
    }
  }
}

const PROGUARD_RULES = `
# onnxruntime-react-native (added by withOnnxRuntimeFix)
-keep class ai.onnxruntime.** { *; }
-keepclasseswithmembernames class * { native <methods>; }
-keepclassmembers enum ai.onnxruntime.** { *; }
`;

module.exports = function withOnnxRuntimeFix(config) {
  // Run immediately during config evaluation so autolinking sees the patched package
  patchOnnxRuntimePackage(path.resolve(__dirname, '..'));

  // Default Android ABI to arm64-v8a so preview APKs don't bundle 4 copies of
  // React Native + Hermes + libonnxruntime.so (cuts APK ~108 MB -> ~35-40 MB).
  // Override via REACT_NATIVE_ARCHITECTURES env var if multi-ABI is needed.
  const targetAbis = process.env.REACT_NATIVE_ARCHITECTURES || 'arm64-v8a';
  config = withGradleProperties(config, (modConfig) => {
    const props = modConfig.modResults;
    const existing = props.find(
      (p) => p.type === 'property' && p.key === 'reactNativeArchitectures'
    );
    if (existing) {
      existing.value = targetAbis;
    } else {
      props.push({
        type: 'property',
        key: 'reactNativeArchitectures',
        value: targetAbis,
      });
    }
    return modConfig;
  });

  return withDangerousMod(config, [
    'android',
    async (modConfig) => {
      patchOnnxRuntimePackage(modConfig.modRequest.projectRoot);

      const proguardPath = path.join(
        modConfig.modRequest.platformProjectRoot,
        'app',
        'proguard-rules.pro'
      );
      if (fs.existsSync(proguardPath)) {
        const current = fs.readFileSync(proguardPath, 'utf8');
        if (!current.includes('-keep class ai.onnxruntime.**')) {
          fs.writeFileSync(proguardPath, `${current.trimEnd()}\n${PROGUARD_RULES}`, 'utf8');
        }
      }
      return modConfig;
    },
  ]);
};
