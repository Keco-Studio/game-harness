import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { runReference } from "../../src/stages/reference.js";
import { Cache } from "../../src/cache.js";

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "ref-"));
});
afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

describe("runReference", () => {
  it("calls OpenRouter generateImage with prompt+seed and writes PNG", async () => {
    const fakePng = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
    const generateImage = vi.fn().mockResolvedValue(fakePng);
    const cache = new Cache(path.join(dir, ".cache"));
    const out = await runReference({
      character: { name: "hero", reference: { prompt: "p", seed: 42 } },
      workDir: dir,
      cache,
      openRouter: { generateImage } as any,
    });
    expect(generateImage).toHaveBeenCalledWith({
      model: "openai/gpt-5.4-image-2",
      prompt: "p",
      seed: 42,
    });
    const onDisk = await readFile(out.path);
    expect(onDisk.equals(fakePng)).toBe(true);
  });

  it("uses cache on second call", async () => {
    const generateImage = vi.fn().mockResolvedValue(Buffer.from([1, 2, 3]));
    const cache = new Cache(path.join(dir, ".cache"));
    const input = {
      character: { name: "hero", reference: { prompt: "p", seed: 42 } },
      workDir: dir,
      cache,
      openRouter: { generateImage } as any,
    };
    await runReference(input);
    await runReference(input);
    expect(generateImage).toHaveBeenCalledTimes(1);
  });
});
