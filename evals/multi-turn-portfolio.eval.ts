import { defineEval } from "eve/evals";
import { includes } from "eve/evals/expect";

// Multi-turn relational eval — a two-turn conversation over the synthetic org
// dataset (offices/employees/portfolios/assignments, seeded into the microVM by
// agent/sandbox/sandbox.ts). It exercises three things the single-turn evals
// don't: (1) a GROUP/JOIN across two CSVs, (2) carrying context from one turn to
// the next, and (3) a second JOIN that depends on the first turn's answer.
//
// Ground truth (deterministic; data/*.csv is generated from the same seeded PRNG
// that seeds the sandbox, so these are exact — see scripts/gen-org-data.mts):
//   Turn 1: the portfolio with the most distinct employees is "Nakatomi Growth"
//           (PF-17, 23 employees), counted from assignments x portfolios.
//   Turn 2: within Nakatomi Growth, the highest-paid employee is "Aisha Adeyemi"
//           (salary 168500), from assignments x employees.
//
// THIS IS A HARD CAPABILITY PROBE, NOT A REGRESSION GATE. It asks the model to
// chain discover -> join -> compute within a turn AND to remember the portfolio
// name across turns. The local 7B (qwen2.5:7b-instruct on a 4GB GPU) is unreliable
// at exactly this: it often does a single tool call then answers, guesses a wrong
// frame/column for a join, or drops the turn-1 context. Expect frequent failures
// locally; point OLLAMA_MODEL / the hosted LLM_* at a more capable model to pass
// it reliably. The deterministic correctness guarantees live in the integration
// tests; this eval measures conversational/relational capability.
//
// Run: pnpm eval   (needs the Ollama container AND the ForgeVM daemon up).
export default defineEval({
  description:
    "Multi-turn: finds the largest portfolio by headcount, then its highest-paid employee, carrying context across turns.",
  async test(t) {
    // Turn 1 — count distinct employees per portfolio (assignments x portfolios).
    await t.send("Which portfolio has the highest number of employees?");
    t.didNotFail();
    t.calledTool("run_python");
    t.check(t.reply, includes("Nakatomi Growth"));

    // Turn 2 — within THAT portfolio, the highest-paid employee
    // (assignments x employees). Relies on the agent carrying "Nakatomi Growth"
    // forward from turn 1 rather than re-asking which portfolio.
    await t.send("And which employee in that portfolio has the highest salary?");
    t.didNotFail();
    t.check(t.reply, includes("Aisha Adeyemi"));
  },
});
