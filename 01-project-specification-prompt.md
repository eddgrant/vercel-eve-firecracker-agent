# Vercel Eve Firecracker Agent

I want to build a local proof-of-concept monorepo that wires together three tools to run a
sandboxed data-analysis AI agent entirely on my own machine. I'm on **Linux with KVM
available** (bare metal), so real Firecracker microVMs are possible.

> **Doc-verification note (2026-06-19):** these tools are new/fast-moving — do **NOT** trust
> training data. The version numbers, commands, and API shapes below were checked against the
> live docs/repos on the date above, but re-verify against the installed package types before
> writing integration code. Anything I could not verify is listed under
> **Known unknowns** at the end.

---

## Language / stack ground rules

- **TypeScript for everything I write** — the Eve agent, its tools, and the ForgeVM sandbox
  adapter. This is the primary stack.
- **Python only ever appears as the snippet the agent generates at runtime** (the pandas it
  ships into the sandbox). It is never hand-written by us.
- **ForgeVM is a pre-built Go binary** we run as-is.
- **Glue** (rootfs build, Docker Compose, Makefile/scripts) is shell / Dockerfile / YAML.
- Use **pnpm** (workspaces only if it genuinely simplifies things — keep it minimal).

---

## The three tools (verified)

1. **Eve** — Vercel's agent framework ("Next.js for agents"). Docs: https://eve.dev/docs/.
   - npm package: **`eve`**, latest **0.11.7** (pre-1.0 — pin exactly).
   - Scaffold: `npx eve@latest init <name>` (scaffolds, installs deps, starts the dev server).
   - **Agent files live under an `agent/` directory** (not the project root): `agent/agent.ts`
     (runtime config: model, build), `agent/instructions.md`, `agent/tools/*.ts`,
     `agent/skills/`, `agent/sandbox/` (sandbox def + seeded files), `agent/schedules/`,
     `agent/channels/`, `agent/subagents/`, etc. `evals/` is a sibling of `agent/`.
   - Local interaction surface: **`eve dev`** → boots the local runtime and opens an
     **interactive terminal chat UI (TUI)** — stream, inline tool-call approval, slash
     commands (`/model`, `/deploy`, …). This is our input surface. There's also an HTTP API
     (`POST /eve/v1/session`, stream at `/eve/v1/session/<id>/stream`) for programmatic tests.
2. **ForgeVM** — self-hosted sandbox orchestrator, single Go binary, REST API on
   `http://localhost:7423` (`/api/v1`). Repo: https://github.com/DohaerisAI/forgevm.
   - Daemon latest release **v0.1.2** (linux/amd64 prebuilt binary available); TS SDK on npm
     **`forgevm` 0.1.1** (npm lags the repo). Pin both.
   - `firecracker` provider (~28ms snapshot restore, needs KVM) plus `docker`, `mock`, and
     others. Pool/warm-pool mode is built in.
   - **`docs/api.md` does not exist** (README links to it but it 404s). Source of truth =
     `docs/swagger.yaml` and the SDK source (`sdk/js/src/*.ts`).
   - **SDK correction:** the `Client` constructor takes an **options object**, not a string:
     `new Client({ baseUrl: "http://localhost:7423" })` (or `{ host, port }`).
3. **Vercel Workflow SDK** — implicit dependency of Eve; I do NOT want a separate standalone
   workflow. For local dev Eve uses the filesystem-based **Local World** (`.workflow-data/`),
   **no external infra**.

---

## Execution model (corrected — read this carefully)

- The **agent loop runs in the Eve runtime** (a Nitro process; locally, the `eve dev` server).
  It does **NOT** run inside the sandbox.
- The **sandbox is only for executing the code the agent writes** (the pandas). The Firecracker
  microVM is an **ephemeral executor of that code**, not a host for the agent.
- Eve's unit of work is a **"turn"** — one user message and all the work it triggers — built as
  a **durable workflow** (Workflow SDK, Local World on disk). There is **no durable FIFO
  queue**; sessions resume via a `continuationToken`. There is **no separate
  "orchestrator/worker" process** — the persistent local process is simply the `eve dev`
  server.

---

## Architecture (three planes)

```
┌─────────────────────── HOST (Linux + KVM) ───────────────────────┐
│   ┌─ Docker Compose ─────────┐                                    │
│   │  Ollama  :11434          │   ← the ONLY persistent service    │
│   │  (+ one-shot model pull) │     OpenAI-compatible endpoint     │
│   └──────────▲───────────────┘                                    │
│              │ inference (HTTP)                                    │
│   ┌──────────┴───────────────────────────────┐                   │
│   │  Eve runtime  (host process, `eve dev`)   │                   │
│   │   • TUI chat surface (input surface)      │                   │
│   │   • agent loop / "turns" (LLM reasoning)  │                   │
│   │   • Workflow SDK Local World → .workflow-data/  (disk)        │
│   │   • OUR ForgeVM sandbox adapter ◀── the centerpiece           │
│   └──────────┬────────────────────────────────┘                  │
│              │ sandbox ops (forgevm SDK → :7423)                  │
│   ┌──────────▼───────────────┐                                    │
│   │  ForgeVM daemon  :7423   │   host binary (the firecracker     │
│   │  firecracker provider    │   driver — NOT in Docker)          │
│   │  + warm pool (built-in)  │   data dir: /var/lib/forgevm       │
│   └──────────┬───────────────┘                                    │
│   ┌──────────▼───────────────┐                                    │
│   │  Firecracker microVM(s)  │   ephemeral; runs the pandas       │
│   │  kernel + pandas rootfs  │   /dev/kvm                         │
│   └──────────────────────────┘                                    │
└───────────────────────────────────────────────────────────────────┘
```

| Component | Runs as | Responsibility |
|---|---|---|
| Ollama | Compose container (+ model volume) | Local LLM. Free/near-free. One-line swap to a hosted model. |
| Eve runtime | Host process (`eve dev`) | Chat TUI, agent loop, durable turns, model config, the sandbox adapter. |
| ForgeVM daemon | **Host binary + KVM** | The firecracker driver: microVM lifecycle, exec, file I/O, snapshots, warm pool. |
| Firecracker microVM | Spawned by ForgeVM | Ephemeral executor for the agent's pandas code. |
| ForgeVM sandbox adapter | Our TS, in `agent/sandbox/` | Maps Eve's `SandboxSession` contract → `forgevm` SDK. **The crux.** |
| Data-analysis agent | Eve agent dir (`agent/`) | instructions + tool: CSV + question → pandas → exec → interpret stdout → answer. |

**Why ForgeVM runs on the host, not in Docker:** Firecracker microVMs need `/dev/kvm` and are
*not themselves containers*. ForgeVM's official Docker image only supports the `docker`/`mock`
providers — firecracker-in-a-container is undocumented and painful. So **Docker Compose holds
only persistent backing services Eve/the stack needs**; today that is just **Ollama** (Eve
needs no Postgres/queue locally — its durability is the filesystem Local World). ForgeVM +
firecracker run natively on the host. ForgeVM is treated as *the way Eve invokes firecracker*,
not as optional extra infra; its built-in warm pool is therefore available for free later.

**State on disk (no DB needed):** `.workflow-data/` (Eve turns), `/var/lib/forgevm`
(kernel/rootfs/snapshots + ForgeVM sqlite), and a Docker volume for Ollama models.

---

## The centerpiece: ForgeVM-backed Eve sandbox adapter

Eve's sandbox backend is pluggable via `defineSandbox({ backend })` (from `eve/sandbox`),
defaulting to Vercel Sandbox. A custom backend is an adapter object:
`{ name, create, prewarm? }` where `create` returns a **`SandboxSession`**.

- **Implement the `SandboxSession` contract** (these are the methods Eve's built-in tools and
  our code call — confirm exact signatures against the installed `node_modules/eve` types):
  `run({ command }) → { stdout, stderr, … }`, `spawn(options) → SandboxProcess`,
  `readTextFile`/`writeTextFile`, `readBinaryFile`/`writeBinaryFile`, `readFile`/`writeFile`
  (streaming), `removePath`, `resolvePath`, `setNetworkPolicy`. **Note: there is no `exec`
  method** — the model-facing `bash` tool maps to the session's `run`.
- Map that contract onto the `forgevm` TS SDK: `new Client({ baseUrl })`, `client.spawn(opts)`
  / `client.withSandbox(...)`, then per session: `run` → `sandbox.exec(cmd, { args, env,
  workdir, timeout })`, `writeTextFile` → `sandbox.writeFile(path, content)` (UTF-8 string over
  JSON — no volume mounts), `readTextFile` → `sandbox.readFile(path)`, teardown →
  `sandbox.destroy()`, plus pool APIs for later.
- Treat this adapter as the centerpiece and get it right.

> **Idiom note:** the sandbox is exposed to the model automatically as built-in tools (`bash`,
> `write_file`, `read_file`, `glob`, `grep`) — "a working sandbox exists by default, with
> nothing to author." So we do **NOT** hand-roll a custom code-execution tool; the model writes
> a script with `write_file` and runs it with `bash`. (Custom tools run in *our* app runtime
> with `process.env`, **not** in the sandbox, so an exec-tool would defeat isolation.)

---

## What the agent does (demo)

A **data-analysis agent**. The user provides a CSV and asks a question in natural language. The
agent writes a short Python/pandas snippet, executes it **in the firecracker microVM via
ForgeVM**, reads the real stdout, and reports the answer in natural language. Actual
computation happens in the sandbox, so a small/cheap LLM suffices — it writes a few lines of
pandas and interprets real output, never doing math in its head.

Worked example — `orders.csv`:

```csv
order_id,region,amount
1,North,120.50
2,South,87.00
3,North,200.00
4,East,50.25
5,South,310.75
```

Question: *"Which region had the highest average order value?"* → the agent generates:

```python
import pandas as pd
df = pd.read_csv("/workspace/data.csv")
print(df.groupby("region")["amount"].mean().idxmax())
```

→ microVM stdout `South` → agent replies *"South had the highest average order value (~$198.88)."*

**How the capability is structured (idiomatic):**
- The pandas know-how lives in a **skill** (`agent/skills/data-analysis/SKILL.md`), not a tool —
  *"tools execute; skills instruct."* It tells the model: write a pandas script with
  `write_file`, run it with `bash` (`python /workspace/analysis.py`), read stdout, answer.
- Execution uses Eve's **built-in sandbox tools** (`bash`, `write_file`, `read_file`) → our
  ForgeVM backend → firecracker microVM. No custom execution tool.
- **CSV input:** seed the sample CSV under **`agent/sandbox/workspace/`** (it mirrors to
  `/workspace/...` at session start and Eve auto-lists it to the model — same pattern the
  scaffold uses for its bundled dataset). For bring-your-own-CSV, add a thin typed
  `ingest_csv` tool that writes content into the sandbox via `ctx.getSandbox().writeTextFile`.
  (Eve has **no chat file-upload idiom** — no drag-and-drop CSV in the TUI.)

Ship a sample CSV (seeded under `agent/sandbox/workspace/`) and 2–3 example questions.

---

## Firecracker pandas rootfs (must be fast)

Boot/exec must return **promptly** — do **NOT** install packages on boot. Pre-build a rootfs
that already contains **python + pandas** baked in (build once via ForgeVM's
`scripts/build-rootfs.sh`, or confirm whether the firecracker provider can convert an OCI
`image:` arg to a rootfs). Lean on snapshot restore for speed. (See Known unknowns.)

---

## LLM cost constraint

Must be free or near-free. Default to a **local Ollama model** (small, e.g. `qwen2.5` /
`llama3.2`) running in Docker Compose. Eve's `model` accepts an AI SDK `LanguageModel`, so wire
Ollama via a provider package (`ollama-ai-provider`, or `@ai-sdk/openai-compatible` with
`baseURL: http://localhost:11434/v1`) — **bypassing the Vercel AI Gateway entirely** so it
stays fully local and free. Make swapping to a cheap hosted model a **one-line config change**
in `agent/agent.ts`, documented in the README.

---

## Repo requirements

- Single monorepo, runnable entirely locally; pnpm; keep it as simple as possible.
- Top-level `README.md` with exact setup steps, plus a `Makefile`/`scripts/`: one command to
  start ForgeVM, one to start Ollama (Compose), one to run the agent, and a `make dev` / `make
  up` that orchestrates everything.
- Sample CSV + 2–3 example questions.
- Pin all versions and note them (eve `0.11.7`, forgevm daemon `v0.1.2` / SDK `0.1.1`).
- **No CI/CD** for now (repo will live under `eddgrant` on GitHub).
- Add a `mock`/`docker` ForgeVM provider fallback in config + docs so the repo still works on
  machines without KVM — but **default to `firecracker`** since I have KVM.

---

## Iteration plan (build incrementally; verify at each checkpoint)

1. **Prove the firecracker primitive, Eve-free.** Run ForgeVM (`./scripts/setup.sh` →
   firecracker binary + kernel + pandas rootfs + `/dev/kvm` perms; `forgevm serve`). Then a
   ~20-line standalone TS script using the `forgevm` SDK: `spawn({ provider: "firecracker" })`
   → `writeFile("/workspace/data.csv", csv)` → `exec("python", ["-c", "...pandas..."])` →
   print real stdout → `destroy()`. **Checkpoint:** real answer from a real microVM → riskiest
   infra proven.
2. **Eve up on Ollama.** `npx eve@latest init`, configure the model to local Ollama, chat via
   `eve dev` against the default sandbox backend. **Checkpoint:** the agent talks.
3. **The adapter (centerpiece).** Read `eve/sandbox` `.d.ts`, implement the ForgeVM
   `SandboxBackend` (`SandboxSession` contract: `run`/`writeTextFile`/`readTextFile`/…), swap it
   in via `defineSandbox`. **Checkpoint:** Eve's built-in `bash` tool runs a command in a
   ForgeVM microVM.
4. **The data-analysis agent.** `instructions.md` + a `data-analysis` **skill** + sample CSV
   seeded under `agent/sandbox/workspace/` + example questions. Capability runs via Eve's
   built-in `write_file`/`bash` tools (no custom exec tool). **Checkpoint:** end-to-end NL
   question → correct answer. *(Optional: a typed `ingest_csv` tool for bring-your-own CSV.)*
5. **Warm pool (optional).** Turn on ForgeVM's built-in pool for faster repeat runs.

From iteration 3 onward, **each iteration ships its own tests** (see Testing strategy below).

---

## Testing strategy

**Principle: deterministic-first, evals for the rest.** Push as much as possible into fast,
exact, deterministic tests; use Eve's built-in evals for the irreducibly non-deterministic LLM
behaviour. A deliberate advantage of this design: because the computation is offloaded to
**deterministic pandas**, the agent's final answer is an **exact ground truth** — so we can
assert it exactly (`includes("South")`) instead of fuzzy/judge scoring.

### Layer 1 — Deterministic tests (the bulk; no LLM)

- **The ForgeVM adapter + plumbing (the centerpiece).** Integration tests that bypass the
  model entirely: spawn → `writeFile`/`writeTextFile` → `run`/`exec` → assert **exact stdout**,
  and assert the work really landed in a microVM (e.g. a kernel/hostname marker, as the
  iteration‑1 smoke already shows — `uname` reports the firecracker kernel). The `it1:smoke`
  script is the seed of this layer.
- **Any custom typed tool** (e.g. an `ingest_csv` tool) — unit-tested deterministically.
- **Runner:** `vitest` is preferred (run via `tsx` if appropriate).
- These are quick, repeatable, and CI-friendly; they catch the plumbing bugs, which is where
  most real defects live.

### Layer 2 — Eve evals (idiomatic; for agent behaviour)

Eve discovers `evals/**/*.eval.ts` (file path = eval id) and runs them with **`eve eval`**
(exit `0` all-pass / `1` failure / `2` config error; flags incl. `--list`, `--tag`,
`--strict`, `--timeout`, `--max-concurrency`). An eval boots/targets the **real agent server**
and drives the same HTTP surface users hit.

- **Shape:** `export default defineEval({ description, async test(t) { … } })`. Drive with
  `t.send(input)` → `t.reply` / `t.sessionId` / `t.events`; multi-turn by calling `t.send`
  repeatedly; fan out over a dataset by default-exporting an array (+ `loadYaml`/`loadJson`
  from `eve/evals/loaders`).
- **Assert deterministically (preferred):**
  - run-level: `t.completed()`, `t.calledTool("bash", { … })`, `t.notCalledTool`,
    `t.toolOrder`, `t.usedNoTools`, `t.maxToolCalls`, `t.noFailedActions`.
  - value: `t.check(value, builder)` with `includes` / `equals` / `matches` / `similarity`
    from `eve/evals/expect`. `includes`/`equals`/`matches` and run-level checks **gate** by
    default; `similarity` and judges are **soft**.
- **Judges (`t.judge.autoevals.*`) only when nothing deterministic fits.** They're LLM-graded
  (factuality/closedQA/summarizes/sql) and soft by default. String judge model ids route
  through the Vercel AI Gateway (needs `AI_GATEWAY_API_KEY`); **to stay free, configure the
  judge to our local Ollama** by passing an AI SDK `LanguageModel` in `evals/evals.config.ts`
  via `defineEvalConfig({ judge: { model } })`. With our exact answers, we should rarely need a
  judge.

### Practicalities for a stochastic local model

- The agent under test runs on Ollama, so outputs vary: treat evals as a **pass rate**, run
  each a handful of times, and don't trust a single green.
- Keep the eval set **small and fast**; the local 8B model is slow and shares a 4 GB GPU, so
  use a **low `--max-concurrency`** (≈1–2) to avoid VRAM/GPU contention.
- **Pin** model + versions so results are comparable; bump deliberately.
- **Grow a regression suite:** every observed failure becomes a new case.
- **Debug** eval failures via the event stream (`actions.requested` → `action.result` →
  `message.completed`) and `t.log` / `eve eval --verbose`.

### Per-iteration mapping

- **Iteration 3 (adapter):** deterministic integration tests that Eve's `bash`/`write_file`/
  `read_file` truly execute in a ForgeVM microVM (assert exact stdout + a microVM kernel
  marker), plus a small smoke eval (`t.completed()`, `t.calledTool`).
- **Iteration 4 (data agent):** evals over known-answer CSV questions
  (`t.check(t.reply, includes("South"))`, `t.calledTool("bash")`), plus a deterministic unit
  test for `ingest_csv` if added.
- **Iteration 5 (warm pool):** optional deterministic latency check.

---

## How I want you to work

- Re-verify install commands, the Eve sandbox-backend interface, and ForgeVM's API against the
  installed packages before integration code. Flag any place the real API differs from this
  spec.
- Call out explicitly any assumption you can't verify from docs/types.
- Build incrementally and tell me how to verify each step.

---

## Known unknowns / assumptions to confirm during the build

- **Exact `SandboxSession` method signatures** — not in Eve docs; read `node_modules/eve`
  (`eve/sandbox`) types before writing the adapter.
- **Firecracker rootfs ↔ `image:` mapping** — confirm how the firecracker provider gets pandas
  into the guest (build a custom rootfs vs. OCI→rootfs conversion). Pre-bake pandas regardless.
- **Ollama via AI SDK** — not stated in Eve docs; inferred from `model` accepting a
  `LanguageModel`. Confirm the provider package and `baseURL` wiring works.
- **forgevm npm (0.1.1) lags the daemon release (v0.1.2)** — watch for SDK/daemon API drift.
- **Binary file injection** — `writeFile` is UTF-8 string over JSON; fine for text CSVs, but
  binary inputs would need base64-via-exec. (Out of scope unless we add non-CSV inputs.)
- **No runtime file-upload idiom in Eve** — the `eve dev` TUI / HTTP session API document only
  text messages; no attachment mechanism. Demo CSV is seeded under `agent/sandbox/workspace/`;
  bring-your-own-CSV needs a typed `ingest_csv` tool. Re-confirm if a newer Eve adds uploads.