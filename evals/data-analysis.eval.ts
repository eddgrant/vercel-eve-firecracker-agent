import { defineEval } from "eve/evals";
import { includes } from "eve/evals/expect";

// Iteration 4: the payoff eval. The sample CSV (orders) is seeded at
// /workspace/data.csv, where "South" has the highest average order amount.
// A correct agent must RUN a pandas script (it must not compute the answer in its
// head), then report the real result.
//
// Assertions are deterministic ground truth — no LLM judge needed:
//   - calledTool("run_python") -> it actually executed code in the microVM
//   - check(reply, includes…)  -> the answer names the correct region
//
// Run: pnpm eval   (needs the Ollama container AND the ForgeVM daemon up).
//
// The agent uses a single `run_python` tool (agent/tools/run_python.ts) that writes
// the script into the microVM and runs it in one call. This is deliberate: small
// local models won't chain the built-in write_file -> bash pair (they write the
// script then hallucinate the answer), so collapsing write+run into one tool
// removes that failure — and WHEN the model calls the tool, it now works.
//
// STILL EXPECT FLAKINESS on the local 7B (qwen2.5:7b-instruct on a 4GB GPU): in
// practice it passes ~1 in 3 — it sometimes skips the tool entirely and answers
// from memory, or misreports the result, and Eve exposes no toolChoice:"required"
// lever to force a call. This is therefore a MODEL-CAPABILITY probe, not a
// regression gate. The deterministic guarantee that the pipeline computes "South"
// lives in the integration tests (test/forgevm-backend.integration.test.ts).
// Point OLLAMA_MODEL / the hosted LLM_* at a more capable model to pass reliably.
export default defineEval({
  description: "Answers a known-answer question by running pandas in the microVM and reports 'South'.",
  async test(t) {
    await t.send(
      "Which region has the highest average order amount?",
    );
    t.didNotFail();
    t.calledTool("run_python");
    t.check(t.reply, includes("South"));
  },
});
