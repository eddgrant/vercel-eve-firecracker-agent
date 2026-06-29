import { describe, it, expect, vi } from "vitest";
import type { ExecResult } from "forgevm";
import { analyzeCsv, type ClientLike, type SandboxLike } from "../lib/forgevm-analysis.js";

// A fake ForgeVM client whose sandbox returns a canned exec result. We assert on
// what analyzeCsv *returns/throws* (its observable contract), not on how it wires
// the SDK calls together.
function clientReturning(result: ExecResult): ClientLike {
  const sandbox: SandboxLike = {
    writeFile: vi.fn(async () => {}),
    exec: vi.fn(async () => result),
  };
  return {
    withSandbox: (_opts, run) => run(sandbox),
  };
}

const ok = (stdout: string): ExecResult => ({ exit_code: 0, stdout, stderr: "", duration: "1ms" });
const fail = (stderr: string): ExecResult => ({ exit_code: 1, stdout: "", stderr, duration: "1ms" });

describe("analyzeCsv", () => {
  it("returns the analysis stdout, trimmed", async () => {
    const answer = await analyzeCsv(clientReturning(ok("South\n")), {
      csv: "region,amount\nSouth,1",
      code: "print('ignored by the fake')",
    });
    expect(answer).toBe("South");
  });

  it("throws with stderr when the analysis exits non-zero", async () => {
    await expect(
      analyzeCsv(clientReturning(fail("Traceback: KeyError 'region'\n")), {
        csv: "x",
        code: "raise SystemExit(1)",
      }),
    ).rejects.toThrow(/exited 1: Traceback: KeyError 'region'/);
  });
});
