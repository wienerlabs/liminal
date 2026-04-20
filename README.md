# LIMINAL

**Intelligent execution terminal on Solana.** LIMINAL slices large or time-sensitive token swaps into TWAP chunks, parks idle capital in Kamino to earn real yield during the window, routes each slice through DFlow for MEV-protected execution with measurable price improvement, and exposes the entire flow through a Solflare-native UX with live analytics.

Every slice earns value on two axes at once — DFlow price improvement and Kamino yield — and LIMINAL surfaces both in real time.

---

## What it does

A standard swap aggregator asks: _"What's the best price right now?"_
LIMINAL asks: _"What's the best price over the next N minutes, and how do we earn on the idle capital while we wait?"_

For every execution you configure:

1. **Deposit** — the full input amount is deposited into the optimal Kamino lending reserve (selected automatically by highest supply APY on Kamino Main Market).
2. **TWAP monitoring** — the machine waits through each slice's target time, polling live Pyth prices every 5 seconds.
3. **Batched slice execution** — at each slice the Kamino partial withdraw and DFlow swap are packed into a **single versioned transaction** (atomic, one signature), with mandatory pre-broadcast simulation.
4. **Final withdraw** — any residual + accumulated Kamino yield is returned to your wallet.
5. **Analytics** — every slice's price improvement (bps + USD), yield contribution, and completion time is captured for the live panel and saved to localStorage history.

A 4-slice execution takes **6 signatures total** (1 deposit + 4 batched slices + 1 final withdraw) instead of 10 — the batching utility halves transaction count versus naive sequential withdraw→swap pairs.

---

## Partner integrations

| Partner | Role | Integration depth |
|---|---|---|
| **Solflare** | The single user touchpoint | Wallet adapter, session persistence, in-app browser auto-connect, pre-broadcast simulation, transaction batching UX, 2-step disconnect confirm |
| **QuickNode** | Data + confirmation backbone | Solana mainnet RPC, Pyth price feed polling (5s), transaction confirmation, `confirmed` commitment everywhere, env-driven endpoint |
| **Kamino** | Idle capital yield | `@kamino-finance/klend-sdk@7.3` with `@solana/kit` RPC bridge, `KaminoMarket.load` on Main Market, reserve APY / liquidity / utilization surfaced live, `getUserVanillaObligation` for real on-chain position tracking |
| **DFlow** | MEV-protected execution engine | Quote comparison (market baseline vs DFlow endorsed quote), real price improvement bps, slippage defer discipline, no Jupiter fallback |

---

## Design system

### Palette — pastel light theme

A four-color pastel palette drives the entire UI; every component references CSS variables, never hardcoded hex.

| Token | Hex | Role |
|---|---|---|
| `--color-1` | `#F6FFDC` — yellow | body background (widest surface) |
| `--color-2` | `#FFFFFF` — white | panel surface |
| `--color-3` | `#DAF9DE` — mint | elevated card |
| `--color-4` | `#CFECF3` — sky | hover / secondary surface |
| `--color-5` | `#F9B2D7` — pink | accent (CTA, active state, highlights) |

Body gets a subtle atmospheric gradient (pink + sky + mint blobs on the yellow base) rather than a flat fill. Text is near-black (`#1a1a1a`) for AAA contrast. Semantic colors (`#16a34a` success, `#dc2626` danger, `#d97706` warning) are tuned to pass WCAG AA on every pastel surface.

### Typography

**Space Grotesk** (Google Fonts, weights 300 / 400 / 500 / 600 / 700) for all UI copy. **JetBrains Mono** is reserved for raw code / hash / signature display via the `.liminal-code` utility class. The `--font-mono` CSS variable is also mapped to Space Grotesk so legacy inline `fontFamily: MONO` references render consistently — numeric layouts stay stable thanks to `font-variant-numeric: tabular-nums`.

### Token logos

Every wallet token resolves through a **Jupiter v2 search** lookup (`tokens.jup.ag/tokens/v2/search`) keyed by mint address. The registry handles pump.fun, verified, community, and LST tokens transparently — something the older `verified`-only list missed. Logos load lazily with automatic IPFS/Arweave URI normalization; when a logo 404s or CORS-fails, a stable HSL gradient avatar with the token's initial letter takes over. `localStorage` caches results for 24 hours.

### Type scale & spacing

8pt grid (`--space-1` through `--space-12`). Three-tier radius (`--radius-sm: 4` / `md: 8` / `lg: 12`). Type scale from `--text-xs: 13px` through `--text-3xl: 36px` — larger than the typical terminal to prioritize readability.

---

## Architecture

```
src/
├── App.tsx                         Root layout (desktop / tablet / mobile)
├── main.tsx                        React entry
├── vite-env.d.ts                   Typed import.meta.env declarations
├── styles/
│   └── design-system.css           Single source of truth — tokens, keyframes
├── services/
│   ├── solflare.ts                 Wallet adapter + session + signing
│   ├── quicknode.ts                RPC + Pyth + price polling (env-driven)
│   ├── kamino.ts                   Kamino v7 SDK via @solana/kit RPC bridge
│   ├── dflow.ts                    Quote + swap + TWAP slice math
│   ├── tokenRegistry.ts            Jupiter v2 search + localStorage 24h cache
│   └── analyticsStore.ts           localStorage history (FIFO 50)
├── state/
│   ├── executionMachine.ts         TWAP state machine (IDLE → DONE)
│   └── analyticsNav.ts             Cross-component tab pub/sub
├── utils/
│   ├── transactionBatcher.ts       Kamino + DFlow batch into 1 versioned tx
│   └── errorHandler.ts             parseError — every catch block routes here
├── hooks/
│   ├── useExecutionMachine.ts      Module-singleton store + actions
│   ├── useKaminoPosition.ts        30s polling + deposit/withdraw mutations
│   ├── useDFlowExecution.ts
│   ├── usePriceMonitor.ts
│   ├── useTokenRegistry.ts         Warm up registry for a list of mints
│   ├── useNetworkStatus.ts
│   └── useDeviceDetection.ts
└── components/
    ├── WalletPanel.tsx             Left panel: balances (logo + symbol) + history
    ├── ExecutionPanel.tsx          Middle panel: config + live timeline + CTA
    ├── AnalyticsPanel.tsx          Right panel: live hero / history / protocol
    ├── HeaderBar.tsx               Sticky brand + network + wallet badge
    ├── VaultPreview.tsx
    ├── QuoteComparison.tsx
    ├── ExecutionTimeline.tsx
    ├── ExecutionSummaryCard.tsx
    ├── ErrorCard.tsx
    ├── StepIndicator.tsx
    ├── ProgressRing.tsx
    ├── Sparkline.tsx
    ├── AnimatedNumber.tsx          Respects prefers-reduced-motion
    ├── Tooltip.tsx
    ├── Button.tsx
    ├── CountdownTimer.tsx
    └── ToastProvider.tsx           Region-role notifications with semantic icons
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

### Kamino integration

`src/services/kamino.ts` is wired against **`@kamino-finance/klend-sdk` v7.3** with the `@solana/kit` RPC client (v7 requirement). A module-level bridge turns our QuickNode HTTPS endpoint into `createSolanaRpc(...)`. Main Market is cached for 60s between reloads, and `KaminoMarket.load()` fetches every reserve with its live APY, available liquidity, and utilization ratio.

The write path (`deposit`, `partialWithdraw`, `finalWithdraw`, `buildPartialWithdrawInstructions`) is currently held at the `@solana/kit` `Instruction` → `@solana/web3.js` `VersionedTransaction` bridge — see [Roadmap](#roadmap). The read path (vault listing, optimal selection by APY, on-chain obligation tracking) is fully functional.

---

## Getting started

### Requirements

- Node.js 18+
- npm 9+
- A QuickNode Solana Mainnet endpoint (free tier is enough — 10M requests/month, 25 req/s)
- A Solflare wallet (browser extension or mobile in-app browser) with some SOL for gas

### Install and run

```bash
git clone https://github.com/wienerlabs/liminal.git
cd liminal
npm install
cp .env.example .env.local
# Edit .env.local and paste your QuickNode HTTP Provider URL
npm run dev
```

The Vite dev server boots at `http://localhost:5173/` (or `5174` if 5173 is in use). Open it in any browser with the Solflare extension installed, or in the Solflare mobile in-app browser — the wallet auto-connects without a prompt in that context.

### Environment variables

Copy [`.env.example`](./.env.example) to `.env.local` (gitignored automatically) and fill in:

```bash
# REQUIRED
VITE_QUICKNODE_RPC_URL=https://your-name.solana-mainnet.quiknode.pro/your-token/

# OPTIONAL (defaults shown)
# VITE_DFLOW_API_URL=https://pond.dflow.net
```

If `VITE_QUICKNODE_RPC_URL` is missing, the app throws a descriptive error on every RPC call — no silent failures. Typed via `src/vite-env.d.ts` for autocomplete.

### Build

```bash
npm run build     # tsc --noEmit && vite build
npm run preview   # serve the production build locally
npm run typecheck # tsc --noEmit only
```

Production bundles split across:

| Chunk | Raw | Gzip |
|---|---|---|
| `index.js` (app code) | ~450 kB | ~92 kB |
| `vendor-recharts` | 754 kB | 167 kB |
| `vendor-kamino` (klend-sdk + scope + kliquidity) | 9.2 MB | 1.4 MB |
| `vendor-confetti` | 14 kB | 5 kB |
| `index.css` | 5.7 kB | 1.94 kB |

The Kamino vendor chunk is heavy because the SDK ships a full on-chain state model. `vite.config.ts` excludes the Orca Whirlpools WASM bindings from `optimizeDeps` pre-bundling to sidestep an esbuild top-level-await conflict.

---

## How an execution flows

1. **Connect** Solflare from the left panel. SOL + SPL balances populate with Jupiter-resolved symbols, logo images, and live USD values from Pyth where feeds exist.
2. **Pick a token pair** in the middle panel. The live price starts streaming from Pyth every 5 seconds. Tokens without a Pyth feed show `no feed` instead of endless skeleton.
3. **Enter an amount**, pick a window (30m / 1h / 2h / 4h), choose a slice count, set a slippage threshold (10–300 bps).
4. If anything is missing, an amber hint beneath `START EXECUTION` tells you exactly what — wallet, token, amount, vault, etc. No silent-disable.
5. The middle panel tells you exactly how many transactions you'll sign (`1 + sliceCount + 1`) — the batching discipline at work.
6. **Click `START EXECUTION`.** Solflare opens. Approve the Kamino deposit. The state machine transitions to `ACTIVE`, the TWAP loop starts, and the step indicator lights up `Deposit → Monitor → Execute → Repeat → Withdraw` in real time.
7. Each slice waits until its target time, fetches a DFlow quote, batches the Kamino withdraw and DFlow swap into one versioned transaction, simulates it, asks Solflare to sign, broadcasts, and confirms. The timeline on the right updates each slice with bps earned, USD value, and elapsed time.
8. When the last slice completes, the final withdraw pulls residual + accumulated yield out of Kamino. The panel switches to `ExecutionSummaryCard`, confetti fires (pink / mint / sky palette), history is saved, and the analytics Protocol tab aggregates totals.

At any point during an `ACTIVE` execution you can close the tab — a `beforeunload` warning fires — and the next time you load the app it asks whether to resume.

---

## Accessibility

- **Role semantics** — `role="tablist"` + `aria-selected` on both mobile and desktop tab groups, `role="dialog"` + `aria-modal` + `aria-labelledby` on the history detail modal.
- **Focus management** — modal traps Tab, closes on Escape with `stopPropagation`, restores focus to the opener on close, locks body scroll while open.
- **Live regions** — price list is `aria-live="polite"`, toasts differentiate `polite` vs `assertive` by type, skeletons carry `aria-busy`.
- **Touch targets** — 44 px minimum on the slider thumb, mobile tabs, delete and modal-close buttons.
- **Reduced motion** — `AnimatedNumber` snaps instead of interpolating when `prefers-reduced-motion: reduce` is set. CSS animations are globally capped to 0.01 ms under the same media query.
- **Contrast** — muted text is `#5b6470` on pastel backgrounds (WCAG AA for body text). Accent pink `#F9B2D7` with near-black text passes AAA.

---

## Error handling discipline

Every catch block in the state machine, services, and hooks routes through `parseError(err, sliceIndex?, phase?)` in `src/utils/errorHandler.ts`. It pattern-matches against Solana RPC errors, Solflare rejections, DFlow quote failures, Kamino liquidity issues, and batch simulation errors, producing a normalized `ExecutionError` with:

- A stable `ErrorCode` enum value
- A user-facing English message
- A `retryable` boolean
- Optional `sliceIndex` and timestamp

`ErrorCard.tsx` renders it: warning triangle on an amber background for retryable, red ✕ on a danger background for non-retryable — distinct visual hierarchy. The retry button re-enters the correct effect (`retryEffect` routes by code). For `KAMINO_INSUFFICIENT_LIQUIDITY` and `KAMINO_WITHDRAW_FAILED` a small reassurance note appears — _"your funds in Kamino are safe; manual withdrawal may be required."_

Slippage excess is deliberately _not_ an error. The machine defers the slice 30 seconds, surfaces an inline amber banner, and continues. Only a quote fetch that hard-fails (network, endpoint down) escalates to ERROR state.

---

## Responsive layout

Three breakpoints driven by `useDeviceDetection`:

- **Desktop ≥1024** — three panels side by side (`300 / 1fr / 300`, symmetric). Header is sticky with `backdrop-filter: blur(8px)`.
- **Tablet 768–1023** — execution + analytics 50/50, wallet panel hidden (still accessible through the Connect CTA embedded in the middle panel).
- **Mobile <768** — single column, bottom tab bar (`Wallet / Execute / Analytics`) with safe-area-inset padding, and a sticky-below-header `Execution active` bar during any in-flight status. Solflare's mobile in-app browser is detected via `navigator.userAgent` + `window.solflare.isSolflare`, and wallet auto-connects without a prompt.

---

## Technology

| Area | Stack |
|---|---|
| Runtime | React 18, Vite 5, TypeScript 5 |
| Solana | `@solana/web3.js`, `@solana/kit`, `@pythnetwork/client` |
| Kamino | `@kamino-finance/klend-sdk@7.3` (`@solana/kit` RPC) |
| DFlow | HTTP client against `https://pond.dflow.net` |
| Token metadata | Jupiter v2 search API (`tokens.jup.ag/tokens/v2/search`) |
| Charts | recharts |
| Animation | canvas-confetti, CSS keyframes |
| Polyfills | `vite-plugin-node-polyfills` (Buffer/crypto/stream) + `vite-plugin-wasm` + `vite-plugin-top-level-await` |
| Fonts | Space Grotesk + JetBrains Mono via Google Fonts |

---

## Roadmap

### Constellation (Anza Multiple Concurrent Proposers)

LIMINAL is architected so MEV defense lives at two independent layers and each can be upgraded without touching the other:

1. **Routing (active today)** — every slice clears through Jupiter Ultra's RFQ pool, which includes DFlow-endorsed market-maker quotes. Fills settle against committed inventory so sandwich and backrun opportunities don't exist at the route level. See `services/dflow.ts`.

2. **Slot (Constellation-ready)** — Anza's [Constellation SIMD](https://www.anza.xyz/blog/introducing-constellation) replaces the single-leader monopoly on block construction with multiple concurrent proposers per slot. When the proposal lands on mainnet, `transactionBatcher.ts` + the Kamino/DFlow broadcast calls will add a proposer-selection hint on `sendRawTransaction` so slices land on the least-censoring proposer of the epoch. The quote/build/simulate pipeline stays unchanged.

The current strategy is driven by `VITE_MEV_PROTECTION_MODE`:

| Value | Meaning |
|---|---|
| `jupiter-ultra` (default) | Today's production path — routing-only defense |
| `jupiter-ultra+constellation` | Hybrid — both layers active once Constellation is live |
| `constellation-only` | Slot-level only (used for measurement / ablation) |

The Analytics **Protocol** tab renders a live "MEV Protection" card describing which layers are active and which are ready. A small `MEV: …` chip in the navbar surfaces the same state at a glance.

### Other improvements tracked

- **Onchain activity** — hit the BLOK 8 target (5+ wallets × 50 txs on mainnet) before the hackathon submission deadline.
- **WalletConnect deep-link** — mobile onboarding via `solflare://browse?url=liminal.app` (spec'd in BLOK 6, not yet implemented).
- **Token allowlist / rug filter** — surface a warning when the destination mint is unverified (Jupiter `isVerified` flag, Rugcheck risk score).
- **On-chain history rebuild** — today analytics history lives in `localStorage` (FIFO 50). Reconstruct past executions from wallet signatures + our program IDs so users don't lose history when switching devices.

---

## Security

- `.env.local` is gitignored via the `*.local` pattern and again explicitly via `.env*` — secrets never reach git. `.env.example` is committed as the template.
- The development-only global error trap in `index.html` is guarded to `localhost` / `127.0.0.1` / `.local` hostnames and ring-buffered to 200 entries; it no-ops on any deployed origin.
- `HeaderBar`, `WalletPanel`, and the execution flow show the connected wallet's public address only — full address is copy-on-click and truncated in display.

---

## License

See [`LICENSE`](./LICENSE).
