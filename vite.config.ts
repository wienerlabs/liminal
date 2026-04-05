import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { nodePolyfills } from "vite-plugin-node-polyfills";

// LIMINAL — Vite config.
// Solana web3.js ve Kamino SDK Buffer/crypto/stream gibi Node polyfill'leri
// gerektirir. `vite-plugin-node-polyfills` bunları otomatik ekler.
export default defineConfig({
  plugins: [
    react(),
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
