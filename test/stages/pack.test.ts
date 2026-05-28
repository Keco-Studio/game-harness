import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, mkdir, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import sharp from "sharp";
import { runPack } from "../../src/stages/pack.js";

let dir: string;
beforeEach(async () => { dir = await mkdtemp(path.join(tmpdir(), "pack-")); });
afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

async function makeCell(p: string, color: [number, number, number]) {
  await sharp({
    create: { width: 64, height: 64, channels: 4, background: { r: color[0], g: color[1], b: color[2], alpha: 255 } },
  }).png().toFile(p);
}

describe("runPack", () => {
  it("composites action frames into one horizontal strip with metadata", async () => {
    const actionDirs: Record<string, string[]> = {};
    for (const action of ["idle", "run", "attack"] as const) {
      const d = path.join(dir, "in", action);
      await mkdir(d, { recursive: true });
      const frames: string[] = [];
      for (let i = 0; i < 4; i++) {
        const p = path.join(d, `f${i}.png`);
        await makeCell(p, [action === "idle" ? 255 : 0, action === "run" ? 255 : 0, action === "attack" ? 255 : 0]);
        frames.push(p);
      }
      actionDirs[action] = frames;
    }
    const out = await runPack({
      characterName: "hero",
      actions: [
        { name: "idle", frames: actionDirs.idle, frameDurationMs: 125 },
        { name: "run", frames: actionDirs.run, frameDurationMs: 80 },
        { name: "attack", frames: actionDirs.attack, frameDurationMs: 60 },
      ],
      workDir: dir,
      output: {
        frameWidth: 64, frameHeight: 64,
        anchor: { x: 0.5, y: 0.9375 },
        backgroundKey: "#FF00FF",
        backgroundTolerance: 24,
        directory: "out",
      },
    });
    const meta = await sharp(out.sheetPath).metadata();
    expect(meta.width).toBe(64 * 12);
    expect(meta.height).toBe(64);
    const json = JSON.parse(await readFile(out.metadataPath, "utf8"));
    expect(json.animations.idle).toEqual({ row: 0, startFrame: 0, frameCount: 4, frameDurationMs: 125 });
    expect(json.animations.run).toEqual({ row: 0, startFrame: 4, frameCount: 4, frameDurationMs: 80 });
    expect(json.animations.attack).toEqual({ row: 0, startFrame: 8, frameCount: 4, frameDurationMs: 60 });
    expect(json.frameWidth).toBe(64);
  });
});
