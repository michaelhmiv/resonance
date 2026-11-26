/**
 * Type declarations for optional native modules not installed in this build.
 * (`onnxruntime-react-native` is installed and provides its own types.)
 */

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
