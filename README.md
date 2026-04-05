# LIMINAL

**Intelligent execution terminal on Solana.** LIMINAL slices large or time-sensitive token swaps into TWAP chunks, parks idle capital in Kamino to earn real yield during the window, routes each slice through DFlow for MEV-protected execution with measurable price improvement, and exposes the entire flow through a Solflare-native UX with live analytics.

Every slice earns value on two axes at once — DFlow price improvement and Kamino yield — and LIMINAL surfaces both in real time.

---

## What it does

A standard swap aggregator asks: _"What's the best price right now?"_
LIMINAL asks: _"What's the best price over the next N minutes, and how do we earn on the idle capital while we wait?"_

For every execution you configure:

1. **Deposit** — the full input amount is deposited into the optimal Kamino lending vault (selected automatically by highest APY).
2. **TWAP monitoring** — the machine waits through each slice's target time, polling live Pyth prices.
3. **Batched slice execution** — at each slice the Kamino withdraw and DFlow swap are packed into a **single versioned transaction** (atomic, one signature), with mandatory pre-broadcast simulation.
4. **Final withdraw** — any residual + accumulated Kamino yield is returned to your wallet.
5. **Analytics** — every slice's price improvement (bps + USD), yield contribution, and completion time is captured for the live panel and saved to history.

A 4-slice execution takes **6 signatures total** (1 deposit + 4 batched slices + 1 final withdraw) instead of 10 — the batching utility halves transaction count versus naive sequential withdraw→swap pairs.

---

## Partner integrations

| Partner | Role | Integration depth |
|---|---|---|
| **Solflare** | The single user touchpoint | Wallet adapter, session persistence, in-app browser auto-connect, pre-broadcast simulation, mobile signing delay, transaction batching UX |
| **Quicknode** | Data + confirmation backbone | Solana mainnet RPC, Pyth price feed polling (5s), transaction confirmation, `confirmed` commitment everywhere |
| **Kamino** | Idle capital yield | Lending vault auto-selection (never CLMM to avoid IL), deposit / partial withdraw / final withdraw lifecycle woven into the state machine |
| **DFlow** | MEV-protected execution engine | Quote comparison (market baseline vs DFlow endorsed quote), real price improvement bps, slippage defer discipline, no Jupiter fallback |

---

## Architecture

```
src/
├── App.tsx                         Root layout (desktop / tablet / mobile)
├── main.tsx                        React entry
├── styles/
│   └── design-system.css           Single source of truth (colors, fonts, strokes)
├── services/
│   ├── solflare.ts                 Wallet adapter + session + signing
│   ├── quicknode.ts                RPC + Pyth + price polling
│   ├── kamino.ts                   Lending vault integration (see Notes)
│   ├── dflow.ts                    Quote + swap + TWAP slice math
│   └── analyticsStore.ts           localStorage history (FIFO 50)
├── state/
│   ├── executionMachine.ts         TWAP state machine (IDLE → DONE)
│   └── analyticsNav.ts             Cross-component tab pub/sub
├── utils/
│   ├── transactionBatcher.ts       Kamino + DFlow batch into 1 versioned tx
│   └── errorHandler.ts             parseError — every catch block routes here
├── hooks/
│   ├── useExecutionMachine.ts      Module-singleton store + actions
│   ├── useKaminoPosition.ts
│   ├── useDFlowExecution.ts
│   ├── usePriceMonitor.ts
│   └── useDeviceDetection.ts
└── components/
    ├── WalletPanel.tsx             Left panel: balances + history
    ├── ExecutionPanel.tsx          Middle panel: config + live timeline
    ├── AnalyticsPanel.tsx          Right panel: live / history / protocol
    ├── VaultPreview.tsx
    ├── QuoteComparison.tsx
    ├── ExecutionTimeline.tsx
    ├── ExecutionSummaryCard.tsx
    └── ErrorCard.tsx
```

### The state machine

`executionMachine.ts` is the brain. It moves through:

```
IDLE → CONFIGURED → DEPOSITING → ACTIVE
                      ↑            ↓
                      └── SLICE_WITHDRAWING → SLICE_EXECUTING (loop)
                                   ↓
                                COMPLETING → DONE
                                   ↓
                                 ERROR (recoverable via retry)
```

Pure transitions (`configure`, `reset`) compute new state; async effects (`depositEffect`, `executeNextSlice`, `completeEffect`, `retryEffect`) run RPC work and call setState. Cancellation is cooperative — every yield point re-reads status from a module-level ref. Recovery is automatic: state serializes to localStorage on each transition, and on page reload an in-flight execution surfaces a banner.

### Design system

`src/styles/design-system.css` owns every color and typography value. Components reference `var(--color-*)` strings only; no hardcoded hex anywhere outside that file. The palette is a five-stop pastel blue (`#edf2fa → #abc4ff`), the single exception being `--color-warn` (`#f59e0b`) for warning and error states. The font stack is Bricolage Grotesque (Google Fonts, variable axis 12..96 opsz + 200..800 wght) with a monospace fallback for transaction signatures and wallet addresses.

---

## Getting started

### Requirements

- Node.js 18+
- npm 9+
- A Quicknode Solana Mainnet endpoint (free tier is enough)
- A Solflare wallet with some SOL for gas

### Install and run

```bash
git clone https://github.com/wienerlabs/liminal.git
cd liminal
npm install
npm run dev
```

The Vite dev server boots at `http://localhost:5173/`. Open it in any browser with the Solflare extension installed, or in the Solflare mobile in-app browser (auto-connects without a prompt).

### Configuration

Before the app can talk to Solana mainnet, fill in your RPC endpoint:

```ts
// src/services/quicknode.ts
export const QUICKNODE_RPC_ENDPOINT = "https://your-endpoint.solana-mainnet.quiknode.pro/...";
```

The file prints a clear `console.error` on boot and every RPC call throws a descriptive error until this constant is filled — no silent failures.

### Build

```bash
npm run build     # tsc --noEmit && vite build
npm run preview   # serve the production build locally
npm run typecheck # tsc --noEmit only
```

---

## How an execution flows

1. **Connect** Solflare from the left panel. Your SOL + SPL balances populate with live USD values from Pyth.
2. **Pick a token pair** in the middle panel. The live price starts streaming from Pyth every 5 seconds.
3. **Enter an amount**, pick a window (30m / 1h / 2h / 4h), choose a slice count, set a slippage threshold (10–300 bps).
4. The middle panel tells you exactly how many transactions you'll sign (`1 + sliceCount + 1`). This is the batching discipline at work.
5. **Click `START EXECUTION`.** Solflare opens. Approve the Kamino deposit. The state machine transitions to `ACTIVE` and the TWAP loop starts.
6. Each slice waits until its target time, then fetches a DFlow quote, batches the Kamino withdraw and DFlow swap into one transaction, simulates it, asks Solflare to sign, broadcasts, and confirms. The timeline on the right updates as each slice completes with bps earned, USD value, and elapsed time.
7. When the last slice is done, the final withdraw pulls the residual and accumulated yield out of Kamino. The panel switches to `ExecutionSummaryCard`, confetti fires, the session is saved to localStorage history, and the analytics panel aggregates it into the Protocol tab.

At any point during an `ACTIVE` execution you can close the tab — a `beforeunload` warning fires — and the next time you load the app it asks whether to resume.

---

## Error handling discipline

Every catch block in the state machine, services, and hooks routes through `parseError(err, sliceIndex?, phase?)` in `src/utils/errorHandler.ts`. It pattern-matches against Solana RPC errors, Solflare rejections, DFlow quote failures, Kamino liquidity issues, and batch simulation errors, producing a normalized `ExecutionError` with:

- A stable `ErrorCode` enum value
- A user-facing English message
- A `retryable` boolean
- Optional `sliceIndex` and timestamp

`ErrorCard.tsx` renders it: warning triangle for retryable, red X for non-retryable. The retry button re-enters the correct effect (`retryEffect` routes by code). For `KAMINO_INSUFFICIENT_LIQUIDITY` and `KAMINO_WITHDRAW_FAILED` a small reassurance note appears — "your funds in Kamino are safe; manual withdrawal may be required."

Slippage excess is deliberately _not_ an error. The machine defers the slice 30 seconds, surfaces an inline amber banner, and continues. Only a quote fetch that hard-fails (network, endpoint down) escalates to ERROR state.

---

## Responsive layout

Three breakpoints driven by `useDeviceDetection`:

- **Desktop ≥1024** — three panels side by side (280px / flex / 320px).
- **Tablet 768–1023** — execution + analytics 50/50, wallet panel hidden (still accessible when you connect).
- **Mobile <768** — single column, bottom tab bar (`Wallet / Execute / Analytics`), and a fixed-top `Execution active` bar during any in-flight status. Solflare's mobile in-app browser is detected by matching `navigator.userAgent` against `/solflare/i` **and** checking `window.solflare.isSolflare === true`, at which point the wallet auto-connects without a prompt.

---

## Technology

| Area | Stack |
|---|---|
| Runtime | React 18, Vite 5, TypeScript 5 |
| Solana | `@solana/web3.js`, `@pythnetwork/client`, `@kamino-finance/klend-sdk` |
| DFlow | HTTP client against `https://pond.dflow.net` |
| Charts | recharts |
| Animation | canvas-confetti |
| Polyfills | `vite-plugin-node-polyfills` (Buffer/crypto/stream) + `vite-plugin-wasm` + `vite-plugin-top-level-await` |
| Fonts | Bricolage Grotesque via Google Fonts |

---

## Known limitations

1. **Kamino SDK v7 incompatibility.** `@kamino-finance/klend-sdk` v7 moved to the `@solana/kit` Address + Rpc types and ships as CJS, which Vite cannot resolve as ESM at runtime. To keep the dev server booting and all other flows working, `src/services/kamino.ts` is a public-API-preserving stub: read paths (`getAvailableVaults`, `getPositionValue`) return empty data, write paths (`deposit`, `partialWithdraw`, `finalWithdraw`) throw a clear `Kamino SDK v7 refactor pending` error. Solflare, Quicknode, Pyth, DFlow, the state machine, analytics, error handling, recovery, and the full responsive UI all work against live infrastructure. Fix path: downgrade klend-sdk to v6.x **or** rewrite `kamino.ts` against the v7 API.

2. **Quicknode endpoint must be filled in.** Empty by default; a clear `console.error` fires on module load and every RPC call throws a descriptive message until you paste your HTTP provider URL.

3. **USDC mint address.** The original project spec listed a USDC mint that does not round-trip through Solana's base58 decoder. The constant is stored as a string in `kamino.ts` to avoid crashing on boot; replace it with the canonical mainnet USDC mint before any real trade.

4. **DFlow REST paths.** `/api/quote` and `/api/swap` are reasonable assumptions based on common aggregator conventions. Verify against the current DFlow endorsement server contract before a production run; changes are isolated to two constants at the top of `src/services/dflow.ts`.

---

## License

See [`LICENSE`](./LICENSE).
