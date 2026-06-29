import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { SAMPLE_CSV, WORKSPACE_DATA_PATH } from "../agent/sandbox/seed.js";
import { generateOrgDataset, ORG_PATHS } from "../agent/sandbox/org-dataset.js";

// Guards that the inlined seed constant stays in sync with the human-facing
// sample file (data/orders.csv). If someone edits one without the other, this
// fails — keeping the eval's ground truth ("South") and the demo data honest.
describe("sandbox seed", () => {
  it("mirrors data/orders.csv", () => {
    const ordersCsv = readFileSync(
      fileURLToPath(new URL("../data/orders.csv", import.meta.url)),
      "utf8",
    );
    expect(SAMPLE_CSV.trim()).toBe(ordersCsv.trim());
  });

  it("targets the workspace data path", () => {
    expect(WORKSPACE_DATA_PATH).toBe("/workspace/data.csv");
  });
});

// The org dataset is generated deterministically (agent/sandbox/org-dataset.ts) and
// both seeds the sandbox and writes data/*.csv (via scripts/gen-org-data.mts). These
// guard that the committed CSVs match the generator (run `pnpm gen:org-data` if this
// fails) and that the synthetic data is referentially sound.
describe("org dataset", () => {
  const ds = generateOrgDataset();

  it.each(["offices", "employees", "portfolios", "assignments"] as const)(
    "mirrors data/%s.csv",
    (name) => {
      const csv = readFileSync(fileURLToPath(new URL(`../data/${name}.csv`, import.meta.url)), "utf8");
      expect(ds.csv[name].trim()).toBe(csv.trim());
    },
  );

  it("has referential integrity (offices, managers, assignments)", () => {
    const offIds = new Set(ds.offices.map((o) => o.office_id));
    const empIds = new Set(ds.employees.map((e) => e.employee_id));
    const pfIds = new Set(ds.portfolios.map((p) => p.portfolio_id));
    expect(ds.employees.every((e) => offIds.has(e.office_id))).toBe(true);
    expect(ds.employees.every((e) => e.manager_id === "" || empIds.has(e.manager_id))).toBe(true);
    expect(ds.assignments.every((a) => empIds.has(a.employee_id) && pfIds.has(a.portfolio_id))).toBe(true);
  });

  it("seeds the org tables to /workspace paths", () => {
    expect(ORG_PATHS.employees).toBe("/workspace/employees.csv");
    expect(ORG_PATHS.assignments).toBe("/workspace/assignments.csv");
  });
});
