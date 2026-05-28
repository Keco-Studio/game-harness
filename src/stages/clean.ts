import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { Cache } from "../cache.js";
import type { Config } from "../config.js";

export const CLEAN_VERSION = 1;

export interface CleanInput {
  frames: string[];
  actionName: string;
  workDir: string;
  cache: Cache;
  output: Config["output"];
}

export interface CleanOutput {
  frames: string[];
  dropped: number;
  cached: boolean;
}

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
}

interface Bbox { x: number; y: number; w: number; h: number }

function computeAlphaBbox(rgba: Buffer, width: number, height: number): Bbox | null {
  let minX = width, minY = height, maxX = -1, maxY = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const a = rgba[(y * width + x) * 4 + 3];
      if (a > 16) {
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) return null;
  return { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
}

async function chromaKey(filePath: string, key: [number, number, number], tolerance: number): Promise<{
  rgba: Buffer; width: number; height: number;
}> {
  const img = sharp(filePath).ensureAlpha();
  const meta = await img.metadata();
  const width = meta.width!;
  const height = meta.height!;
  const raw = await img.raw().toBuffer();
  const out = Buffer.from(raw);
  const tol2 = tolerance * tolerance * 3;
  for (let i = 0; i < width * height; i++) {
    const p = i * 4;
    const dr = out[p] - key[0];
    const dg = out[p + 1] - key[1];
    const db = out[p + 2] - key[2];
    if (dr * dr + dg * dg + db * db <= tol2) {
      out[p + 3] = 0;
    }
  }
  return { rgba: out, width, height };
}

async function processFrame(
  filePath: string,
  output: Config["output"],
): Promise<Buffer | null> {
  const key = hexToRgb(output.backgroundKey);
  const { rgba, width, height } = await chromaKey(filePath, key, output.backgroundTolerance);
  const bbox = computeAlphaBbox(rgba, width, height);
  if (!bbox || bbox.w < 8 || bbox.h < 8) return null;

  const cropped = await sharp(rgba, { raw: { width, height, channels: 4 } })
    .extract({ left: bbox.x, top: bbox.y, width: bbox.w, height: bbox.h })
    .png()
    .toBuffer();

  const maxW = output.frameWidth;
  const maxH = output.frameHeight;
  let scaled = cropped;
  let sw = bbox.w;
  let sh = bbox.h;
  if (sw > maxW || sh > maxH) {
    const ratio = Math.min(maxW / sw, maxH / sh);
    sw = Math.max(1, Math.round(sw * ratio));
    sh = Math.max(1, Math.round(sh * ratio));
    scaled = await sharp(cropped).resize(sw, sh, { fit: "fill" }).png().toBuffer();
  }

  const anchorX = Math.round(output.anchor.x * output.frameWidth);
  const anchorY = Math.round(output.anchor.y * output.frameHeight);
  const left = Math.round(anchorX - sw / 2);
  const top = anchorY - sh;

  return sharp({
    create: {
      width: output.frameWidth,
      height: output.frameHeight,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite([{ input: scaled, left, top }])
    .png()
    .toBuffer();
}

export async function runClean(input: CleanInput): Promise<CleanOutput> {
  const { frames, actionName, workDir, cache, output } = input;

  const hasher = createHash("sha256");
  for (const f of frames) hasher.update(await readFile(f));
  hasher.update(JSON.stringify(output));
  const key = cache.key("clean", CLEAN_VERSION, { framesHash: hasher.digest("hex") });

  const outDir = path.join(workDir, "04-clean-frames", actionName);
  await mkdir(outDir, { recursive: true });

  const cached = await cache.get(key);
  if (cached) {
    const manifest = JSON.parse(cached.toString()) as { frames: { name: string; b64: string }[]; dropped: number };
    const written: string[] = [];
    for (const f of manifest.frames) {
      const p = path.join(outDir, f.name);
      await writeFile(p, Buffer.from(f.b64, "base64"));
      written.push(p);
    }
    return { frames: written, dropped: manifest.dropped, cached: true };
  }

  const written: string[] = [];
  let dropped = 0;
  for (let i = 0; i < frames.length; i++) {
    const out = await processFrame(frames[i], output);
    if (!out) {
      dropped++;
      continue;
    }
    const name = `frame-${String(written.length).padStart(3, "0")}.png`;
    const p = path.join(outDir, name);
    await writeFile(p, out);
    written.push(p);
  }
  if (dropped / frames.length > 0.25) {
    throw new Error(
      `[clean] ${actionName}: dropped ${dropped}/${frames.length} frames. ` +
        `Tighten the prompt's background color or raise backgroundTolerance.`,
    );
  }
  const manifest = {
    frames: await Promise.all(
      written.map(async (p) => ({ name: path.basename(p), b64: (await readFile(p)).toString("base64") })),
    ),
    dropped,
  };
  await cache.put(key, Buffer.from(JSON.stringify(manifest)));
  return { frames: written, dropped, cached: false };
}
