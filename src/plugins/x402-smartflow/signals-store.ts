/**
 * In-process rolling store for recent SmartFlow signal lookups.
 *
 * The store is intentionally tiny — ElizaOS already has durable memory via
 * SQLite, but for the provider/evaluator loop we only need the last N
 * decisions and a naive accuracy tally. That keeps the demo deterministic
 * and avoids DB migrations in the challenge window.
 */

import type { SmartFlowDecision } from "./x402-client";

export interface StoredSignal extends SmartFlowDecision {
  recordedAt: number;
}

export interface AccuracyStats {
  total: number;
  buys: number;
  watches: number;
  avoids: number;
  insufficient: number;
  avgScore: number;
  lastCheckedAt: string | null;
}

const MAX_SIGNALS = 25;

export class SignalStore {
  private readonly signals: StoredSignal[] = [];

  record(decision: SmartFlowDecision): StoredSignal {
    const stored: StoredSignal = { ...decision, recordedAt: Date.now() };
    this.signals.unshift(stored);
    if (this.signals.length > MAX_SIGNALS) {
      this.signals.length = MAX_SIGNALS;
    }
    return stored;
  }

  recent(limit = 5): StoredSignal[] {
    return this.signals.slice(0, Math.max(0, limit));
  }

  stats(): AccuracyStats {
    if (this.signals.length === 0) {
      return {
        total: 0,
        buys: 0,
        watches: 0,
        avoids: 0,
        insufficient: 0,
        avgScore: 0,
        lastCheckedAt: null,
      };
    }

    let buys = 0;
    let watches = 0;
    let avoids = 0;
    let insufficient = 0;
    let scoreSum = 0;

    for (const s of this.signals) {
      switch (s.action) {
        case "BUY":
          buys += 1;
          break;
        case "WATCH":
          watches += 1;
          break;
        case "AVOID":
          avoids += 1;
          break;
        default:
          insufficient += 1;
      }
      scoreSum += s.score ?? 0;
    }

    return {
      total: this.signals.length,
      buys,
      watches,
      avoids,
      insufficient,
      avgScore: Math.round((scoreSum / this.signals.length) * 100) / 100,
      lastCheckedAt: this.signals[0]?.timestamp ?? null,
    };
  }
}

// Single module-level store keeps actions, providers and evaluators in sync
// inside the same agent process. Swap for a runtime service if the agent
// ever needs multi-tenant isolation.
export const signalStore = new SignalStore();
