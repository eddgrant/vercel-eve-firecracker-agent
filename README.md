# vercel-eve-firecracker-agent

A small, sandboxed **data-analysis AI agent** that runs entirely on your own
machine. You give it a CSV and ask a question in plain English; it writes a few
lines of [pandas](https://pandas.pydata.org/), runs that code inside a real
**Firecracker microVM**, reads the actual output, and answers.

It was built as a learning spike to evaluate [**Eve**](https://eve.dev), Vercel's
agent framework, and to see whether the whole development lifecycle, including a
genuinely isolated, ephemeral code sandbox, could run locally on an ordinary
laptop. It is a proof of concept, not production software.

The interesting design choice: the model never does the arithmetic. It only
writes pandas and reads the result, so a small, cheap, local model is good
enough, and because pandas gives an exact answer you can test the agent
precisely rather than fuzzily grading it.

```
You: which region had the highest average order value?
Agent: South, with an average of about $198.88.   (computed in a microVM, not guessed)
```

---

## How it works

Three planes, all on one machine:

```
┌──────────── Your machine (Linux + KVM) ───────────┐
│  Ollama (local LLM)  ◀── inference                │
│        ▲                                          │
│        │                                          │
│  Eve runtime  ── the agent loop, tools, evals     │
│        │  (custom sandbox adapter)                │
│        ▼                                          │
│  ForgeVM ──▶ Firecracker microVM                  │
│             (runs the agent's pandas, then dies)  │
└───────────────────────────────────────────────────┘
```

- **[Eve](https://eve.dev)** runs the agent loop (a "turn") in a host process.
  Its built-in `bash`/`write_file`/`read_file` tools, and a custom `run_python`
  tool, are routed into a sandbox.
- **[ForgeVM](https://github.com/DohaerisAI/forgevm)** is a single Go binary that
  drives **[Firecracker](https://firecracker-microvm.github.io/)** microVMs over a
  local REST API. A custom Eve sandbox backend (`agent/sandbox/forgevm-backend.ts`)
  maps Eve's sandbox contract onto it, so the agent's code executes in a real,
  hardware-isolated microVM that spins up just in time and is torn down after.
- **[Ollama](https://ollama.com/)** serves a local, OpenAI-compatible model.

### Why this split

- **Persistent services run in Docker Compose** so the stack is portable and the
  only thing you need is `docker compose`. Today that is just Ollama (the model)
  and, optionally, Jaeger (for traces). Eve needs no database or queue locally;
  its durability is a folder on disk (`.workflow-data/`).
- **ForgeVM and Firecracker run natively on the host**, not in Docker, because
  Firecracker microVMs need `/dev/kvm` and are not themselves containers.
  Running them on the host is what makes the just-in-time, low-footprint
  microVM execution possible, and mirrors how ephemeral cloud functions behave.

---

## Prerequisites

You need the following installed already (this repo will not install system
software for you):

- **Linux on x86_64 with KVM enabled** (`/dev/kvm` must exist) — required for
  real Firecracker microVMs.
- **Docker** (running, with your user in the `docker` group) and **Docker Compose**.
- **Node.js 24** and **pnpm** — exact versions are pinned in
  [`.tool-versions`](./.tool-versions) (handy if you use [asdf](https://asdf-vm.com/)).
- **curl** and **tar** (used by the bootstrap script).
- An **NVIDIA GPU** is optional. The Ollama container will use one if present
  (see the GPU block in `docker-compose.yml`); comment that block out if you
  don't have one. A small local model is slow without a GPU.

No cloud account or API key is needed for the default, fully local setup.

---

## Getting started

### 1. Clone and install dependencies

```bash
git clone https://github.com/eddgrant/vercel-eve-firecracker-agent.git
cd vercel-eve-firecracker-agent
pnpm install
```

### 2. Bootstrap the microVM runtime (one time)

This downloads Firecracker, the guest kernel, and the ForgeVM binaries into a
local `.forgevm/` directory, then builds the python+pandas rootfs the microVMs
boot from. It is idempotent, so it's safe to re-run.

```bash
pnpm run setup
```

> Use `pnpm run setup`, **not** `pnpm setup` — `setup` is a built-in pnpm command
> (it configures pnpm's own home directory and edits your shell rc file), so
> `pnpm setup` will *not* run this project's bootstrap script.

When it finishes you should see `Bootstrap complete`, and `.forgevm/bin/` should
contain `firecracker`, `forgevm`, and `forgevm-agent`.

### 3. Start the local model

Start Ollama, pull the base model, and build the tuned `data-analyst` model
(`qwen2.5:7b-instruct` with `temperature 0` and a 16k context window, which makes
a small model a far more reliable tool-caller):

```bash
pnpm ollama:up
pnpm ollama:pull
pnpm ollama:model
```

Then create your local config:

```bash
cp .env.example .env
```

`.env.example` already selects the local `data-analyst` model
(`OLLAMA_MODEL=data-analyst`), so the copied `.env` works out of the box — just make
sure you built that model in the step above. To use a different local model or a
hosted provider instead, edit `.env`.

> **Why port 11435?** Ollama's default port is `11434`. To keep this stack portable,
> the Dockerised Ollama is published on **`11435`** (the `11435:11434` mapping in
> `docker-compose.yml`) so it won't clash with an Ollama you may already be running
> natively on `11434` — the two can coexist, and this project won't disturb your host
> setup. Eve therefore defaults `OLLAMA_BASE_URL` to `http://localhost:11435` to match.
> If you have no native Ollama and prefer the standard port, you can remap to
> `11434:11434` — but then set `OLLAMA_BASE_URL` in `.env` to match, or the agent
> won't be able to reach the model.

### 4. Start the ForgeVM daemon

In its own terminal (it stays running):

```bash
pnpm forgevm:serve
```

### 5. Run the agent

In another terminal:

```bash
pnpm dev
```

This opens Eve's chat TUI. Try one of the example questions below. The agent
will write pandas, run it in a microVM, and answer.

---

## Example questions

The repo seeds a couple of sample datasets into each sandbox session:

- **`orders.csv`** (a tiny sales table):
  - *"Which region had the highest average order value?"* → `South`
- **A synthetic org dataset** (`offices`, `employees`, `portfolios`, `assignments`):
  - *"Which portfolio has the highest number of employees?"* → `Nakatomi Growth`
  - *"And which employee in that portfolio has the highest salary?"* → `Aisha Adeyemi`

---

## Testing

The correctness guarantees live in fast, deterministic tests; the evals exercise
the (non-deterministic) agent behaviour.

```bash
pnpm test          # unit tests (no model, no microVM)
pnpm test:it       # integration tests against a real microVM (slower)
pnpm eval          # Eve evals: drive the real agent end to end
pnpm eval data-analysis   # run a single eval by name
```

Evals run the live model, so treat them as a pass-rate signal rather than a hard
gate, especially on a small local model. On a 7B local model a single eval can
take a few minutes per turn — that's slow, not stuck. If `pnpm eval` or `pnpm dev`
seems to hang indefinitely, the usual cause is that the ForgeVM daemon
(`pnpm forgevm:serve`) or the Ollama model isn't up; check both, or run with
`EVE_LOG_LEVEL=debug` to see where the turn is waiting.

---

## Using a hosted model instead (optional)

The agent is provider-agnostic. To swap the local model for any OpenAI-compatible
hosted provider (for faster, more reliable tool-calling), set `LLM_BASE_URL`,
`LLM_API_KEY`, and `LLM_MODEL` in `.env`. Ready-to-use blocks for several free
tiers (Groq, Gemini, OpenRouter, Cerebras) are in [`.env.example`](./.env.example).

---

## Observability (optional)

Eve is OpenTelemetry-instrumented. To view traces (model/tool spans, durations,
token usage):

```bash
docker compose up -d jaeger
# then set in .env:  OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318
```

Open the Jaeger UI at http://localhost:16686. For diagnosing a *hung* turn, use
`EVE_LOG_LEVEL=debug` instead (spans only flush when a span ends).

---

## Stopping and cleaning up

```bash
pnpm stop            # stop the dev server, ForgeVM daemon, and Compose services
pnpm forgevm:clean   # destroy any leftover microVMs
pnpm clean           # also wipe Eve/Workflow local state (.eve, .workflow-data, ...)
```

---

## Project layout

```
agent/
  agent.ts                 # model + runtime config
  instructions.md          # the system prompt (Markdown)
  tools/run_python.ts      # custom tool: write + run a script in the microVM, one call
  sandbox/
    forgevm-backend.ts     # the centrepiece: Eve sandbox contract -> ForgeVM SDK
    sandbox.ts             # wires the backend in and seeds the sample data
    org-dataset.ts         # deterministic synthetic org data generator
  channels/eve.ts          # how the agent is exposed
evals/                     # *.eval.ts — Eve evals (single- and multi-turn)
microvm/Dockerfile         # the python + pandas rootfs the microVMs boot from
scripts/                   # setup, ForgeVM serve/clean, rootfs build, helpers
data/                      # the sample CSVs (committed copies of the seeded data)
docker-compose.yml         # Ollama (+ optional Jaeger)
```

---

## Pinned versions

Eve `0.11.7` · ForgeVM daemon `v0.1.2` / SDK `0.1.1` · Firecracker `v1.16.0` ·
guest kernel `vmlinux.bin` (Firecracker quickstart) · Node `24`.

---

## Caveats

This is a throwaway learning spike, not production software. A few honest limits:

- Small local models (7B on a 4GB GPU) are unreliable agentic tool-callers.
  Single-frame aggregations work well; multi-table joins and multi-turn reasoning
  are flaky. A more capable (hosted) model passes those reliably.
- No soak or performance testing; microVM housekeeping (TTL eviction, etc.) is
  only lightly exercised.
- Eve is pre-1.0 and moving fast — expect occasional rough edges.

---

## Licence

[MIT](./LICENSE) © Edd Grant
