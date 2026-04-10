/**
 * Standalone smoke test for the x402-smartflow plugin.
 *
 * Verifies that:
 *   1. The x402 client can reach the live SmartFlow Signal API.
 *   2. The checkSignal action handler parses, records and formats results.
 *   3. The recentSignals provider surfaces the recorded history.
 *   4. The accuracy evaluator returns a sensible tally.
 *
 * Run with:   bun scripts/smoke-test-plugin.ts
 *
 * This script fakes the ElizaOS runtime with the minimum surface the plugin
 * actually uses. That's enough to exercise every code path without booting
 * a full AgentRuntime + SQLite.
 */

import x402SmartFlowPlugin from "../src/plugins/x402-smartflow/index.ts";
import { signalStore } from "../src/plugins/x402-smartflow/signals-store.ts";

type Captured = { text: string; actions?: string[] };

async function run() {
  const plugin = x402SmartFlowPlugin;
  const action = plugin.actions?.[0];
  const provider = plugin.providers?.[0];
  const evaluator = plugin.evaluators?.[0];

  if (!action || !provider || !evaluator) {
    throw new Error("Plugin is missing expected components");
  }

  const fakeRuntime = {} as unknown as Parameters<typeof action.handler>[0];
  const fakeState = {} as unknown as Parameters<typeof action.handler>[2];

  const captured: Captured[] = [];
  const callback = async (response: Captured) => {
    captured.push(response);
    return [] as never[];
  };

  // 1. validate() should reject irrelevant messages and accept signal asks.
  const rejectMsg = { content: { text: "hi" } } as unknown as Parameters<typeof action.handler>[1];
  const acceptMsg = {
    content: { text: "What's the signal for BONK?" },
  } as unknown as Parameters<typeof action.handler>[1];

  const rejected = await action.validate(fakeRuntime, rejectMsg);
  const accepted = await action.validate(fakeRuntime, acceptMsg);
  console.log("validate('hi'):", rejected, "(expected false)");
  console.log("validate('signal for BONK?'):", accepted, "(expected true)");
  if (rejected || !accepted) throw new Error("Action validate() logic broken");

  // 2. handler() should hit the live API and return a decision.
  console.log("\n--- Calling checkSignal handler against LIVE api.smartflowproai.com ---");
  const result = await action.handler(fakeRuntime, acceptMsg, fakeState, undefined, callback);
  console.log("action result success:", (result as { success?: boolean })?.success);
  console.log("captured text:\n", captured[captured.length - 1]?.text);
  if (!(result as { success?: boolean })?.success) {
    throw new Error("Live API call failed — see captured text above");
  }

  // 3. Also test a Solana mint path.
  const mintMsg = {
    content: { text: "check signal for So11111111111111111111111111111111111111112" },
  } as unknown as Parameters<typeof action.handler>[1];
  await action.handler(fakeRuntime, mintMsg, fakeState, undefined, callback);

  // 4. provider.get() should surface the history.
  const providerResult = await provider.get(fakeRuntime, acceptMsg, fakeState as never);
  console.log("\n--- recentSignals provider text ---\n" + providerResult.text);
  if ((providerResult.values?.smartflowHistoryCount as number) < 1) {
    throw new Error("Provider reported 0 history after 2 calls");
  }

  // 5. evaluator should accept "accurate" queries and report stats.
  const evalMsg = {
    content: { text: "how accurate have you been?" },
  } as unknown as Parameters<typeof action.handler>[1];
  const evalCaptured: Captured[] = [];
  const evalCallback = async (response: Captured) => {
    evalCaptured.push(response);
    return [] as never[];
  };
  const evalValid = await evaluator.validate(fakeRuntime, evalMsg);
  if (!evalValid) throw new Error("Evaluator validate() should accept 'accurate' query");
  await evaluator.handler(fakeRuntime, evalMsg, fakeState, undefined, evalCallback);
  console.log("\n--- accuracyEvaluator output ---\n" + evalCaptured[0]?.text);

  const stats = signalStore.stats();
  if (stats.total < 2) {
    throw new Error("Signal store did not retain entries across calls");
  }

  console.log("\nSMOKE TEST PASSED");
}

run().catch((err) => {
  console.error("SMOKE TEST FAILED:", err);
  process.exit(1);
});
