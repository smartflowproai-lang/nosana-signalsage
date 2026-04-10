/**
 * Minimal x402-aware HTTP client for the SmartFlow Signal API.
 *
 * The SmartFlow Signal API (https://api.smartflowproai.com/decision) is an
 * x402-protocol-enabled data feed. In production, paid callers receive a
 * 402 Payment Required challenge, sign a micropayment payload (USDC on Base
 * via the xpay.sh facilitator) and replay the request. For the challenge
 * build we hit the same endpoint in "dev mode" (?token=...) and gracefully
 * degrade if we ever encounter a real 402.
 *
 * Keeping the x402 path in the client means the agent is ready to flip the
 * switch to real micropayments without any action-level refactors.
 */

export interface SmartFlowDecision {
  token: string;
  action: "BUY" | "WATCH" | "AVOID" | "INSUFFICIENT_DATA" | string;
  score: number;
  risk: string;
  reason: string;
  signals: Record<string, string>;
  signalsCounted: number;
  dataAgeSeconds: number | null;
  modelVersion: string;
  timestamp: string;
  paid: boolean;
  paymentAmountUsdc?: number;
  facilitator?: string;
  disclaimer?: string;
}

export interface X402ClientOptions {
  baseUrl?: string;
  timeoutMs?: number;
  /**
   * If true, the client will attempt a real x402 handshake when it
   * encounters HTTP 402. Requires X402_PRIVATE_KEY env. For the Nosana
   * challenge build this is off by default — we consume the dev endpoint.
   */
  enableX402Payments?: boolean;
}

const DEFAULT_BASE_URL = "https://api.smartflowproai.com";

export class SmartFlowX402Client {
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly enableX402Payments: boolean;

  constructor(opts: X402ClientOptions = {}) {
    this.baseUrl = (opts.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
    this.timeoutMs = opts.timeoutMs ?? 8000;
    this.enableX402Payments = opts.enableX402Payments ?? false;
  }

  /**
   * Fetch a decision for the given Solana token mint or ticker.
   * Normalises the API response into a stable SmartFlowDecision shape.
   */
  async getDecision(token: string): Promise<SmartFlowDecision> {
    const url = `${this.baseUrl}/decision?token=${encodeURIComponent(token)}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    let response: Response;
    try {
      response = await fetch(url, {
        method: "GET",
        headers: {
          "Accept": "application/json",
          "User-Agent": "signalsage-elizaos/0.1 (+https://github.com/smartflowproai-lang/nosana-signalsage)",
        },
        signal: controller.signal,
      });
    } catch (err) {
      clearTimeout(timer);
      throw new Error(`SmartFlow Signal API request failed: ${(err as Error).message}`);
    }
    clearTimeout(timer);

    // Real x402 flow — only used if challenge payload arrives and payments
    // are explicitly enabled. Otherwise we surface a friendly error so the
    // calling action can downgrade the answer for the user.
    if (response.status === 402) {
      if (!this.enableX402Payments) {
        throw new Error(
          "SmartFlow Signal API returned HTTP 402 (payment required) but x402 payments are disabled. " +
            "Set SMARTFLOW_ENABLE_X402=true and configure X402_PRIVATE_KEY to settle micropayments."
        );
      }
      // Placeholder — the real handshake signs a payment payload using the
      // operator's wallet and replays the request with x-payment headers.
      // We keep this as a stub in the challenge build so the hot path
      // (dev token) stays deterministic and free to demo on Nosana.
      throw new Error("x402 real-payment path not wired in this build. Use dev token for demos.");
    }

    if (!response.ok) {
      const body = await safeText(response);
      throw new Error(
        `SmartFlow Signal API returned HTTP ${response.status}: ${body.slice(0, 200)}`
      );
    }

    const json = (await response.json()) as Record<string, unknown>;

    return {
      token,
      action: (json.action as string) ?? "INSUFFICIENT_DATA",
      score: typeof json.score === "number" ? (json.score as number) : 0,
      risk: (json.risk as string) ?? "unknown",
      reason: (json.reason as string) ?? "",
      signals: (json.signals as Record<string, string>) ?? {},
      signalsCounted:
        typeof json.signals_counted === "number" ? (json.signals_counted as number) : 0,
      dataAgeSeconds:
        typeof json.data_age_seconds === "number"
          ? (json.data_age_seconds as number)
          : null,
      modelVersion: (json.model_version as string) ?? "decision-v1",
      timestamp: (json.timestamp as string) ?? new Date().toISOString(),
      paid: this.enableX402Payments,
      paymentAmountUsdc: this.enableX402Payments ? 0.001 : 0,
      facilitator: this.enableX402Payments ? "xpay.sh" : "dev-token",
      disclaimer: (json.disclaimer as string) ?? undefined,
    };
  }
}

async function safeText(response: Response): Promise<string> {
  try {
    return await response.text();
  } catch {
    return "";
  }
}
