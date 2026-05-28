import { readFile } from "node:fs/promises";
import { parse as parseYaml } from "yaml";
import { z } from "zod";

const ReferenceSchema = z.object({
  prompt: z.string().min(1),
  seed: z.number().int(),
});

const ActionSchema = z.object({
  name: z.string().min(1),
  prompt: z.string().min(1),
  frameCount: z.number().int().min(2).max(64),
  frameDurationMs: z.number().int().min(10).max(2000),
  seed: z.number().int(),
});

const OutputSchema = z.object({
  frameWidth: z.number().int().min(8).max(512),
  frameHeight: z.number().int().min(8).max(512),
  anchor: z.object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1) }),
  backgroundKey: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  backgroundTolerance: z.number().int().min(0).max(255),
  directory: z.string().min(1),
});

const CharacterSchema = z.object({
  name: z.string().min(1),
  reference: ReferenceSchema,
});

export const ConfigSchema = z.object({
  character: CharacterSchema,
  actions: z.array(ActionSchema).min(1),
  output: OutputSchema,
});

export type Config = z.infer<typeof ConfigSchema>;
export type Action = z.infer<typeof ActionSchema>;

export async function loadConfig(path: string): Promise<Config> {
  const raw = await readFile(path, "utf8");
  const parsed = parseYaml(raw);
  const result = ConfigSchema.safeParse(parsed);
  if (!result.success) {
    const detail = result.error.issues
      .map((i) => `${i.path.join(".")}: ${i.message}`)
      .join("\n");
    throw new Error(`Invalid config at ${path}:\n${detail}`);
  }
  return result.data;
}
