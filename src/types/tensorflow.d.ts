import * as tf from "@tensorflow/tfjs-node";

declare module "@tensorflow/tfjs-node" {
  namespace keras {
    namespace preprocessing {
      namespace sequence {
        function padSequences(
          sequences: number[][],
          config: {
            maxlen?: number;
            padding?: "pre" | "post";
            truncating?: "pre" | "post";
            value?: number;
          }
        ): number[][];
      }
    }
  }
}
