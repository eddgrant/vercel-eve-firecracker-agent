// Deterministic synthetic "consultancy org" dataset: offices, employees,
// portfolios, and the employee↔portfolio assignments junction.
//
// Pure code (a seeded PRNG) so it produces byte-identical CSVs every run with no
// file reads — used BOTH to seed the sandbox at runtime (agent/sandbox/seed.ts)
// and to emit the human-facing files under data/ (scripts/gen-org-data.mts). That
// shared source of truth keeps the seeded VM data and the committed CSVs in sync,
// and (being read-free) runs fine inside Eve's dev-runtime.
//
// Relationships for the agent to query:
//   employees.office_id   -> offices.office_id      (many-to-one)
//   employees.manager_id  -> employees.employee_id  (many-to-one, self-referential, nullable)
//   assignments.(employee_id, portfolio_id)         (many-to-many junction; extra cols: role, allocation_pct)

/** Absolute paths of each table inside the sandbox. */
export const ORG_PATHS = {
  offices: "/workspace/offices.csv",
  employees: "/workspace/employees.csv",
  portfolios: "/workspace/portfolios.csv",
  assignments: "/workspace/assignments.csv",
} as const;

// --- deterministic PRNG (mulberry32) — fixed seed => stable output ---
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const toCsv = (header: readonly string[], rows: (string | number)[][]): string =>
  [header.join(","), ...rows.map((r) => r.join(","))].join("\n") + "\n";

interface Office { office_id: string; office_name: string; city: string; country: string; region: string; }
interface Employee { employee_id: string; full_name: string; title: string; department: string; office_id: string; manager_id: string; hire_date: string; salary: number; }
interface Portfolio { portfolio_id: string; portfolio_name: string; client: string; sector: string; status: string; budget: number; }
interface Assignment { employee_id: string; portfolio_id: string; role: string; allocation_pct: number; }

export interface OrgDataset {
  offices: Office[];
  employees: Employee[];
  portfolios: Portfolio[];
  assignments: Assignment[];
  csv: { offices: string; employees: string; portfolios: string; assignments: string };
}

const OFFICES: readonly Office[] = [
  { office_id: "OFF-LON", office_name: "London", city: "London", country: "UK", region: "EMEA" },
  { office_id: "OFF-MAN", office_name: "Manchester", city: "Manchester", country: "UK", region: "EMEA" },
  { office_id: "OFF-BER", office_name: "Berlin", city: "Berlin", country: "Germany", region: "EMEA" },
  { office_id: "OFF-NYC", office_name: "New York", city: "New York", country: "USA", region: "AMER" },
  { office_id: "OFF-SFO", office_name: "San Francisco", city: "San Francisco", country: "USA", region: "AMER" },
  { office_id: "OFF-TOR", office_name: "Toronto", city: "Toronto", country: "Canada", region: "AMER" },
  { office_id: "OFF-SIN", office_name: "Singapore", city: "Singapore", country: "Singapore", region: "APAC" },
  { office_id: "OFF-SYD", office_name: "Sydney", city: "Sydney", country: "Australia", region: "APAC" },
];

const FIRST = ["Alex","Sam","Jordan","Taylor","Morgan","Priya","Wei","Hiro","Sofia","Liam","Noah","Emma","Olivia","Aisha","Omar","Chen","Yuki","Diego","Lucas","Mia","Ava","Ethan","Maya","Raj","Nina","Pablo","Ingrid","Tariq","Lena","Marco","Hannah","Felix","Zara","Ivan","Clara","Theo","Nora","Kai","Anya","Bruno","Elena","Gabriel","Layla","Viktor","Rosa","Dmitri","Amara","Finn","Saoirse","Mateo"];
const LAST = ["Smith","Patel","Nguyen","Tanaka","Garcia","Mueller","Rossi","Kowalski","Andersson","Okafor","Khan","Silva","Costa","Dubois","Ivanov","Yamamoto","Lopez","Schmidt","Novak","Haddad","Reyes","Kim","Walsh","Becker","Moretti","Singh","Larsson","Mensah","Romano","Petrov","Fischer","Marino","Bauer","Carter","Nakamura","Oliveira","Hassan","Lindqvist","Dasgupta","Vargas","Berg","Cohen","Murphy","Sato","Dimitrov","Adeyemi","Weber","Conti","Park","Flores"];

const DEPARTMENTS = ["Engineering","Consulting","Sales","Operations","Finance","People"] as const;
const SALARY_BASE: Record<string, number> = { Engineering: 95000, Consulting: 88000, Sales: 80000, Operations: 70000, Finance: 85000, People: 68000, Executive: 180000 };
const SECTORS = ["Healthcare","Financial Services","Retail","Public Sector","Technology","Energy","Manufacturing","Media"];
const CLIENTS = ["Acme","Globex","Initech","Umbrella","Soylent","Stark","Wayne","Wonka","Hooli","Pied Piper","Cyberdyne","Tyrell","Massive Dynamic","Vandelay","Gekko Capital","Oscorp","Nakatomi","Bluth","Prestige","Dunder"];
const PORTFOLIO_SUFFIX = ["Transformation","Migration","Platform","Growth","Analytics","Modernization","Expansion","Optimization","Launch","Integration"];
const STATUSES = ["Active","Active","Active","On Hold","Completed"]; // weighted toward Active

export function generateOrgDataset(): OrgDataset {
  const rnd = mulberry32(20260625);
  const pick = <T>(arr: readonly T[]): T => arr[Math.floor(rnd() * arr.length)];
  const int = (lo: number, hi: number) => lo + Math.floor(rnd() * (hi - lo + 1));
  const pad = (n: number, w: number) => String(n).padStart(w, "0");

  // ---- employees (with self-referential manager hierarchy) ----
  const employees: Employee[] = [];
  const usedNames = new Set<string>();
  const uniqueName = (): string => {
    for (;;) {
      const n = `${pick(FIRST)} ${pick(LAST)}`;
      if (!usedNames.has(n)) { usedNames.add(n); return n; }
    }
  };
  const hireDate = () => `20${pad(int(15, 24), 2)}-${pad(int(1, 12), 2)}-${pad(int(1, 28), 2)}`;
  const salaryFor = (dept: string, mult: number) =>
    Math.round(((SALARY_BASE[dept] ?? 75000) * mult + int(-6000, 9000)) / 500) * 500;

  const TOTAL = 150;
  // CEO
  employees.push({ employee_id: "EMP-001", full_name: uniqueName(), title: "Chief Executive Officer", department: "Executive", office_id: "OFF-LON", manager_id: "", hire_date: hireDate(), salary: salaryFor("Executive", 1) });
  // department heads report to the CEO; they are the senior anchor per department
  const headByDept: Record<string, string> = {};
  let seq = 2;
  for (const dept of DEPARTMENTS) {
    const id = `EMP-${pad(seq++, 3)}`;
    headByDept[dept] = id;
    employees.push({ employee_id: id, full_name: uniqueName(), title: `Head of ${dept}`, department: dept, office_id: pick(OFFICES).office_id, manager_id: "EMP-001", hire_date: hireDate(), salary: salaryFor(dept, 1.9) });
  }
  // managers + individual contributors
  const managersByDept: Record<string, string[]> = Object.fromEntries(DEPARTMENTS.map((d) => [d, []]));
  while (seq <= TOTAL) {
    const id = `EMP-${pad(seq++, 3)}`;
    const dept = pick(DEPARTMENTS);
    const isManager = rnd() < 0.18 && managersByDept[dept].length < 6;
    let manager: string;
    let title: string;
    let mult: number;
    if (isManager) {
      manager = headByDept[dept];
      managersByDept[dept].push(id);
      title = `${dept} Manager`;
      mult = 1.4;
    } else {
      const pool = managersByDept[dept];
      manager = pool.length > 0 ? pick(pool) : headByDept[dept]; // report to a manager, else the head
      title = rnd() < 0.4 ? `Senior ${dept} Associate` : `${dept} Associate`;
      mult = title.startsWith("Senior") ? 1.15 : 0.9;
    }
    employees.push({ employee_id: id, full_name: uniqueName(), title, department: dept, office_id: pick(OFFICES).office_id, manager_id: manager, hire_date: hireDate(), salary: salaryFor(dept, mult) });
  }

  // ---- portfolios ----
  const portfolios: Portfolio[] = [];
  for (let i = 1; i <= 20; i++) {
    const client = CLIENTS[(i - 1) % CLIENTS.length];
    portfolios.push({ portfolio_id: `PF-${pad(i, 2)}`, portfolio_name: `${client} ${pick(PORTFOLIO_SUFFIX)}`, client, sector: pick(SECTORS), status: pick(STATUSES), budget: int(150, 4000) * 1000 });
  }

  // ---- assignments (many-to-many) ----
  const assignments: Assignment[] = [];
  const seen = new Set<string>();
  const allocs = [10, 20, 25, 40, 50, 75, 100];
  const add = (employee_id: string, portfolio_id: string, role: string) => {
    const key = `${employee_id}|${portfolio_id}`;
    if (seen.has(key)) return false;
    seen.add(key);
    assignments.push({ employee_id, portfolio_id, role, allocation_pct: pick(allocs) });
    return true;
  };
  const nonExec = employees.filter((e) => e.department !== "Executive");
  // every portfolio gets exactly one Lead + a cohort of contributors/reviewers
  for (const pf of portfolios) {
    add(pick(nonExec).employee_id, pf.portfolio_id, "Lead");
    const cohort = int(12, 24);
    for (let i = 0; i < cohort; i++) {
      add(pick(nonExec).employee_id, pf.portfolio_id, rnd() < 0.7 ? "Contributor" : "Reviewer");
    }
  }

  const csv = {
    offices: toCsv(["office_id", "office_name", "city", "country", "region"], OFFICES.map((o) => [o.office_id, o.office_name, o.city, o.country, o.region])),
    employees: toCsv(["employee_id", "full_name", "title", "department", "office_id", "manager_id", "hire_date", "salary"], employees.map((e) => [e.employee_id, e.full_name, e.title, e.department, e.office_id, e.manager_id, e.hire_date, e.salary])),
    portfolios: toCsv(["portfolio_id", "portfolio_name", "client", "sector", "status", "budget"], portfolios.map((p) => [p.portfolio_id, p.portfolio_name, p.client, p.sector, p.status, p.budget])),
    assignments: toCsv(["employee_id", "portfolio_id", "role", "allocation_pct"], assignments.map((a) => [a.employee_id, a.portfolio_id, a.role, a.allocation_pct])),
  };

  return { offices: [...OFFICES], employees, portfolios, assignments, csv };
}
