import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { Cache } from "../cache.js";

export const EXTRACT_VERSION = 1;

export type FfmpegRunner = (args: string[], outDir: string) => Promise<void>;
export type ProbeRunner = (videoPath: string) => Promise<number>;

export interface ExtractInput {
  videoPath: string;
  actionName: string;
  frameCount: number;
  workDir: string;
  cache: Cache;
  ffmpeg?: FfmpegRunner;
  probeFrameCount?: ProbeRunner;
}

export interface ExtractOutput {
  frames: string[];
  cached: boolean;
}

export function computeFfmpegArgs(input: string, outDir: string, frameCount: number, totalFrames: number): string[] {
  const step = Math.max(1, Math.floor(totalFrames / frameCount));
  return [
    "-y",
    "-i",
    input,
    "-vf",
    `select=not(mod(n\\,${step}))`,
    "-vsync",
    "0",
    "-frames:v",
    String(frameCount),
    path.join(outDir, "frame-%03d.png"),
  ];
}

const defaultFfmpeg: FfmpegRunner = (args, _outDir) =>
  new Promise<void>((resolve, reject) => {
    const proc = spawn("ffmpeg", args, { stdio: ["ignore", "pipe", "pipe"] });
    let stderr = "";
    proc.stderr.on("data", (d) => (stderr += d.toString()));
    proc.on("error", reject);
    proc.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg exited ${code}: ${stderr}`))));
  });

const defaultProbe: ProbeRunner = (videoPath) =>
  new Promise<number>((resolve, reject) => {
    const proc = spawn("ffprobe", [
      "-v", "error",
      "-select_streams", "v:0",
      "-count_frames",
      "-show_entries", "stream=nb_read_frames",
      "-of", "default=nokey=1:noprint_wrappers=1",
      videoPath,
    ], { stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    proc.stdout.on("data", (d) => (out += d.toString()));
    proc.on("error", reject);
    proc.on("close", (code) => {
      if (code !== 0) return reject(new Error(`ffprobe exited ${code}`));
      const n = parseInt(out.trim(), 10);
      resolve(Number.isFinite(n) && n > 0 ? n : 120);
    });
  });

export async function runExtract(input: ExtractInput): Promise<ExtractOutput> {
  const { videoPath, actionName, frameCount, workDir, cache } = input;
  const ffmpeg = input.ffmpeg ?? defaultFfmpeg;
  const probe = input.probeFrameCount ?? defaultProbe;

  const videoBytes = await readFile(videoPath);
  const videoHash = createHash("sha256").update(videoBytes).digest("hex");
  const key = cache.key("extract", EXTRACT_VERSION, { videoHash, frameCount });

  const outDir = path.join(workDir, "03-raw-frames", actionName);
  await mkdir(outDir, { recursive: true });

  const cached = await cache.get(key);
  if (cached) {
    const manifest = JSON.parse(cached.toString()) as { frames: { name: string; b64: string }[] };
    const frames: string[] = [];
    for (const f of manifest.frames) {
      const p = path.join(outDir, f.name);
      await writeFile(p, Buffer.from(f.b64, "base64"));
      frames.push(p);
    }
    return { frames, cached: true };
  }

  const total = await probe(videoPath);
  await ffmpeg(computeFfmpegArgs(videoPath, outDir, frameCount, total), outDir);
  const files = (await readdir(outDir)).filter((f) => f.endsWith(".png")).sort();
  const frames = files.map((f) => path.join(outDir, f));
  const manifest = {
    frames: await Promise.all(
      frames.map(async (p) => ({ name: path.basename(p), b64: (await readFile(p)).toString("base64") })),
    ),
  };
  await cache.put(key, Buffer.from(JSON.stringify(manifest)));
  return { frames, cached: false };
}
