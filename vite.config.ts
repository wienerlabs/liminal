import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { nodePolyfills } from "vite-plugin-node-polyfills";
import wasm from "vite-plugin-wasm";
import topLevelAwait from "vite-plugin-top-level-await";

// LIMINAL — Vite config.
//
// Solana stack özel gereksinimler:
// 1. `vite-plugin-node-polyfills` — web3.js Buffer/crypto/stream/process
//    polyfill'leri browser için.
// 2. `vite-plugin-wasm` — Kamino SDK v7 ve @solana/kit dependency ağacı
//    WASM modülü içerir (cryptographic primitives). Vite default ESM WASM
//    integration proposal'ı desteklemiyor, bu plugin gerekli.
// 3. `vite-plugin-top-level-await` — WASM modülleri genelde top-level
//    await kullanır; bu plugin ES2022 altı target'lar için bunu polyfill'ler.
//
// Target ES2022: top-level await ve BigInt literals native destekli.
export default defineConfig({
  plugins: [
    react(),
    wasm(),
    topLevelAwait(),
    nodePolyfills({
      include: ["buffer", "crypto", "stream", "util", "process"],
      globals: {
        Buffer: true,
        global: true,
        process: true,
      },
    }),
  ],
  server: {
    port: 5173,
    host: true,
  },
  build: {
    target: "es2022",
    sourcemap: true,
  },
  optimizeDeps: {
    esbuildOptions: {
      target: "es2022",
    },
  },
});
