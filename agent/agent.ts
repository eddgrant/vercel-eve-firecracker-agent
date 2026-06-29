import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { defineAgent } from "eve";

// Provider + model are defined INLINE here on purpose: Eve loads the agent's
// `model` in a durable step via a source-backed reference that resolves this
// module's imports against the .ts snapshot — a cross-module import breaks that
// loader. Keep everything the model needs reachable from agent.ts directly.
//
//  - DEFAULT: local Ollama (free, fully local). Small models that fit a 4GB GPU
//    are weak, unreliable tool-users, so the data-analysis flow is flaky locally.
//
//  - HOSTED: set LLM_BASE_URL + LLM_API_KEY + LLM_MODEL to use ANY
//    OpenAI-compatible provider for reliable tool-calling. Free tiers (Groq,
//    Google AI Studio, OpenRouter, Cerebras) often rate-limit (HTTP 429); the
//    fetch wrapper below waits out 429s (honouring Retry-After) and optionally
//    paces requests to LLM_RPM, so a free-tier limit slows the agent instead of
//    killing the turn. See .env.example.
const hosted = Boolean(process.env.LLM_BASE_URL && process.env.LLM_API_KEY);

// Client-side rate-limit handling for free hosted tiers.
const minIntervalMs = process.env.LLM_RPM ? Math.ceil(60_000 / Number(process.env.LLM_RPM)) : 0;
const maxRetries = Number(process.env.LLM_MAX_RETRIES ?? 6);
// Upper bound on a single 429 backoff. Free tiers can return a `Retry-After` of
// an entire quota window (Groq has been seen returning ~3600s); honouring that
// verbatim makes a turn appear to hang for an hour. Cap it so the wait stays
// sane, and bail out fast when the server demands longer than the cap.
const maxBackoffMs = Number(process.env.LLM_MAX_BACKOFF_MS ?? 60_000);
let nextAllowedAt = 0;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Diagnostic logging for the otherwise-silent fetch wrapper. Gated on
// EVE_LOG_LEVEL=debug so production stays quiet. This is what makes a "hang" in
// the model call legible: if you see `status=429 retryAfter=… sleeping=…ms` the
// agent is throttled (not stuck); if you see `attempt=N start` with no matching
// `status=…` line, the fetch itself never resolved (connection/stream hang).
const fetchDebug = process.env.EVE_LOG_LEVEL === "debug";
const flog = (msg: string) => {
  // eslint-disable-next-line no-console
  if (fetchDebug) console.error(`[llm-fetch] ${new Date().toISOString()} ${msg}`);
};
const reqUrl = (input: Parameters<typeof fetch>[0]) =>
  typeof input === "string" ? input : input instanceof URL ? input.href : (input as Request).url;

const resilientFetch: typeof fetch = async (input, init) => {
  for (let attempt = 0; ; attempt++) {
    // Best-effort pacing to stay under LLM_RPM (only meaningful within a process).
    if (minIntervalMs > 0) {
      const wait = nextAllowedAt - Date.now();
      if (wait > 0) {
        flog(`pacing: waiting ${wait}ms to honour LLM_RPM=${process.env.LLM_RPM}`);
        await sleep(wait);
      }
      nextAllowedAt = Date.now() + minIntervalMs;
    }
    flog(`attempt=${attempt} start url=${reqUrl(input)}`);
    const res = await fetch(input, init);
    flog(`attempt=${attempt} status=${res.status}`);
    if (res.status !== 429 || attempt >= maxRetries) return res;
    // Requested wait: honour Retry-After (seconds) when present, else exponential backoff.
    const retryAfter = Number(res.headers.get("retry-after"));
    const requestedMs = retryAfter > 0 ? retryAfter * 1000 : 1000 * 2 ** attempt;
    // A Retry-After beyond our cap signals a quota WINDOW (e.g. a daily/minute
    // limit reset ~an hour out), not a momentary burst — waiting the cap and
    // re-asking would just 429 again. Fail fast so the error surfaces instead of
    // freezing the turn. Logged at warn so it's visible without EVE_LOG_LEVEL.
    if (requestedMs > maxBackoffMs) {
      // eslint-disable-next-line no-console
      console.warn(
        `[llm-fetch] 429 from provider with Retry-After=${retryAfter}s — exceeds ` +
          `LLM_MAX_BACKOFF_MS=${maxBackoffMs}ms cap; giving up (quota likely exhausted). ` +
          `Switch LLM_MODEL/provider or wait for the limit to reset.`,
      );
      return res; // let the AI SDK surface the 429 as a clear error
    }
    // eslint-disable-next-line no-console
    console.warn(`[llm-fetch] 429 throttled (attempt ${attempt}); backing off ${requestedMs}ms`);
    await res.arrayBuffer().catch(() => {}); // drain the throttled response
    await sleep(requestedMs);
  }
};

const provider = hosted
  ? createOpenAICompatible({
      name: "hosted",
      baseURL: process.env.LLM_BASE_URL as string,
      apiKey: process.env.LLM_API_KEY as string,
      fetch: resilientFetch,
    })
  : createOpenAICompatible({
      name: "ollama",
      baseURL: process.env.OLLAMA_BASE_URL ?? "http://localhost:11435/v1",
      // Ollama ignores the key, but the provider requires a non-empty value.
      apiKey: process.env.OLLAMA_API_KEY ?? "ollama",
    });

// When hosted, set LLM_MODEL to match the provider (see .env.example).
const modelId = hosted
  ? process.env.LLM_MODEL ?? "llama-3.3-70b-versatile"
  : process.env.OLLAMA_MODEL ?? "llama3.1:8b";

export default defineAgent({
  model: provider.chatModel(modelId),
  // Neither local Ollama nor these hosted models are in the AI Gateway catalog,
  // so state the context window directly (avoids Eve's compaction metadata
  // lookup). 16384 matches the tuned `data-analyst` model's num_ctx (see
  // ollama/data-analyst.Modelfile) — keeping these in sync matters: if Eve's
  // figure is lower than the model's real window, it compacts context too early
  // and a small model loses the tool-calling thread mid-conversation.
  modelContextWindowTokens: 16384,
});
