// Emit the synthetic org dataset to data/*.csv from the shared generator
// (agent/sandbox/org-dataset.ts). Re-runnable: deterministic seed => identical
// files. The same generator seeds the sandbox at runtime (agent/sandbox/seed.ts),
// so these committed CSVs match what the agent queries.
//
//   pnpm gen:org-data
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { generateOrgDataset } from "../agent/sandbox/org-dataset.ts";

const ds = generateOrgDataset();
const root = join(dirname(fileURLToPath(import.meta.url)), "..");

for (const [name, csv] of Object.entries(ds.csv)) {
  writeFileSync(join(root, "data", `${name}.csv`), csv);
  console.log(`wrote data/${name}.csv (${csv.trim().split("\n").length - 1} rows)`);
}

// Referential-integrity sanity check (fails loudly if generation drifts).
const offIds = new Set(ds.offices.map((o) => o.office_id));
const empIds = new Set(ds.employees.map((e) => e.employee_id));
const pfIds = new Set(ds.portfolios.map((p) => p.portfolio_id));
const badOffice = ds.employees.filter((e) => !offIds.has(e.office_id)).length;
const badMgr = ds.employees.filter((e) => e.manager_id && !empIds.has(e.manager_id)).length;
const badAE = ds.assignments.filter((a) => !empIds.has(a.employee_id)).length;
const badAP = ds.assignments.filter((a) => !pfIds.has(a.portfolio_id)).length;
console.log(`FK check -> badOffice=${badOffice} badManager=${badMgr} badAssignEmp=${badAE} badAssignPf=${badAP}`);
if (badOffice || badMgr || badAE || badAP) process.exit(1);
