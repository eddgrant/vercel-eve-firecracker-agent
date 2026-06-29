// Destroy ALL active ForgeVM sandboxes (and their Firecracker microVMs).
//
// `eve eval` spawns a microVM per eval session but never tears the session down,
// so repeated eval runs leak VMs until their TTL expires. This reaps them
// immediately. Run standalone with `pnpm forgevm:clean`, or automatically after
// `pnpm eval` (see scripts/eval.sh).
import { Client } from "forgevm";

const client = new Client({ baseUrl: process.env.FORGEVM_BASE_URL ?? "http://127.0.0.1:7423" });

let sandboxes;
try {
  sandboxes = await client.list();
} catch (error) {
  // Daemon not running / unreachable — nothing to clean.
  console.log(`forgevm:clean — daemon unreachable, skipping (${(error as Error).message})`);
  process.exit(0);
}

let destroyed = 0;
for (const sb of sandboxes) {
  try {
    await (await client.get(sb.id)).destroy();
    destroyed++;
  } catch {
    // already gone / racing another reaper — ignore
  }
}
console.log(`forgevm:clean — destroyed ${destroyed}/${sandboxes.length} sandbox(es)`);
