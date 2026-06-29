import { defineSandbox } from "eve/sandbox";
// NB: `.ts` extension (not `.js`) is deliberate. Eve's dev-runtime imports this
// entrypoint as a .ts module but won't remap a sibling `./forgevm-backend.js`
// specifier to its .ts source, so the relative import must name the .ts file.
// (allowImportingTsExtensions in tsconfig.json permits this for type-checking.)
import { forgevmBackend } from "./forgevm-backend.ts";
import { SAMPLE_CSV, WORKSPACE_DATA_PATH } from "./seed.ts";
import { generateOrgDataset, ORG_PATHS } from "./org-dataset.ts";

// Generated once at module load (deterministic) — same content the committed
// data/*.csv files hold (see scripts/gen-org-data.mts).
const ORG = generateOrgDataset();

// Route the agent's sandbox (and therefore Eve's built-in bash/read_file/
// write_file/glob/grep tools) into a local ForgeVM Firecracker microVM.
export default defineSandbox({
  backend: forgevmBackend(),

  // Seed the sample datasets into the sandbox. Our backend has no bootstrap/
  // template snapshot, so we seed live here rather than via Eve's
  // `sandbox/workspace/` mechanism. Idempotent per file: only writes when absent,
  // so a user-supplied file in the same session isn't clobbered.
  async onSession({ use }) {
    const session = await use();
    const seedIfAbsent = async (path: string, content: string) => {
      const existing = await session.readTextFile({ path });
      if (existing === null) await session.writeTextFile({ path, content });
    };
    // The original single-table orders dataset (df).
    await seedIfAbsent(WORKSPACE_DATA_PATH, SAMPLE_CSV);
    // The relational org dataset (offices / employees / portfolios / assignments).
    await seedIfAbsent(ORG_PATHS.offices, ORG.csv.offices);
    await seedIfAbsent(ORG_PATHS.employees, ORG.csv.employees);
    await seedIfAbsent(ORG_PATHS.portfolios, ORG.csv.portfolios);
    await seedIfAbsent(ORG_PATHS.assignments, ORG.csv.assignments);
  },
});
