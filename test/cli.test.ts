import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

describe("cli", () => {
  it("rejects an invalid config with a non-zero exit code", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "cli-"));
    const cfg = path.join(dir, "bad.yaml");
    writeFileSync(cfg, "character: {}\n");
    const res = spawnSync("node", ["--import", "tsx", "src/cli.ts", "build", cfg], {
      env: { ...process.env, "OPEN-ROUTER_KEY": "x" },
      encoding: "utf8",
    });
    expect(res.status).not.toBe(0);
    expect(res.stderr + res.stdout).toMatch(/invalid|config/i);
  });

  it("prints --help", () => {
    const res = spawnSync("node", ["--import", "tsx", "src/cli.ts", "--help"], {
      env: { ...process.env, "OPEN-ROUTER_KEY": "x" },
      encoding: "utf8",
    });
    expect(res.status).toBe(0);
    expect(res.stdout).toMatch(/build/);
  });
});
