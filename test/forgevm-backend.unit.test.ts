import { describe, it, expect, vi } from "vitest";
import { createForgevmSession, type ForgevmSandboxLike } from "../agent/sandbox/forgevm-backend.js";

// A fake ForgeVM sandbox; each test overrides just the method it exercises. We
// assert on what the Eve SandboxSession produces (its observable behaviour),
// not on private wiring.
function fakeSandbox(overrides: Partial<ForgevmSandboxLike> = {}): ForgevmSandboxLike {
  return {
    id: "sb-test",
    exec: vi.fn(async () => ({ exit_code: 0, stdout: "", stderr: "", duration: "1ms" })),
    async *execStream() {},
    writeFile: vi.fn(async () => {}),
    readFile: vi.fn(async () => ""),
    deleteFile: vi.fn(async () => {}),
    destroy: vi.fn(async () => {}),
    ...overrides,
  };
}

describe("createForgevmSession", () => {
  it("exposes the sandbox id", () => {
    expect(createForgevmSession(fakeSandbox({ id: "sb-xyz" })).id).toBe("sb-xyz");
  });

  it("anchors relative paths to /workspace and passes absolute paths through", () => {
    const session = createForgevmSession(fakeSandbox());
    expect(session.resolvePath("analysis/run.py")).toBe("/workspace/analysis/run.py");
    expect(session.resolvePath("/etc/hostname")).toBe("/etc/hostname");
  });

  it("run() maps the ForgeVM exec result to { exitCode, stdout, stderr }", async () => {
    const session = createForgevmSession(
      fakeSandbox({
        exec: vi.fn(async () => ({ exit_code: 2, stdout: "out", stderr: "boom", duration: "5ms" })),
      }),
    );
    expect(await session.run({ command: "false" })).toEqual({
      exitCode: 2,
      stdout: "out",
      stderr: "boom",
    });
  });

  it("run() defaults the working directory to /workspace", async () => {
    const exec = vi.fn(async () => ({ exit_code: 0, stdout: "", stderr: "", duration: "1ms" }));
    await createForgevmSession(fakeSandbox({ exec })).run({ command: "ls" });
    expect(exec).toHaveBeenCalledWith("ls", expect.objectContaining({ workdir: "/workspace" }));
  });

  it("writeTextFile() writes to the resolved path", async () => {
    const writeFile = vi.fn(async () => {});
    await createForgevmSession(fakeSandbox({ writeFile })).writeTextFile({
      path: "analysis.py",
      content: "print(1)",
    });
    expect(writeFile).toHaveBeenCalledWith("/workspace/analysis.py", "print(1)");
  });

  it("readTextFile() returns file content", async () => {
    const session = createForgevmSession(fakeSandbox({ readFile: vi.fn(async () => "South\n") }));
    expect(await session.readTextFile({ path: "out.txt" })).toBe("South\n");
  });

  it("readTextFile() applies a 1-based inclusive line range", async () => {
    const session = createForgevmSession(fakeSandbox({ readFile: vi.fn(async () => "a\nb\nc\nd") }));
    expect(await session.readTextFile({ path: "f", startLine: 2, endLine: 3 })).toBe("b\nc");
  });

  it("readTextFile() returns null when the file is missing", async () => {
    const session = createForgevmSession(
      fakeSandbox({
        readFile: vi.fn(async () => {
          throw new Error("no such file");
        }),
      }),
    );
    expect(await session.readTextFile({ path: "nope" })).toBeNull();
  });

  it("removePath() ignores a missing path only when force is set", async () => {
    const deleteFile = vi.fn(async () => {
      throw new Error("missing");
    });
    const session = createForgevmSession(fakeSandbox({ deleteFile }));
    await expect(session.removePath({ path: "x", force: true })).resolves.toBeUndefined();
    await expect(session.removePath({ path: "x" })).rejects.toThrow(/missing/);
  });
});
