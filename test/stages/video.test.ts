import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { runVideo } from "../../src/stages/video.js";
import { Cache } from "../../src/cache.js";

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "vid-"));
});
afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

describe("runVideo", () => {
  it("calls generateVideo with prompt+seed+referenceImage and writes MP4", async () => {
    const fakeMp4 = Buffer.from([0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70]);
    const ref = Buffer.from([0x89, 0x50]);
    const generateVideo = vi.fn().mockResolvedValue(fakeMp4);
    const cache = new Cache(path.join(dir, ".cache"));
    const out = await runVideo({
      characterName: "hero",
      action: { name: "idle", prompt: "p", frameCount: 8, frameDurationMs: 125, seed: 100 },
      referenceBytes: ref,
      workDir: dir,
      cache,
      openRouter: { generateVideo } as any,
    });
    expect(generateVideo).toHaveBeenCalledWith({
      model: "bytedance-seed/seed-2.0-lite",
      prompt: "p",
      seed: 100,
      referenceImage: ref,
    });
    const onDisk = await readFile(out.path);
    expect(onDisk.equals(fakeMp4)).toBe(true);
  });
});
