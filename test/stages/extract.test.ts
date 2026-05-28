import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtemp, mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { runExtract, computeFfmpegArgs } from "../../src/stages/extract.js";
import { Cache } from "../../src/cache.js";

let dir: string;
beforeEach(async () => { dir = await mkdtemp(path.join(tmpdir(), "ext-")); });
afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

describe("computeFfmpegArgs", () => {
  it("samples N evenly spaced frames", () => {
    const args = computeFfmpegArgs("in.mp4", "out", 8, 120);
    const vf = args[args.indexOf("-vf") + 1];
    expect(vf).toContain("not(mod(n\\,15))");
  });
});

describe("runExtract", () => {
  it("invokes ffmpeg runner and returns frame paths", async () => {
    const ffmpeg = vi.fn(async (_args: string[], outDir: string) => {
      await mkdir(outDir, { recursive: true });
      for (let i = 0; i < 8; i++) {
        await writeFile(path.join(outDir, `frame-${String(i).padStart(3, "0")}.png`), Buffer.from([i]));
      }
    });
    const probe = vi.fn().mockResolvedValue(120);
    const cache = new Cache(path.join(dir, ".cache"));
    const videoPath = path.join(dir, "in.mp4");
    await writeFile(videoPath, Buffer.from([1, 2, 3]));
    const out = await runExtract({
      videoPath,
      actionName: "idle",
      frameCount: 8,
      workDir: dir,
      cache,
      ffmpeg,
      probeFrameCount: probe,
    });
    expect(out.frames).toHaveLength(8);
    const files = await readdir(path.join(dir, "03-raw-frames", "idle"));
    expect(files).toHaveLength(8);
  });
});
