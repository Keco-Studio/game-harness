import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtemp, mkdir, rm, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import sharp from "sharp";
import { runPipeline } from "../src/pipeline.js";
import type { Config } from "../src/config.js";

let dir: string;
beforeEach(async () => { dir = await mkdtemp(path.join(tmpdir(), "pipe-")); });
afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

async function makeMagentaWithChar(): Promise<Buffer> {
  const w = 200, h = 200;
  const buf = Buffer.alloc(w * h * 3);
  for (let i = 0; i < w * h; i++) {
    buf[i * 3] = 0xff; buf[i * 3 + 1] = 0x00; buf[i * 3 + 2] = 0xff;
  }
  for (let y = 100; y < 180; y++) {
    for (let x = 80; x < 120; x++) {
      const p = (y * w + x) * 3;
      buf[p] = 10; buf[p + 1] = 200; buf[p + 2] = 10;
    }
  }
  return sharp(buf, { raw: { width: w, height: h, channels: 3 } }).png().toBuffer();
}

function makeArgs(dir: string, cfg: Config, refPng: Buffer) {
  const generateImage = vi.fn().mockResolvedValue(refPng);
  const uploadImage = vi.fn().mockResolvedValue("data:image/png;base64,abc");
  const imageToVideo = vi.fn().mockResolvedValue(Buffer.from([0, 1, 2]));
  const ffmpeg = vi.fn(async (_args: string[], outDir: string) => {
    await mkdir(outDir, { recursive: true });
    for (let i = 0; i < cfg.actions[0].frameCount; i++) {
      await writeFile(path.join(outDir, `frame-${String(i).padStart(3, "0")}.png`), refPng);
    }
  });
  const probe = vi.fn().mockResolvedValue(120);
  return {
    args: {
      config: cfg,
      workDir: path.join(dir, "work"),
      cacheDir: path.join(dir, ".cache"),
      previewTemplateDir: path.join(process.cwd(), "preview"),
      openRouter: { generateImage } as any,
      fal: { uploadImage, imageToVideo } as any,
      ffmpeg, probe,
    },
    generateImage,
    imageToVideo,
  };
}

describe("runPipeline", () => {
  it("runs all six stages and produces expected outputs", async () => {
    const cfg: Config = {
      character: { name: "hero", reference: { prompt: "p", seed: 1 } },
      actions: [
        { name: "idle", prompt: "a", frameCount: 4, frameDurationMs: 125, seed: 10 },
        { name: "run", prompt: "b", frameCount: 4, frameDurationMs: 80, seed: 11 },
        { name: "attack", prompt: "c", frameCount: 4, frameDurationMs: 60, seed: 12 },
      ],
      output: {
        frameWidth: 64, frameHeight: 64,
        anchor: { x: 0.5, y: 0.9375 },
        backgroundKey: "#FF00FF", backgroundTolerance: 24,
        directory: path.join(dir, "out"),
      },
    };

    const refPng = await makeMagentaWithChar();
    const { args, generateImage, imageToVideo } = makeArgs(dir, cfg, refPng);
    const result = await runPipeline(args);

    expect(generateImage).toHaveBeenCalledTimes(1);
    expect(imageToVideo).toHaveBeenCalledTimes(3);
    const meta = JSON.parse(await readFile(result.metadataPath, "utf8"));
    expect(Object.keys(meta.animations)).toEqual(["idle", "run", "attack"]);
    const sheetMeta = await sharp(result.sheetPath).metadata();
    expect(sheetMeta.width).toBe(64 * 12);
  });

  it("reuses cached video when only post-processing changes", async () => {
    const cfg: Config = {
      character: { name: "hero", reference: { prompt: "p", seed: 1 } },
      actions: [
        { name: "idle", prompt: "a", frameCount: 4, frameDurationMs: 125, seed: 10 },
        { name: "run", prompt: "b", frameCount: 4, frameDurationMs: 80, seed: 11 },
        { name: "attack", prompt: "c", frameCount: 4, frameDurationMs: 60, seed: 12 },
      ],
      output: {
        frameWidth: 64, frameHeight: 64,
        anchor: { x: 0.5, y: 0.9375 },
        backgroundKey: "#FF00FF", backgroundTolerance: 24,
        directory: path.join(dir, "out"),
      },
    };
    const refPng = await makeMagentaWithChar();
    const { args, generateImage, imageToVideo } = makeArgs(dir, cfg, refPng);

    await runPipeline(args);
    await runPipeline(args);
    expect(generateImage).toHaveBeenCalledTimes(1);
    expect(imageToVideo).toHaveBeenCalledTimes(3);
  });
});
