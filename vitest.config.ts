import { defineConfig } from "vitest/config";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * LIMINAL — Vitest config
 *
 * Keep this split from vite.config.ts: Vitest needs a much slimmer
 * environment than the dev/prod bundle, and pulling in the Kamino /
 * Orca WASM plugins would make tests flaky and slow. The shim alias
 * that keeps dev clean also keeps test runs from dragging in CLMM
 * rebalance code.
 */
export default defineConfig({
  resolve: {
    alias: [
      {
        find: /^@kamino-finance\/kliquidity-sdk(\/.*)?$/,
        replacement: path.resolve(__dirname, "src/stubs/kliquidity-shim.ts"),
      },
    ],
  },
  test: {
    environment: "happy-dom",
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    globals: false,
    reporters: "default",
  },
});
