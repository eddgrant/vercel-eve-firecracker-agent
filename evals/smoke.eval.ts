import { defineEval } from "eve/evals";

// Minimal happy-path smoke: a trivial data question the agent answers by running
// code. Proves boot -> model -> tool-call -> microVM -> answer in one quick turn.
//
// (Originally "Say hello" — but that no longer suits the data-analyst persona:
// with the sandbox tools always available and instructions that insist on running
// code, capable models attempt a tool call even for a greeting, which strict
// providers like Groq reject with "Failed to call a function". A trivial data
// question keeps the model on its intended path.)
//
// The sample dataset has 8 rows, so the answer is "8".
// Run: pnpm eval   (needs the LLM provider + the ForgeVM daemon up)
export default defineEval({
  description: "Agent answers a trivial count question end-to-end (boot + model + sandbox).",
  async test(t) {
    await t.send("How many orders are in the dataset? Answer with just the number.");
    // Smoke scope = "a turn completes without terminally failing". How the model
    // answers (which tool, exact phrasing) is stochastic, so we don't assert it
    // here — the strict known-answer + calledTool checks live in data-analysis.
    t.didNotFail();
  },
});
