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
  it("calls fal imageToVideo with prompt+seed+imageUrl and writes MP4", async () => {
    const fakeMp4 = Buffer.from([0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70]);
    const ref = Buffer.from([0x89, 0x50]);
    const imageToVideo = vi.fn().mockResolvedValue(fakeMp4);
    const uploadImage = vi.fn().mockResolvedValue("data:image/png;base64,iVBORw==");
    const cache = new Cache(path.join(dir, ".cache"));
    const out = await runVideo({
      characterName: "hero",
      action: { name: "idle", prompt: "p", frameCount: 8, frameDurationMs: 125, seed: 100 },
      referenceBytes: ref,
      workDir: dir,
      cache,
      fal: { uploadImage, imageToVideo } as any,
    });
    expect(imageToVideo).toHaveBeenCalledWith(expect.objectContaining({
      modelId: "bytedance/seedance-2.0/image-to-video",
      prompt: "p",
      seed: 100,
    }));
    const onDisk = await readFile(out.path);
    expect(onDisk.equals(fakeMp4)).toBe(true);
  });
});
