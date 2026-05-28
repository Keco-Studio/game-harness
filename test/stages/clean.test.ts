import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import sharp from "sharp";
import { runClean } from "../../src/stages/clean.js";
import { Cache } from "../../src/cache.js";

let dir: string;
beforeEach(async () => { dir = await mkdtemp(path.join(tmpdir(), "clean-")); });
afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

async function makeFrame(filePath: string, charColor: [number, number, number]) {
  const w = 200, h = 200;
  const buf = Buffer.alloc(w * h * 3);
  for (let i = 0; i < w * h; i++) {
    buf[i * 3] = 0xff;
    buf[i * 3 + 1] = 0x00;
    buf[i * 3 + 2] = 0xff;
  }
  const cw = 40, ch = 80;
  const x0 = (w - cw) / 2;
  const y0 = h - ch - 20;
  for (let y = y0; y < y0 + ch; y++) {
    for (let x = x0; x < x0 + cw; x++) {
      const idx = (y * w + x) * 3;
      buf[idx] = charColor[0];
      buf[idx + 1] = charColor[1];
      buf[idx + 2] = charColor[2];
    }
  }
  await sharp(buf, { raw: { width: w, height: h, channels: 3 } }).png().toFile(filePath);
}

describe("runClean", () => {
  it("removes background, places character feet-center on 64x64 canvas", async () => {
    const rawDir = path.join(dir, "raw");
    await mkdir(rawDir, { recursive: true });
    const frames: string[] = [];
    for (let i = 0; i < 3; i++) {
      const p = path.join(rawDir, `f${i}.png`);
      await makeFrame(p, [10, 200, 10]);
      frames.push(p);
    }
    const cache = new Cache(path.join(dir, ".cache"));
    const out = await runClean({
      frames,
      actionName: "idle",
      workDir: dir,
      cache,
      output: {
        frameWidth: 64,
        frameHeight: 64,
        anchor: { x: 0.5, y: 0.9375 },
        backgroundKey: "#FF00FF",
        backgroundTolerance: 24,
        directory: "out",
      },
    });
    expect(out.frames).toHaveLength(3);
    const cleaned = await sharp(out.frames[0]).metadata();
    expect(cleaned.width).toBe(64);
    expect(cleaned.height).toBe(64);
    expect(cleaned.channels).toBe(4);

    const { data } = await sharp(out.frames[0]).raw().toBuffer({ resolveWithObject: true });
    // Character's bottom row sits at y = anchorY - 1 = 59
    const feetIdx = (59 * 64 + 32) * 4;
    expect(data[feetIdx + 3]).toBeGreaterThan(128);

    expect(data[3]).toBe(0);
  });

  it("fails when more than 25% of frames are dropped", async () => {
    const rawDir = path.join(dir, "raw");
    await mkdir(rawDir, { recursive: true });
    const frames: string[] = [];
    for (let i = 0; i < 4; i++) {
      const p = path.join(rawDir, `f${i}.png`);
      await sharp({
        create: { width: 100, height: 100, channels: 3, background: { r: 255, g: 0, b: 255 } },
      }).png().toFile(p);
      frames.push(p);
    }
    const cache = new Cache(path.join(dir, ".cache"));
    await expect(
      runClean({
        frames,
        actionName: "idle",
        workDir: dir,
        cache,
        output: {
          frameWidth: 64, frameHeight: 64,
          anchor: { x: 0.5, y: 0.9375 },
          backgroundKey: "#FF00FF",
          backgroundTolerance: 24,
          directory: "out",
        },
      }),
    ).rejects.toThrow(/dropped/i);
  });
});
