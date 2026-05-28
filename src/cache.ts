import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

function canonicalize(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  const keys = Object.keys(value as Record<string, unknown>).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalize((value as Record<string, unknown>)[k])}`).join(",")}}`;
}

export class Cache {
  constructor(private readonly root: string) {}

  key(stage: string, version: number, input: unknown): string {
    const canonical = canonicalize({ stage, version, input });
    return createHash("sha256").update(canonical).digest("hex");
  }

  private paths(key: string) {
    const dir = path.join(this.root, key.slice(0, 2), key);
    return { dir, data: path.join(dir, "data"), meta: path.join(dir, "meta.json") };
  }

  async get(key: string): Promise<Buffer | null> {
    const { data, meta } = this.paths(key);
    try {
      const metaRaw = await readFile(meta, "utf8");
      const parsed = JSON.parse(metaRaw);
      if (parsed.key !== key) return null;
      return await readFile(data);
    } catch {
      return null;
    }
  }

  async put(key: string, payload: Buffer): Promise<void> {
    const { dir, data, meta } = this.paths(key);
    await mkdir(dir, { recursive: true });
    await writeFile(data, payload);
    await writeFile(meta, JSON.stringify({ key, createdAt: new Date().toISOString() }));
  }

  async putRaw(key: string, payload: Buffer): Promise<void> {
    return this.put(key, payload);
  }

  async corruptForTest(key: string): Promise<void> {
    const { meta } = this.paths(key);
    await writeFile(meta, "{ not json");
  }
}
