import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { Cache } from "../cache.js";
import type { Config } from "../config.js";

export const REFERENCE_VERSION = 1;
export const REFERENCE_MODEL = "openai/gpt-5.4-image-2";

export interface ReferenceInput {
  character: Config["character"];
  workDir: string;
  cache: Cache;
  openRouter: { generateImage(req: { model: string; prompt: string; seed: number }): Promise<Buffer> };
}

export interface ReferenceOutput {
  path: string;
  bytes: Buffer;
  cached: boolean;
}

export async function runReference(input: ReferenceInput): Promise<ReferenceOutput> {
  const { character, workDir, cache, openRouter } = input;
  const key = cache.key("reference", REFERENCE_VERSION, {
    model: REFERENCE_MODEL,
    prompt: character.reference.prompt,
    seed: character.reference.seed,
  });
  const dir = path.join(workDir, "01-reference");
  const filePath = path.join(dir, `${character.name}.png`);
  await mkdir(dir, { recursive: true });

  const cached = await cache.get(key);
  if (cached) {
    await writeFile(filePath, cached);
    return { path: filePath, bytes: cached, cached: true };
  }
  const bytes = await openRouter.generateImage({
    model: REFERENCE_MODEL,
    prompt: character.reference.prompt,
    seed: character.reference.seed,
  });
  await cache.put(key, bytes);
  await writeFile(filePath, bytes);
  return { path: filePath, bytes, cached: false };
}
