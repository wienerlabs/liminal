import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { nodePolyfills } from "vite-plugin-node-polyfills";
import wasm from "vite-plugin-wasm";
import topLevelAwait from "vite-plugin-top-level-await";
import path from "node:path";
import { fileURLToPath } from "node:url";

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
// 4. `resolve.alias` için `@kamino-finance/kliquidity-sdk` — klend-sdk'nın
//    transitive CLMM rebalancer'ı Orca Whirlpools WASM + top-level await
//    içeriyor ve Vite'ın CJS-require-ESM zincirini kıramıyor. Yalnızca
//    3 utility kullanıldığı için shim'e yönlendiriyoruz.
//
// Target ES2022: top-level await ve BigInt literals native destekli.

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

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
  resolve: {
    alias: [
      // Redirect the kliquidity-sdk root to a tiny shim that exposes only
      // the helpers klend-sdk actually imports (batchFetch / chunks /
      // aprToApy). Every other symbol throws an explicit "not implemented"
      // error so we notice regressions instead of silent undefined calls.
      {
        find: /^@kamino-finance\/kliquidity-sdk$/,
        replacement: path.resolve(__dirname, "src/stubs/kliquidity-shim.ts"),
      },
      // CreationParameters — the only sub-path import klend-sdk reaches
      // into. Not used on our read paths; stub it the same way.
      {
        find: /^@kamino-finance\/kliquidity-sdk\/.*$/,
        replacement: path.resolve(__dirname, "src/stubs/kliquidity-shim.ts"),
      },
    ],
  },
  server: {
    port: 5173,
    host: true,
  },
  build: {
    target: "es2022",
    sourcemap: true,
    chunkSizeWarningLimit: 800,
    commonjsOptions: {
      transformMixedEsModules: true,
    },
    rollupOptions: {
      output: {
        manualChunks(id: string): string | undefined {
          if (!id.includes("node_modules")) return undefined;
          if (id.includes("recharts") || /[\\/]d3-/.test(id)) {
            return "vendor-recharts";
          }
          if (id.includes("canvas-confetti")) {
            return "vendor-confetti";
          }
          if (id.includes("@kamino-finance") || id.includes("@orca-so")) {
            return "vendor-kamino";
          }
          return undefined;
        },
      },
    },
  },
  optimizeDeps: {
    include: [
      "@kamino-finance/klend-sdk",
      "@kamino-finance/scope-sdk",
      "@solana/kit",
      "bn.js",
      "decimal.js",
    ],
    exclude: [
      // These pull in the Orca WASM bundle we've aliased around anyway.
      "@kamino-finance/kliquidity-sdk",
      "@orca-so/whirlpools-core",
    ],
    esbuildOptions: {
      target: "es2022",
      supported: {
        "top-level-await": true,
      },
    },
  },
});
