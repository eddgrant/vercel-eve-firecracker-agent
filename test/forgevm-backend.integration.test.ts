import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { forgevmBackend } from "../agent/sandbox/forgevm-backend.js";
import type { SandboxBackendHandle } from "eve/sandbox";

// Drives the real backend against a live ForgeVM daemon: this proves Eve's
// SandboxSession operations actually execute inside a Firecracker microVM.
// Opt-in (needs the daemon + KVM):  pnpm test:it
describe.skipIf(!process.env.RUN_FORGEVM_IT)(
  "forgevmBackend against a real Firecracker microVM",
  () => {
    const backend = forgevmBackend();
    let handle: SandboxBackendHandle;

    beforeAll(async () => {
      handle = await backend.create({
        templateKey: null,
        sessionKey: "it-test",
        runtimeContext: { appRoot: process.cwd() },
      });
    }, 60_000);

    afterAll(async () => {
      await handle?.dispose();
    });

    it("runs a command inside a microVM with its own kernel", async () => {
      const result = await handle.session.run({ command: "uname -r" });
      expect(result.exitCode).toBe(0);
      // The Firecracker quickstart kernel is 4.14.x — proof this isn't the host.
      expect(result.stdout).toContain("4.14");
    }, 60_000);

    it("round-trips a file via writeTextFile / readTextFile", async () => {
      await handle.session.writeTextFile({ path: "hello.txt", content: "hi from eve\n" });
      expect(await handle.session.readTextFile({ path: "hello.txt" })).toBe("hi from eve\n");
    }, 60_000);

    it("makes written files visible to the shell (write_file -> bash)", async () => {
      await handle.session.writeTextFile({ path: "marker.txt", content: "marker-42" });
      const result = await handle.session.run({ command: "cat /workspace/marker.txt" });
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("marker-42");
    }, 60_000);

    it("runs pandas inside the microVM (the end goal)", async () => {
      await handle.session.writeTextFile({
        path: "data.csv",
        content: "region,amount\nNorth,10\nSouth,99\n",
      });
      await handle.session.writeTextFile({
        path: "analysis.py",
        content:
          'import pandas as pd\nprint(pd.read_csv("/workspace/data.csv").groupby("region")["amount"].mean().idxmax())',
      });
      const result = await handle.session.run({ command: "python3 /workspace/analysis.py" });
      expect(result.exitCode).toBe(0);
      expect(result.stdout.trim()).toBe("South");
    }, 60_000);
  },
);
