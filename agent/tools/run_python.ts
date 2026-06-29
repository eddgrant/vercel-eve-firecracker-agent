import { defineTool } from "eve/tools";
import { z } from "zod";

// A single tool that writes a Python script into the Firecracker microVM AND runs
// it, returning the output — in ONE model tool call.
//
// Why this exists: small local models (e.g. qwen2.5:7b-instruct) reliably make a
// FIRST tool call but won't chain a SECOND one. With the built-in write_file +
// bash flow they write the script and then hallucinate the answer instead of
// running it. Collapsing write-then-run into one tool removes the step they fail
// at. The write-then-run still happens inside the VM exactly as before — it's just
// orchestrated deterministically here rather than relying on the model to chain.
const SCRIPT_PATH = "/workspace/analysis.py";

// Each call runs a FRESH python3 process, so nothing persists between calls and
// there's no implicit pandas import. We prepend a DATA-AGNOSTIC loader: every CSV
// in /workspace becomes a DataFrame in `frames` (keyed by filename stem) and a
// same-named global. This keeps the agent instructions generic (no hardcoded
// schema) and lets any dataset dropped into the sandbox just work — the model
// discovers names/columns at runtime. The model only writes the analysis.
// NB: top-level lines stay flush-left (real Python); the loop body is indented as
// Python requires.
const PREAMBLE = `import pandas as pd
import glob, os, sys

frames = {}
for _p in sorted(glob.glob("/workspace/*.csv")):
    _n = os.path.splitext(os.path.basename(_p))[0]
    frames[_n] = pd.read_csv(_p)
    globals()[_n] = frames[_n]
print("Available datasets:", {_k: list(_v.columns) for _k, _v in frames.items()}, file=sys.stderr)
`;

export default defineTool({
  description:
    "Run Python in the data sandbox and return stdout/stderr/exit code. pandas is " +
    "imported as `pd`, and every dataset in the sandbox is preloaded as a DataFrame " +
    "in the dict `frames` (name -> DataFrame; each also a same-named variable). " +
    "Print the dataset names/columns to discover the structure, then compute the " +
    "answer and print() it. This is the ONLY way to compute an answer; call it, " +
    "then read stdout. Do not answer before calling it.",
  inputSchema: z.object({
    code: z
      .string()
      .describe(
        "Python to run. `pd` and the preloaded `frames` (dict of name->DataFrame, each " +
          "also a same-named variable) are already defined. print() a single clear " +
          "result. Do not re-add imports or read_csv calls.",
      ),
  }),
  async execute({ code }, ctx) {
    const sandbox = await ctx.getSandbox();
    // Prepend the loader so `pd` and `frames` (+ same-named DataFrames) are defined.
    const script = `${PREAMBLE}\n${code}`;
    // 1. write the script into the microVM
    await sandbox.writeTextFile({ path: SCRIPT_PATH, content: script });
    // 2. run it in the same microVM
    const { exitCode, stdout, stderr } = await sandbox.run({
      command: `python3 ${SCRIPT_PATH}`,
    });
    // On failure, dump the full script + stderr to the server log stream. The
    // TUI's inline tool summary truncates these; this prints them untruncated,
    // visible in the TUI via Ctrl+L ("stderr"/"all" log mode). Fires only on a
    // non-zero exit, so it's silent on the happy path / in the default log mode.
    if (exitCode !== 0) {
      // eslint-disable-next-line no-console
      console.error(
        `[run_python] exit=${exitCode}\n----- script -----\n${script}\n----- stderr -----\n${stderr}\n------------------`,
      );
    }
    return { exitCode, stdout, stderr };
  },
});
