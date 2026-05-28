import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { Cache } from "../cache.js";
import type { Action } from "../config.js";

export const VIDEO_VERSION = 1;
export const VIDEO_MODEL = "bytedance/seedance-2.0/image-to-video";

export interface VideoInput {
  characterName: string;
  action: Action;
  referenceBytes: Buffer;
  workDir: string;
  cache: Cache;
  fal: {
    uploadImage(bytes: Buffer, mime?: string): Promise<string>;
    imageToVideo(req: {
      modelId: string;
      prompt: string;
      imageUrl: string;
      seed: number;
      resolution?: string;
      duration?: string;
    }): Promise<Buffer>;
  };
}

export interface VideoOutput {
  path: string;
  bytes: Buffer;
  cached: boolean;
}

export async function runVideo(input: VideoInput): Promise<VideoOutput> {
  const { action, referenceBytes, workDir, cache, fal } = input;
  const refHash = createHash("sha256").update(referenceBytes).digest("hex");
  const key = cache.key("video", VIDEO_VERSION, {
    model: VIDEO_MODEL,
    prompt: action.prompt,
    seed: action.seed,
    referenceHash: refHash,
  });
  const dir = path.join(workDir, "02-video");
  const filePath = path.join(dir, `${action.name}.mp4`);
  await mkdir(dir, { recursive: true });

  const cached = await cache.get(key);
  if (cached) {
    await writeFile(filePath, cached);
    return { path: filePath, bytes: cached, cached: true };
  }

  const imageUrl = await fal.uploadImage(referenceBytes);
  const bytes = await fal.imageToVideo({
    modelId: VIDEO_MODEL,
    prompt: action.prompt,
    seed: action.seed,
    imageUrl,
    resolution: "720p",
    duration: "auto",
  });

  await cache.put(key, bytes);
  await writeFile(filePath, bytes);
  return { path: filePath, bytes, cached: false };
}
