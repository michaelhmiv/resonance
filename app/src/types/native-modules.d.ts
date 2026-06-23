/**
 * Type declarations for native modules that are linked at build time
 * but not available during tsc --noEmit (no native modules installed
 * in the CI / local dev environment).
 */

declare module 'onnxruntime-react-native' {
  export interface Tensor {
    data: Float32Array | BigInt64Array;
    dims: number[];
    type: string;
  }
  export const Tensor: {
    new (type: string, data: BigInt64Array, dims: number[]): Tensor;
  };
  export interface InferenceSession {
    inputNames: string[];
    outputNames: string[];
    run(
      feeds: Record<string, unknown>,
      outputs: string[]
    ): Promise<Record<string, Tensor>>;
    release(): void;
  }
  export const InferenceSession: {
    create(path: string): Promise<InferenceSession>;
  };
}

declare module 'llama.rn' {
  export interface LlamaModel {
    release(): void;
  }
  export const LlamaModel: {
    create(config: {
      model: string;
      n_ctx: number;
      n_gpu_layers: number;
      n_threads: number;
    }): Promise<LlamaModel>;
  };
  export interface LlamaContext {
    completion(args: {
      prompt: string;
      max_tokens: number;
    }): Promise<{ text: string }>;
    stop(): void;
    close(): void;
  }
  export const LlamaContext: {
    create(
      model: LlamaModel,
      config: {
        n_ctx: number;
        temperature: number;
        top_p: number;
        top_k: number;
      }
    ): Promise<LlamaContext>;
  };
}
