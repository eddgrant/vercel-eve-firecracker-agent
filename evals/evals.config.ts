import { defineEvalConfig } from "eve/evals";

// Required by `eve eval`. Empty for now: our current evals use only
// deterministic assertions (completed / messageIncludes / calledTool / check),
// so no LLM judge is configured. When we add judge-based evals (iteration 4),
// set `judge: { model }` here — pointed at local Ollama to keep it free.
export default defineEvalConfig({});
