// Sample dataset seeded into every sandbox session at WORKSPACE_DATA_PATH.
//
// Our ForgeVM backend has no bootstrap/template snapshot, so we can't use Eve's
// `sandbox/workspace/` seed mechanism; instead the sandbox's `onSession` hook
// writes this content live (see sandbox.ts).
//
// This constant MIRRORS data/orders.csv (the human-facing sample, also used by
// the iteration-1 smoke script). test/seed.unit.test.ts guards that they stay
// in sync. Keeping the seed as an inline constant (rather than reading the file
// at runtime) makes seeding deterministic and independent of how Eve lays out
// the project snapshot in its dev-runtime.

/** Absolute path of the dataset inside the sandbox. */
export const WORKSPACE_DATA_PATH = "/workspace/data.csv";

/** Orders dataset. Ground-truth: "South" has the highest average `amount`. */
export const SAMPLE_CSV = `order_id,region,amount
1,North,120.50
2,South,87.00
3,North,200.00
4,East,50.25
5,South,310.75
6,East,75.00
7,North,90.00
8,South,140.00
`;
