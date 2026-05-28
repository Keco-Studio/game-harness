import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import type { Config } from "../config.js";

export const PACK_VERSION = 1;

export interface PackAction {
  name: string;
  frames: string[];
  frameDurationMs: number;
}

export interface PackInput {
  characterName: string;
  actions: PackAction[];
  workDir: string;
  output: Config["output"];
}

export interface PackOutput {
  sheetPath: string;
  metadataPath: string;
}

export async function runPack(input: PackInput): Promise<PackOutput> {
  const { characterName, actions, workDir, output } = input;
  const total = actions.reduce((n, a) => n + a.frames.length, 0);
  const w = output.frameWidth * total;
  const h = output.frameHeight;

  const composites: sharp.OverlayOptions[] = [];
  const animations: Record<string, { row: number; startFrame: number; frameCount: number; frameDurationMs: number }> = {};
  let cursor = 0;
  for (const a of actions) {
    animations[a.name] = {
      row: 0,
      startFrame: cursor,
      frameCount: a.frames.length,
      frameDurationMs: a.frameDurationMs,
    };
    for (const f of a.frames) {
      composites.push({ input: f, left: cursor * output.frameWidth, top: 0 });
      cursor++;
    }
  }

  const outDir = path.join(workDir, "05-sheets");
  await mkdir(outDir, { recursive: true });
  const sheetPath = path.join(outDir, `${characterName}.png`);
  const metadataPath = path.join(outDir, `${characterName}.json`);

  await sharp({
    create: { width: w, height: h, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
  })
    .composite(composites)
    .png()
    .toFile(sheetPath);

  const metadata = {
    image: `${characterName}.png`,
    frameWidth: output.frameWidth,
    frameHeight: output.frameHeight,
    anchor: output.anchor,
    animations,
  };
  await writeFile(metadataPath, JSON.stringify(metadata, null, 2));

  return { sheetPath, metadataPath };
}
