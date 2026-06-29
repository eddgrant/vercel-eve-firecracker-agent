/**
 * Iteration 1 — prove the Firecracker primitive, with NO Eve involved.
 *
 * A plain standalone demo of the path the Eve sandbox adapter will later wrap:
 * read a CSV from the host, run the pandas an LLM would generate inside a real
 * Firecracker microVM (ForgeVM `firecracker` provider), and report the real
 * stdout. The actual work lives in lib/forgevm-analysis.ts (also exercised by
 * the tests).
 *
 * Run:  pnpm it1:smoke            (uses data/orders.csv)
 *       pnpm it1:smoke <csv-path>
 *
 * Requires the ForgeVM daemon on http://127.0.0.1:7423 (pnpm forgevm:serve).
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Client, ConnectionError } from "forgevm";
import { analyzeCsv, HIGHEST_AVG_REGION_PY } from "../lib/forgevm-analysis.js";

const here = dirname(fileURLToPath(import.meta.url));
const csvPath = process.argv[2] ?? join(here, "..", "data", "orders.csv");
const csv = readFileSync(csvPath, "utf8");

const QUESTION = "Which region had the highest average order value?";
const client = new Client({ baseUrl: "http://127.0.0.1:7423" });

async function main() {
  const health = await client.health();
  console.log(`ForgeVM ${health.version} (${health.status})`);

  const answer = await analyzeCsv(client, { csv, code: HIGHEST_AVG_REGION_PY });

  console.log(`\nCSV: ${csvPath}`);
  console.log(`Q:   ${QUESTION}`);
  console.log(`A:   ${answer}`);
}

main().catch((err) => {
  if (err instanceof ConnectionError) {
    console.error(
      "Could not reach ForgeVM at http://127.0.0.1:7423 — is the daemon running? (pnpm forgevm:serve)",
    );
  } else {
    console.error(err);
  }
  process.exitCode = 1;
});
