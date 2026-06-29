import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect, beforeAll } from "vitest";
import { Client } from "forgevm";
import { analyzeCsv, HIGHEST_AVG_REGION_PY } from "../lib/forgevm-analysis.js";

// Real Firecracker microVM — opt-in, since it needs the ForgeVM daemon + KVM:
//   pnpm test:it
// It asserts the actual outcome (the computed answer), end to end.
const here = dirname(fileURLToPath(import.meta.url));
const csv = readFileSync(join(here, "..", "data", "orders.csv"), "utf8");
const client = new Client({ baseUrl: "http://127.0.0.1:7423" });

describe.skipIf(!process.env.RUN_FORGEVM_IT)(
  "analyzeCsv against a real Firecracker microVM",
  () => {
    beforeAll(async () => {
      // Fail fast with a clear message if the daemon isn't running.
      await client.health();
    });

    it("computes the region with the highest average order value", async () => {
      const answer = await analyzeCsv(client, { csv, code: HIGHEST_AVG_REGION_PY });
      expect(answer).toBe("South");
    }, 60_000);
  },
);
