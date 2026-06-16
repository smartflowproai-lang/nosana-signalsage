> **⚠️ Archived — self-hosted example code only.** This repository is archived and provided as open-source, self-hosted example code. SmartFlow does not operate this as a hosted service, facilitator, relayer, settlement or payment service for customers, does not hold customer funds or private keys, and does not run, submit or settle transactions on anyone's behalf.

# SignalSage — ElizaOS agent that pays for its own data feed

[![Nosana Builders' Challenge #4](https://img.shields.io/badge/Nosana-Builders'%20Challenge%20%234-00d18c)](https://superteam.fun/earn/listing/nosana-builders-elizaos-challenge/)
[![ElizaOS](https://img.shields.io/badge/ElizaOS-v2-7c3aed)](https://elizaos.ai)
[![x402](https://img.shields.io/badge/x402-micropayments-0066cc)](https://www.x402.org)
[![Docker](https://img.shields.io/badge/docker-tomsmartai%2Fsignalsage-2496ed)](https://hub.docker.com/r/tomsmartai/signalsage)

> Submission for the **Nosana x ElizaOS Builders Challenge** (April 2026).
> Built by [Tom Smart](https://x.com/TomSmart_ai).

SignalSage is a personal DeFi watcher built on **ElizaOS v2** and deployed on the **Nosana decentralized GPU network**. It rates Solana tokens as **BUY / WATCH / AVOID / INSUFFICIENT_DATA** by consuming a live x402-enabled data feed — the [SmartFlow Signal API](https://api.smartflowproai.com/decision) — and reasoning with Qwen3.5 served by Nosana.

The differentiator: SignalSage is wired to **pay per call** for the data it uses. Every live decision the agent surfaces is backed by an HTTP `GET /decision` against the SmartFlow feed. In production, paid callers settle $0.001 USDC micropayments via the [x402 protocol](https://www.x402.org) and the xpay.sh facilitator. For the challenge build the agent runs against the dev-token path so judges can reproduce it for free, while the x402 handshake lives in the client and flips on with a single env flag.

> **Theme:** Personal AI Agents — a calm, honest assistant that refuses to fabricate calls when the feed is dry.

---

## Why this submission is different

Most ElizaOS challenge entries wire their agent to a free public API. SignalSage treats its data feed as **paid infrastructure** the agent operates itself. That matches the Nosana narrative (personal, decentralized AI that runs on your own compute) and pushes ElizaOS into a pattern the agent economy actually needs: agents that pay their own bills.

- **Custom ElizaOS v2 plugin** — `x402-smartflow` ships a full `Action + Provider + Evaluator` trio, not just a toy action.
- **Live upstream** — the plugin is smoke-tested against `api.smartflowproai.com/decision` in this repo. No mocks, no stubs.
- **Payment path in the client** — `SmartFlowX402Client` already understands HTTP 402 responses. The challenge build runs in dev-token mode; flipping `SMARTFLOW_ENABLE_X402=true` is the wire to real settlement (stubbed handshake for safety in the challenge window).
- **Honest by design** — SignalSage refuses to turn "no data" into a bullish answer. The character and the action both hard-code that rule.
- **Runs on Nosana's hosted Qwen endpoint** — no self-hosted inference, no GPU contention, just the Nosana-provided `OPENAI_API_URL`.

---

## Architecture

```
                         +----------------------------------------+
                         |  Nosana GPU node (nvidia-3090 / 4090)  |
                         |  +----------------------------------+  |
                         |  | tomsmartai/signalsage:latest     |  |
                         |  | +------------------------------+ |  |
                         |  | | ElizaOS v2 runtime           | |  |
                         |  | |                              | |  |
                         |  | | character:  SignalSage       | |  |
                         |  | | plugins:                     | |  |
                         |  | |   - @elizaos/plugin-bootstrap| |  |
                         |  | |   - @elizaos/plugin-openai   | |  |
                         |  | |   - x402-smartflow (custom)  | |  |
                         |  | |       . CHECK_SMARTFLOW_     | |  |
                         |  | |         SIGNAL action        | |  |
                         |  | |       . RECENT_SMARTFLOW_    | |  |
                         |  | |         SIGNALS provider     | |  |
                         |  | |       . SMARTFLOW_ACCURACY_  | |  |
                         |  | |         EVALUATOR            | |  |
                         |  | +------------------------------+ |  |
                         |  +----------------------------------+  |
                         |        ^               ^               |
                         |        |               |               |
                         +--------|---------------|---------------+
                                  |               |
                                  |               |
          +-----------------------+               +----------------------+
          v                                                              v
+--------------------+                                       +--------------------+
|  Nosana Qwen3.5    |                                       |  SmartFlow Signal  |
|  hosted endpoint   |                                       |  API (x402-ready)  |
|  *.node.k8s.prd    |                                       |  api.smartflowproai|
|  .nos.ci/v1        |                                       |  .com/decision     |
|  (free, provided)  |                                       |  (paid in prod,    |
+--------------------+                                       |   dev-token path   |
                                                             |   for challenge)   |
                                                             +---------+----------+
                                                                       |
                                                                       | optional: HTTP 402
                                                                       v
                                                             +--------------------+
                                                             |  xpay.sh           |
                                                             |  x402 facilitator  |
                                                             |  (USDC on Base)    |
                                                             +--------------------+
```

---

## Components

| Component | File | Purpose |
|-----------|------|---------|
| Character | [`characters/signalsage.character.json`](./characters/signalsage.character.json) | Persona, system prompt, style rules, message examples. |
| Project entry | [`src/index.ts`](./src/index.ts) | Exports a `Project` with one `ProjectAgent` that bundles the SignalSage character with the custom plugin. |
| Plugin | [`src/plugins/x402-smartflow/index.ts`](./src/plugins/x402-smartflow/index.ts) | Defines the `CHECK_SMARTFLOW_SIGNAL` action, `RECENT_SMARTFLOW_SIGNALS` provider and `SMARTFLOW_ACCURACY_EVALUATOR`. |
| x402 client | [`src/plugins/x402-smartflow/x402-client.ts`](./src/plugins/x402-smartflow/x402-client.ts) | Minimal fetch wrapper that understands 402 challenge responses and normalises SmartFlow JSON. |
| Signal store | [`src/plugins/x402-smartflow/signals-store.ts`](./src/plugins/x402-smartflow/signals-store.ts) | Rolling in-memory history the provider and evaluator both read from. |
| Smoke test | [`scripts/smoke-test-plugin.ts`](./scripts/smoke-test-plugin.ts) | Standalone script that exercises validate/handler/provider/evaluator against the live upstream. |
| Dockerfile | [`Dockerfile`](./Dockerfile) | Multi-stage Bun build — ~1.3 GB runtime image. |
| Nosana job | [`nos_job_def/nosana_eliza_job_definition.json`](./nos_job_def/nosana_eliza_job_definition.json) | Ready-to-deploy job definition for the Nosana dashboard. |

---

## What SignalSage can do

```
User   > What's the signal for BONK?
Sage   > (calls CHECK_SMARTFLOW_SIGNAL)
         Signal for BONK: INSUFFICIENT_DATA
         Score: 0/10 — risk: unknown
         No upstream signals yet — treat this as no-data, not bullish.
         Dev token used — no payment settled this call.

User   > Show me the last few decisions.
Sage   > (RECENT_SMARTFLOW_SIGNALS provider fires)
         1. So111...1112 -> INSUFFICIENT_DATA (score 0, risk unknown, 2026-04-10T16:08:56Z)
         2. BONK         -> INSUFFICIENT_DATA (score 0, risk unknown, 2026-04-10T16:08:56Z)

User   > How accurate have you been?
Sage   > (SMARTFLOW_ACCURACY_EVALUATOR fires)
         Session tally: 2 signals checked — 0 BUY / 0 WATCH / 0 AVOID / 2 no-data.
         Avg score 0/10. Last check: 2026-04-10T16:08:56Z.
```

When the upstream actually has data for a token (live Solana launches, whales, copy-trades, scam checks) the same action returns a real `BUY / WATCH / AVOID` with a score and a reason string from the SmartFlow `decision-v1` model.

---

## Quick start

### Prerequisites

- [Bun](https://bun.sh) 1.3+ (or Node 23+ if you prefer, but `bun.lock` is the source of truth)
- Docker (for the Nosana-ready image)
- A Nosana Qwen3.5 endpoint — the defaults in `.env.example` point at the hosted one provided for the challenge

### Run locally

```bash
git clone https://github.com/smartflowproai-lang/nosana-signalsage.git
cd nosana-signalsage

cp .env.example .env
# The defaults already point at the hosted Nosana Qwen endpoint and the
# live SmartFlow Signal API. Nothing to edit for a first run.

bun install
bun run start
# → ElizaOS boots on http://localhost:3000 with SignalSage as the agent.
```

Open [http://localhost:3000](http://localhost:3000) for the built-in ElizaOS client, or hit the HTTP API directly:

```bash
curl -s http://localhost:3000/health
curl -s http://localhost:3000/api/agents
```

### Smoke-test the plugin against the live upstream

```bash
bun scripts/smoke-test-plugin.ts
```

Expected output (truncated):

```
validate('hi'): false (expected false)
validate('signal for BONK?'): true (expected true)
--- Calling checkSignal handler against LIVE api.smartflowproai.com ---
action result success: true
captured text:
 Signal for BONK: INSUFFICIENT_DATA
 Score: 0/10 — risk: unknown
 ...
SMOKE TEST PASSED
```

### Build the Docker image

```bash
docker build -t tomsmartai/signalsage:latest .
docker run --rm -p 3000:3000 --env-file .env tomsmartai/signalsage:latest
```

The image is multi-stage (Bun builder -> Bun runtime) and exposes port `3000` with a built-in `/health` HEALTHCHECK.

### Deploy on Nosana

1. Push the image to a public registry (Docker Hub is used here: `docker push tomsmartai/signalsage:latest`).
2. Open [dashboard.nosana.com](https://dashboard.nosana.com) and paste the job definition from `nos_job_def/nosana_eliza_job_definition.json`, or use the Nosana CLI:
   ```bash
   npm i -g @nosana/cli
   nosana job post --file ./nos_job_def/nosana_eliza_job_definition.json --market nvidia-3090
   ```
3. Copy the deployment URL (`https://<job-id>.node.k8s.prd.nos.ci`) and you are done.

---

## The x402 angle, in plain English

HTTP 402 was reserved in the original HTTP spec for "Payment Required" and sat unused for 30 years. The [x402 protocol](https://www.x402.org) revives it: a client hits an API, the server replies `402` with a tiny payment challenge, the client signs and settles a USDC micropayment (typically on Base via a facilitator like xpay.sh), and the same request is replayed with an `x-payment` header that unlocks the response.

For agents, that is a big deal. It means an agent can hit priced APIs without a subscription, without an account, without a human in the loop. One call, one cent, one piece of data. **SignalSage is wired for exactly that flow.** In the challenge build we stay on the dev-token path so everything is reproducible for free, but:

- The client class already branches on `response.status === 402`.
- A single env flag (`SMARTFLOW_ENABLE_X402=true`) turns on the paid path.
- The SmartFlow Signal API that SignalSage consumes is **already live** and already understands x402 — it powers real pay-per-call lookups for other SmartFlow infrastructure.

This submission is the first ElizaOS agent I am aware of that treats paid external data as a first-class primitive.

---

## Tech stack

- **ElizaOS v2** (`@elizaos/core`, `@elizaos/cli`, `@elizaos/plugin-bootstrap`, `@elizaos/plugin-openai`)
- **Qwen3.5-9B-FP8** served by Nosana (hosted inference endpoint)
- **Bun 1.3** for local dev and the Docker runtime
- **TypeScript 5** (strict mode, bundler resolution)
- **Nosana** decentralized GPU marketplace for deployment
- **SmartFlow Signal API** — backend scoring pipeline (`decision-v1`) by Tom Smart, x402-ready
- **xpay.sh** x402 facilitator (USDC on Base, only wired in when `SMARTFLOW_ENABLE_X402=true`)

---

## Environment variables

See [`.env.example`](./.env.example). The ones that matter for SignalSage on top of the ElizaOS defaults:

| Variable | Default | Purpose |
|----------|---------|---------|
| `SMARTFLOW_API_BASE_URL` | `https://api.smartflowproai.com` | Base URL of the SmartFlow Signal API. |
| `SMARTFLOW_DEFAULT_TOKEN` | wrapped SOL mint | Fallback token when the user does not name one. |
| `SMARTFLOW_ENABLE_X402` | `false` | Flip to `true` to run the real x402 handshake instead of dev-token. |

---

## Links

- [ElizaOS](https://elizaos.ai) — the agent framework
- [Nosana](https://nosana.com) — decentralized GPU compute on Solana
- [x402 protocol](https://www.x402.org) — HTTP 402-based machine micropayments
- [SmartFlow Signal API](https://api.smartflowproai.com/decision) — the paid data feed SignalSage consumes
- [Agent Challenge starter](https://github.com/nosana-ci/agent-challenge) — this repo is forked from the official starter (see [`CHALLENGE.md`](./CHALLENGE.md) for the original brief)

---

## Credits

Built by **Tom Smart** ([@TomSmart_ai](https://x.com/TomSmart_ai), [github.com/smartflowproai-lang](https://github.com/smartflowproai-lang)) for the Nosana x ElizaOS Builders Challenge, April 2026.

SignalSage is part of the broader SmartFlow family of agent-economy infrastructure experiments — the same toolkit that ships the n8n x402 node and the SmartFlow Signal API.

## License

MIT. See [LICENSE](./LICENSE).
