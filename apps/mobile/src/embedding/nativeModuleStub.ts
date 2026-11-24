/**
 * Metro stub for optional native ML modules (issue #53, P1-03).
 *
 * `onnxruntime-react-native` and `llama.rn` are NOT installed in Phase 1:
 * the approved architecture is cloud-first retrieval, and no on-device
 * ML ships in the bootable-APK milestone. Metro resolves string-literal
 * dynamic imports statically, so the bare imports in embeddingService.ts
 * and reflectionService.ts would fail the bundle. metro.config.js maps
 * both module names to this empty stub instead.
 *
 * Runtime behaviour is unchanged by design: every caller wraps the
 * import in try/catch and degrades gracefully (init returns false,
 * resonance features simply do not appear) when the native module is
 * absent — which is exactly the Phase 1 product state.
 */
export {};
