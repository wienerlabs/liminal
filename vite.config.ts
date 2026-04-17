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
//
// Manual chunking:
// - react vendor       → React + ReactDOM (kararlı, uzun cache).
// - recharts vendor    → recharts + d3 alt-deps (büyük, sadece Analytics).
// - confetti vendor    → canvas-confetti (sadece DONE state'te).
// - solana vendor      → @solana/web3.js + spl-token + Kamino SDK (kritik).
// Bu paylaşım initial bundle'ı yarıya indirir; recharts ve confetti lazy
// path'lere taşındığında ek azalma elde edilir.
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
    chunkSizeWarningLimit: 800,
    rollupOptions: {
      output: {
        manualChunks(id: string): string | undefined {
          if (!id.includes("node_modules")) return undefined;
          // Sadece bağımsız ağaçları ayır; React'i kendi chunk'ında izole
          // etmiyoruz çünkü Solana wallet adapter React'a depend ediyor ve
          // bu cross-chunk circular dependency'ye yol açar.
          if (id.includes("recharts") || /[\\/]d3-/.test(id)) {
            return "vendor-recharts";
          }
          if (id.includes("canvas-confetti")) {
            return "vendor-confetti";
          }
          return undefined; // geri kalanı default vendor chunk'ında bırak
        },
      },
    },
  },
  optimizeDeps: {
    esbuildOptions: {
      target: "es2022",
    },
  },
});
