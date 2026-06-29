import type { ExecOptions, ExecResult, SpawnOptions } from "forgevm";

export const DEFAULT_IMAGE = "forgevm-pandas:latest";

/** The pandas an LLM would generate for "which region has the highest average order value?". */
export const HIGHEST_AVG_REGION_PY = [
  "import pandas as pd",
  'df = pd.read_csv("/tmp/data.csv")',
  'print(df.groupby("region")["amount"].mean().idxmax())',
].join("\n");

// Narrow structural types so analyzeCsv depends only on the two sandbox
// operations it uses. The real forgevm Client/Sandbox satisfy these, and tests
// can pass trivial fakes — no need to mock the whole SDK.
export interface SandboxLike {
  writeFile(path: string, content: string, mode?: string): Promise<void>;
  exec(command: string, opts?: ExecOptions): Promise<ExecResult>;
}
export interface ClientLike {
  withSandbox<T>(opts: SpawnOptions, run: (sandbox: SandboxLike) => Promise<T>): Promise<T>;
}

export interface AnalyzeOptions {
  /** CSV content to make available to the analysis at `csvPath`. */
  csv: string;
  /** Python source to run; it should read the CSV from `csvPath`. */
  code: string;
  image?: string;
  provider?: string;
  csvPath?: string;
  scriptPath?: string;
}

/**
 * Run a Python/pandas program against a CSV inside a fresh ForgeVM sandbox and
 * return its trimmed stdout. Throws if the program exits non-zero (with stderr
 * in the message). The sandbox is always torn down (via `withSandbox`).
 *
 * This is the deterministic execution path the Eve sandbox adapter will later
 * wrap: host CSV -> sandbox -> exec -> stdout.
 */
export async function analyzeCsv(client: ClientLike, opts: AnalyzeOptions): Promise<string> {
  const csvPath = opts.csvPath ?? "/tmp/data.csv";
  const scriptPath = opts.scriptPath ?? "/tmp/analysis.py";

  return client.withSandbox(
    { image: opts.image ?? DEFAULT_IMAGE, provider: opts.provider ?? "firecracker" },
    async (sandbox) => {
      await sandbox.writeFile(csvPath, opts.csv);
      await sandbox.writeFile(scriptPath, opts.code);

      const result = await sandbox.exec(`python3 ${scriptPath}`);
      if (result.exit_code !== 0) {
        throw new Error(`analysis exited ${result.exit_code}: ${result.stderr.trim()}`);
      }
      return result.stdout.trim();
    },
  );
}
