import { Client, type Sandbox } from "forgevm";
import type {
  SandboxBackend,
  SandboxBackendHandle,
  SandboxProcess,
  SandboxSession,
} from "eve/sandbox";

/**
 * A custom Eve sandbox backend that runs the agent's sandbox inside a local
 * ForgeVM Firecracker microVM. Eve's built-in tools (`bash`, `write_file`,
 * `read_file`, `glob`, `grep`) call the SandboxSession methods below, which map
 * onto the ForgeVM SDK:
 *
 *   run         -> sandbox.exec   (gives exit code + stdout + stderr directly)
 *   writeText   -> sandbox.writeFile
 *   readText    -> sandbox.readFile
 *   removePath  -> sandbox.deleteFile
 *   spawn       -> sandbox.execStream
 *
 * This is the project's centerpiece: it swaps Eve's default sandbox for real
 * Firecracker microVMs without the agent loop knowing or caring.
 */

/** The ForgeVM Sandbox surface this adapter actually uses (narrowed for testing). */
export interface ForgevmSandboxLike {
  readonly id: string;
  exec(
    command: string,
    opts?: { args?: string[]; env?: Record<string, string>; workdir?: string; timeout?: string },
  ): Promise<{ exit_code: number; stdout: string; stderr: string; duration: string }>;
  execStream(
    command: string,
    opts?: { args?: string[]; env?: Record<string, string>; workdir?: string },
  ): AsyncIterable<{ stream: "stdout" | "stderr"; data: string }>;
  writeFile(path: string, content: string, mode?: string): Promise<void>;
  readFile(path: string): Promise<string>;
  deleteFile(path: string, recursive?: boolean): Promise<void>;
  destroy(): Promise<void>;
}

/** Eve roots every sandbox at /workspace; relative paths anchor there. */
const WORKSPACE = "/workspace";

function resolveWorkspacePath(path: string): string {
  if (path.startsWith("/")) return path;
  return `${WORKSPACE}/${path}`.replace(/\/{2,}/g, "/");
}

async function readOrNull(sandbox: ForgevmSandboxLike, path: string): Promise<string | null> {
  try {
    return await sandbox.readFile(path);
  } catch {
    // ForgeVM throws when the file is missing; Eve's contract wants null.
    return null;
  }
}

/** Apply Eve's 1-based inclusive line range to already-read text. */
function sliceLines(text: string, startLine?: number, endLine?: number): string {
  if (startLine === undefined && endLine === undefined) return text;
  const lines = text.split("\n");
  const start = Math.max(1, startLine ?? 1) - 1;
  const end = endLine ?? lines.length;
  return lines.slice(start, end).join("\n");
}

function singleChunkStream(bytes: Uint8Array): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });
}

async function collectStreamToString(stream: ReadableStream<Uint8Array>): Promise<string> {
  const chunks: Uint8Array[] = [];
  for await (const chunk of stream as unknown as AsyncIterable<Uint8Array>) {
    chunks.push(chunk);
  }
  const total = chunks.reduce((n, c) => n + c.length, 0);
  const joined = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    joined.set(c, offset);
    offset += c.length;
  }
  return new TextDecoder().decode(joined);
}

/** Build an Eve SandboxProcess from ForgeVM's streaming exec. */
function spawnProcess(
  sandbox: ForgevmSandboxLike,
  command: string,
  opts: { workingDirectory?: string; env?: Record<string, string> },
): SandboxProcess {
  const encoder = new TextEncoder();
  let stdoutController!: ReadableStreamDefaultController<Uint8Array>;
  let stderrController!: ReadableStreamDefaultController<Uint8Array>;
  const stdout = new ReadableStream<Uint8Array>({ start: (c) => void (stdoutController = c) });
  const stderr = new ReadableStream<Uint8Array>({ start: (c) => void (stderrController = c) });

  let resolveWait!: (value: { exitCode: number }) => void;
  const waitPromise = new Promise<{ exitCode: number }>((resolve) => (resolveWait = resolve));
  let killed = false;

  void (async () => {
    try {
      for await (const chunk of sandbox.execStream(command, {
        workdir: opts.workingDirectory ?? WORKSPACE,
        env: opts.env,
      })) {
        if (killed) break;
        const bytes = encoder.encode(chunk.data);
        if (chunk.stream === "stderr") stderrController.enqueue(bytes);
        else stdoutController.enqueue(bytes);
      }
    } catch {
      // streaming ended/aborted — fall through to close
    } finally {
      try {
        stdoutController.close();
      } catch {}
      try {
        stderrController.close();
      } catch {}
      // ForgeVM's stream API does not surface an exit code; report 0 on clean end.
      resolveWait({ exitCode: 0 });
    }
  })();

  return {
    stdout,
    stderr,
    wait: () => waitPromise,
    kill: async () => {
      killed = true;
      try {
        stdoutController.close();
      } catch {}
      try {
        stderrController.close();
      } catch {}
      resolveWait({ exitCode: 0 });
    },
  };
}

/**
 * Wrap a live ForgeVM sandbox as an Eve {@link SandboxSession}. Exported
 * separately from the backend so the mapping can be unit-tested against a fake
 * sandbox without a running daemon.
 *
 * Note: ForgeVM's file API is UTF-8 string based, so the binary/stream file
 * variants round-trip through UTF-8 (fine for the text the agent actually
 * reads/writes; true binary payloads are out of scope for this PoC).
 */
export function createForgevmSession(sandbox: ForgevmSandboxLike): SandboxSession {
  const session: SandboxSession = {
    id: sandbox.id,

    resolvePath: (path) => resolveWorkspacePath(path),

    async run(options) {
      const result = await sandbox.exec(options.command, {
        workdir: options.workingDirectory ?? WORKSPACE,
        env: options.env,
      });
      return { exitCode: result.exit_code, stdout: result.stdout, stderr: result.stderr };
    },

    async spawn(options) {
      return spawnProcess(sandbox, options.command, {
        workingDirectory: options.workingDirectory,
        env: options.env,
      });
    },

    async readTextFile(options) {
      const text = await readOrNull(sandbox, resolveWorkspacePath(options.path));
      return text === null ? null : sliceLines(text, options.startLine, options.endLine);
    },

    async readBinaryFile(options) {
      const text = await readOrNull(sandbox, resolveWorkspacePath(options.path));
      return text === null ? null : new TextEncoder().encode(text);
    },

    async readFile(options) {
      const text = await readOrNull(sandbox, resolveWorkspacePath(options.path));
      return text === null ? null : singleChunkStream(new TextEncoder().encode(text));
    },

    async writeTextFile(options) {
      await sandbox.writeFile(resolveWorkspacePath(options.path), options.content);
    },

    async writeBinaryFile(options) {
      await sandbox.writeFile(resolveWorkspacePath(options.path), new TextDecoder().decode(options.content));
    },

    async writeFile(options) {
      const content = await collectStreamToString(options.content);
      await sandbox.writeFile(resolveWorkspacePath(options.path), content);
    },

    async removePath(options) {
      try {
        await sandbox.deleteFile(resolveWorkspacePath(options.path), options.recursive);
      } catch (error) {
        if (!options.force) throw error;
      }
    },

    // Firecracker networking is fixed at spawn and we don't broker credentials,
    // so policy changes are a no-op rather than an error (keeps onSession happy).
    async setNetworkPolicy() {},
  };

  return session;
}

export interface ForgevmBackendOptions {
  /** ForgeVM daemon base URL. Defaults to FORGEVM_BASE_URL or http://127.0.0.1:7423. */
  baseUrl?: string;
  /** Image to spawn. Defaults to FORGEVM_IMAGE or "forgevm-pandas:latest". */
  image?: string;
  /** Provider. Defaults to FORGEVM_PROVIDER or "firecracker". */
  provider?: string;
  /** Sandbox TTL. Defaults to FORGEVM_TTL or "10m". */
  ttl?: string;
}

async function openSandbox(
  client: Client,
  existingSandboxId: unknown,
  cfg: { image: string; provider: string; ttl: string },
): Promise<Sandbox> {
  // Reattach to the same microVM across turns when we have its id (Eve persists
  // captureState() between turns of one durable session).
  if (typeof existingSandboxId === "string") {
    try {
      const existing = await client.get(existingSandboxId);
      await existing.extendTtl(cfg.ttl).catch(() => {});
      return existing;
    } catch {
      // expired/gone — fall through and spawn a fresh one
    }
  }
  const sandbox = await client.spawn({ image: cfg.image, provider: cfg.provider, ttl: cfg.ttl });
  // Eve roots the sandbox at /workspace; make sure it exists.
  await sandbox.exec("mkdir -p /workspace");
  return sandbox;
}

/**
 * Create the ForgeVM-backed Eve sandbox backend. Use it in
 * `agent/sandbox/sandbox.ts` via `defineSandbox({ backend: forgevmBackend() })`.
 */
export function forgevmBackend(options: ForgevmBackendOptions = {}): SandboxBackend {
  const baseUrl = options.baseUrl ?? process.env.FORGEVM_BASE_URL ?? "http://127.0.0.1:7423";
  const image = options.image ?? process.env.FORGEVM_IMAGE ?? "forgevm-pandas:latest";
  const provider = options.provider ?? process.env.FORGEVM_PROVIDER ?? "firecracker";
  // Short-ish TTL is a safety net: if a session is never disposed (e.g. an eval
  // run abandons its session), the microVM self-reaps instead of lingering 30m.
  // Active multi-turn sessions stay alive because openSandbox() extends the TTL
  // on each reattach. Override with FORGEVM_TTL for long-running workloads.
  const ttl = options.ttl ?? process.env.FORGEVM_TTL ?? "10m";
  const client = new Client({ baseUrl });

  return {
    name: "forgevm",

    // No template prewarm: Firecracker snapshot-restore is already fast, and we
    // open fresh sessions on demand. (Seeding files is done in onSession, not
    // via Eve's template/seed mechanism.)
    async prewarm() {
      return { reused: false };
    },

    async create(input) {
      const sandbox = await openSandbox(client, input.existingMetadata?.sandboxId, {
        image,
        provider,
        ttl,
      });
      const session = createForgevmSession(sandbox);

      const handle: SandboxBackendHandle = {
        session,
        useSessionFn: async () => session,
        async captureState() {
          return {
            backendName: "forgevm",
            sessionKey: input.sessionKey,
            metadata: { sandboxId: sandbox.id, image, provider },
          };
        },
        async dispose() {
          await sandbox.destroy().catch(() => {});
        },
      };
      return handle;
    },
  };
}
