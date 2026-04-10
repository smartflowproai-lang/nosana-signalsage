/**
 * x402-smartflow plugin
 * ---------------------
 * Custom ElizaOS v2 plugin that turns SignalSage into an autonomous DeFi
 * watcher for Solana token launches. The plugin is intentionally small and
 * self-contained so it can be audited quickly by challenge judges.
 *
 * Components:
 *   - checkSignalAction:     on-demand lookup against the SmartFlow Signal
 *                            API via the x402-aware HTTP client.
 *   - recentSignalsProvider: injects the last few decisions into the LLM
 *                            prompt so the agent can reason with history.
 *   - accuracyEvaluator:     runs after each reply, keeps a lightweight
 *                            tally of action distribution and average score.
 *
 * The plugin never swallows errors silently — when the upstream is down or
 * misconfigured the action returns success=false with a human-readable
 * message so the conversation stays honest.
 */

import type {
  Action,
  ActionResult,
  Evaluator,
  IAgentRuntime,
  Memory,
  Plugin,
  Provider,
  ProviderResult,
  State,
} from "@elizaos/core";

import { SmartFlowX402Client, type SmartFlowDecision } from "./x402-client";
import { signalStore } from "./signals-store";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const DEFAULT_TOKEN =
  process.env.SMARTFLOW_DEFAULT_TOKEN ??
  "So11111111111111111111111111111111111111112"; // wrapped SOL

const client = new SmartFlowX402Client({
  baseUrl: process.env.SMARTFLOW_API_BASE_URL,
  enableX402Payments: process.env.SMARTFLOW_ENABLE_X402 === "true",
});

const CHECK_SIGNAL_KEYWORDS = [
  "signal",
  "sygnał",
  "signalsage",
  "decision",
  "buy or avoid",
  "should i buy",
  "should i watch",
  "should i avoid",
  "check",
  "rate this token",
  "rate token",
];

function extractToken(text: string): string {
  if (!text) return DEFAULT_TOKEN;

  // Solana mint heuristic: base58 string, 32-44 chars, no 0OIl.
  const mintMatch = text.match(/[1-9A-HJ-NP-Za-km-z]{32,44}/);
  if (mintMatch) return mintMatch[0];

  // Ticker heuristic: $TICKER or bare BONK/JUP style uppercase 2-10.
  const tickerMatch =
    text.match(/\$([A-Za-z0-9]{2,10})/) ??
    text.match(/\b([A-Z]{2,10})\b(?=\s*(?:token|coin|$|\.|,|\?))/);
  if (tickerMatch) return tickerMatch[1].toUpperCase();

  return DEFAULT_TOKEN;
}

function formatDecision(decision: SmartFlowDecision): string {
  const lines: string[] = [];
  lines.push(`Signal for ${decision.token}: ${decision.action}`);
  lines.push(`Score: ${decision.score}/10 — risk: ${decision.risk}`);
  if (decision.reason) lines.push(`Reason: ${decision.reason}`);
  if (decision.signalsCounted > 0) {
    lines.push(`Backed by ${decision.signalsCounted} upstream signals.`);
  } else {
    lines.push("No upstream signals yet — treat this as no-data, not bullish.");
  }
  lines.push(
    decision.paid
      ? `Paid ${decision.paymentAmountUsdc} USDC via ${decision.facilitator} (x402).`
      : "Dev token used — no payment settled this call."
  );
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Action: checkSignal
// ---------------------------------------------------------------------------

const checkSignalAction: Action = {
  name: "CHECK_SMARTFLOW_SIGNAL",
  similes: [
    "CHECK_SIGNAL",
    "GET_SIGNAL",
    "SMARTFLOW_DECISION",
    "RATE_TOKEN",
    "DEFI_WATCHER",
  ],
  description:
    "Fetch a live BUY/WATCH/AVOID decision from the SmartFlow Signal API for a Solana token. " +
    "Use this whenever the user asks for a rating, a signal, or whether to buy/watch/avoid a token.",
  examples: [
    [
      {
        name: "{{user1}}",
        content: { text: "What's the signal for BONK right now?" },
      },
      {
        name: "SignalSage",
        content: {
          text: "Let me hit the SmartFlow Signal API and tell you what the feed says.",
          actions: ["CHECK_SMARTFLOW_SIGNAL"],
        },
      },
    ],
    [
      {
        name: "{{user1}}",
        content: { text: "Rate token So111...1112" },
      },
      {
        name: "SignalSage",
        content: {
          text: "Pulling a live decision for that mint.",
          actions: ["CHECK_SMARTFLOW_SIGNAL"],
        },
      },
    ],
  ],
  validate: async (_runtime: IAgentRuntime, message: Memory) => {
    const text = (message?.content?.text ?? "").toLowerCase();
    if (!text) return false;
    return CHECK_SIGNAL_KEYWORDS.some((kw) => text.includes(kw));
  },
  handler: async (
    _runtime: IAgentRuntime,
    message: Memory,
    _state?: State,
    _options?: Record<string, unknown>,
    callback?: (response: { text: string; actions?: string[] }) => Promise<unknown>
  ): Promise<ActionResult> => {
    const rawText = message?.content?.text ?? "";
    const token = extractToken(rawText);

    try {
      const decision = await client.getDecision(token);
      signalStore.record(decision);

      const text = formatDecision(decision);
      if (callback) {
        await callback({ text, actions: ["CHECK_SMARTFLOW_SIGNAL"] });
      }

      return {
        success: true,
        text,
        values: {
          smartflowLastAction: decision.action,
          smartflowLastScore: decision.score,
          smartflowLastToken: decision.token,
        },
        data: { decision },
      };
    } catch (err) {
      const message = (err as Error).message;
      const text =
        `I couldn't reach the SmartFlow Signal API for ${token}. ` +
        `Details: ${message}. I won't guess — try again in a minute or check the endpoint.`;
      if (callback) {
        await callback({ text });
      }
      return {
        success: false,
        text,
        error: message,
      };
    }
  },
};

// ---------------------------------------------------------------------------
// Provider: recentSignals
// ---------------------------------------------------------------------------

const recentSignalsProvider: Provider = {
  name: "RECENT_SMARTFLOW_SIGNALS",
  description:
    "Injects the last few SmartFlow decisions into the agent context so responses " +
    "can reference historical calls and avoid repeating stale advice.",
  dynamic: true,
  position: 50,
  get: async (
    _runtime: IAgentRuntime,
    _message: Memory,
    _state: State
  ): Promise<ProviderResult> => {
    const recent = signalStore.recent(5);
    if (recent.length === 0) {
      return {
        text: "SmartFlow history: no signals fetched yet this session.",
        values: { smartflowHistoryCount: 0 },
        data: { recent: [] },
      };
    }

    const lines = recent.map(
      (s, i) =>
        `${i + 1}. ${s.token} → ${s.action} (score ${s.score}, risk ${s.risk}, ${s.timestamp})`
    );

    return {
      text: `Recent SmartFlow signals (most recent first):\n${lines.join("\n")}`,
      values: { smartflowHistoryCount: recent.length },
      data: { recent },
    };
  },
};

// ---------------------------------------------------------------------------
// Evaluator: accuracyEvaluator
// ---------------------------------------------------------------------------

const accuracyEvaluator: Evaluator = {
  name: "SMARTFLOW_ACCURACY_EVALUATOR",
  description:
    "Tracks how many BUY/WATCH/AVOID signals SignalSage has surfaced and the average " +
    "score, so the agent can answer 'how accurate are you' without hallucinating stats.",
  alwaysRun: false,
  examples: [
    {
      prompt: "User asks how accurate SignalSage has been this session.",
      messages: [
        { name: "{{user1}}", content: { text: "how accurate have you been?" } },
      ],
      outcome:
        "Agent reports live tally from the signal store, e.g. '12 signals checked, 4 BUY / 5 WATCH / 3 AVOID, avg score 6.1/10'.",
    },
  ],
  validate: async (_runtime: IAgentRuntime, message: Memory) => {
    const text = (message?.content?.text ?? "").toLowerCase();
    return (
      text.includes("accurate") ||
      text.includes("track record") ||
      text.includes("stats") ||
      text.includes("how many signals")
    );
  },
  handler: async (
    _runtime: IAgentRuntime,
    _message: Memory,
    _state?: State,
    _options?: Record<string, unknown>,
    callback?: (response: { text: string }) => Promise<unknown>
  ): Promise<ActionResult> => {
    const stats = signalStore.stats();
    const text =
      stats.total === 0
        ? "I haven't run any SmartFlow checks yet this session. Ask me for a signal first."
        : `Session tally: ${stats.total} signals checked — ${stats.buys} BUY / ${stats.watches} WATCH / ${stats.avoids} AVOID / ${stats.insufficient} no-data. Avg score ${stats.avgScore}/10. Last check: ${stats.lastCheckedAt}.`;

    if (callback) await callback({ text });
    return { success: true, text, data: { stats } };
  },
};

// ---------------------------------------------------------------------------
// Plugin export
// ---------------------------------------------------------------------------

export const x402SmartFlowPlugin: Plugin = {
  name: "x402-smartflow",
  description:
    "SignalSage's paid data plane: x402 micropayments to the SmartFlow Signal API for " +
    "on-demand Solana token BUY/WATCH/AVOID decisions, plus a provider and evaluator " +
    "so ElizaOS can reason over recent calls.",
  actions: [checkSignalAction],
  providers: [recentSignalsProvider],
  evaluators: [accuracyEvaluator],
};

export default x402SmartFlowPlugin;
