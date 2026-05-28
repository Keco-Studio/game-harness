# AI Game Sprite Animation Compiler Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Node.js CLI that turns a `character.yaml` into an Excalibur.js-ready spritesheet, metadata JSON, animation code, and a runnable preview app, using OpenRouter (`openai/gpt-5.4-image-2` + `bytedance-seed/seed-2.0-lite`) for AI generation.

**Architecture:** Six-stage linear pipeline (reference → video → extract → clean → pack → emit) orchestrated by a single CLI. Each stage is content-addressed and cached. Stages 1–2 hit OpenRouter; stage 3 shells to `ffmpeg`; stages 4–5 use `sharp`; stage 6 templates TypeScript.

**Tech Stack:** Node 20, TypeScript, commander (CLI), zod (config validation), yaml, sharp (image processing), vitest (tests), excalibur + vite (preview app), ffmpeg (system binary).

**Spec:** `docs/superpowers/specs/2026-05-27-sprite-animation-compiler-design.md`

---

## Task 1: Project bootstrap

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `vitest.config.ts`
- Create: `.gitignore`
- Create: `src/index.ts`
- Create: `test/smoke.test.ts`

- [ ] **Step 1: Write the failing smoke test**

`test/smoke.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { version } from "../src/index.js";

describe("package", () => {
  it("exports a version string", () => {
    expect(typeof version).toBe("string");
    expect(version.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Create package.json**

`package.json`:
```json
{
  "name": "sprite-compiler",
  "version": "0.1.0",
  "type": "module",
  "bin": { "sprite-compiler": "dist/cli.js" },
  "scripts": {
    "build": "tsc -p .",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "dependencies": {
    "commander": "^12.1.0",
    "sharp": "^0.33.5",
    "yaml": "^2.5.1",
    "zod": "^3.23.8"
  },
  "devDependencies": {
    "@types/node": "^20.14.0",
    "typescript": "^5.6.0",
    "vitest": "^2.1.0"
  }
}
```

- [ ] **Step 3: Create tsconfig.json**

`tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "declaration": true
  },
  "include": ["src/**/*"]
}
```

- [ ] **Step 4: Create vitest.config.ts**

`vitest.config.ts`:
```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    environment: "node",
  },
});
```

- [ ] **Step 5: Create .gitignore**

`.gitignore`:
```
node_modules/
dist/
.sprite-cache/
work/
out/
.env
*.log
```

- [ ] **Step 6: Create src/index.ts**

`src/index.ts`:
```ts
export const version = "0.1.0";
```

- [ ] **Step 7: Install and run tests**

```bash
npm install
npm test
```
Expected: 1 test passes.

- [ ] **Step 8: Commit**

```bash
git add package.json package-lock.json tsconfig.json vitest.config.ts .gitignore src/index.ts test/smoke.test.ts
git commit -m "chore: bootstrap sprite-compiler project"
```

---

## Task 2: Config schema and loader

**Files:**
- Create: `src/config.ts`
- Create: `test/config.test.ts`
- Create: `test/fixtures/character.good.yaml`
- Create: `test/fixtures/character.bad.yaml`

- [ ] **Step 1: Write the failing tests**

`test/fixtures/character.good.yaml`:
```yaml
character:
  name: hero
  reference:
    prompt: "Pixel art knight, magenta background"
    seed: 42
actions:
  - name: idle
    prompt: "knight idle, magenta background"
    frameCount: 8
    frameDurationMs: 125
    seed: 100
  - name: run
    prompt: "knight run, magenta background"
    frameCount: 8
    frameDurationMs: 80
    seed: 101
  - name: attack
    prompt: "knight attack, magenta background"
    frameCount: 8
    frameDurationMs: 60
    seed: 102
output:
  frameWidth: 64
  frameHeight: 64
  anchor: { x: 0.5, y: 0.9375 }
  backgroundKey: "#FF00FF"
  backgroundTolerance: 24
  directory: out
```

`test/fixtures/character.bad.yaml`:
```yaml
character:
  name: hero
actions: []
```

`test/config.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { loadConfig } from "../src/config.js";

describe("loadConfig", () => {
  it("parses a valid character.yaml", async () => {
    const cfg = await loadConfig("test/fixtures/character.good.yaml");
    expect(cfg.character.name).toBe("hero");
    expect(cfg.actions).toHaveLength(3);
    expect(cfg.actions.map((a) => a.name)).toEqual(["idle", "run", "attack"]);
    expect(cfg.output.frameWidth).toBe(64);
    expect(cfg.output.anchor.y).toBeCloseTo(0.9375);
  });

  it("rejects a config missing required fields", async () => {
    await expect(loadConfig("test/fixtures/character.bad.yaml")).rejects.toThrow(/reference|prompt|actions/i);
  });

  it("rejects a config with zero actions", async () => {
    await expect(loadConfig("test/fixtures/character.bad.yaml")).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npm test -- config
```
Expected: FAIL (module not found).

- [ ] **Step 3: Implement src/config.ts**

`src/config.ts`:
```ts
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
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npm test -- config
```
Expected: 3 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/config.ts test/config.test.ts test/fixtures/character.good.yaml test/fixtures/character.bad.yaml
git commit -m "feat: add config schema and loader"
```

---

## Task 3: Content-addressed cache

**Files:**
- Create: `src/cache.ts`
- Create: `test/cache.test.ts`

- [ ] **Step 1: Write the failing tests**

`test/cache.test.ts`:
```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Cache } from "../src/cache.js";

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "cache-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("Cache", () => {
  it("misses then hits with identical inputs", async () => {
    const cache = new Cache(dir);
    const key = cache.key("video", 1, { prompt: "hello", seed: 1 });
    expect(await cache.get(key)).toBeNull();
    await cache.put(key, Buffer.from("payload"));
    const got = await cache.get(key);
    expect(got?.toString()).toBe("payload");
  });

  it("produces stable hashes regardless of object key order", () => {
    const cache = new Cache(dir);
    const a = cache.key("s", 1, { a: 1, b: 2 });
    const b = cache.key("s", 1, { b: 2, a: 1 });
    expect(a).toBe(b);
  });

  it("changes hash when stage version changes", () => {
    const cache = new Cache(dir);
    const a = cache.key("s", 1, { x: 1 });
    const b = cache.key("s", 2, { x: 1 });
    expect(a).not.toBe(b);
  });

  it("treats corrupted cache entries as a miss", async () => {
    const cache = new Cache(dir);
    const key = cache.key("s", 1, { x: 1 });
    await cache.putRaw(key, Buffer.from("ok"));
    // corrupt by writing garbage meta
    await cache.corruptForTest(key);
    expect(await cache.get(key)).toBeNull();
  });
});

```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npm test -- cache
```
Expected: FAIL (module not found).

- [ ] **Step 3: Implement src/cache.ts**

`src/cache.ts`:
```ts
import { createHash } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
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
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npm test -- cache
```
Expected: 4 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/cache.ts test/cache.test.ts
git commit -m "feat: add content-addressed cache"
```

---

## Task 4: OpenRouter HTTP client

**Files:**
- Create: `src/openrouter.ts`
- Create: `test/openrouter.test.ts`

- [ ] **Step 1: Write the failing tests**

`test/openrouter.test.ts`:
```ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { OpenRouter, AuthError, RateLimitError, ServerError, ContentError } from "../src/openrouter.js";

const originalFetch = globalThis.fetch;
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  globalThis.fetch = fetchMock as unknown as typeof fetch;
  process.env["OPEN-ROUTER_KEY"] = "test-key";
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("OpenRouter", () => {
  it("throws AuthError on 401", async () => {
    fetchMock.mockResolvedValueOnce(new Response("nope", { status: 401, headers: { "x-request-id": "r1" } }));
    const client = new OpenRouter();
    await expect(client.chat({ model: "m", prompt: "p" })).rejects.toBeInstanceOf(AuthError);
  });

  it("retries on 5xx and eventually throws ServerError", async () => {
    fetchMock.mockResolvedValue(new Response("boom", { status: 500, headers: { "x-request-id": "r2" } }));
    const client = new OpenRouter({ maxRetries: 2, backoffBaseMs: 1 });
    await expect(client.chat({ model: "m", prompt: "p" })).rejects.toBeInstanceOf(ServerError);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("retries on 429 and succeeds", async () => {
    fetchMock
      .mockResolvedValueOnce(new Response("slow", { status: 429, headers: { "x-request-id": "r3" } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ choices: [{ message: { content: "ok" } }] }), { status: 200 }));
    const client = new OpenRouter({ maxRetries: 2, backoffBaseMs: 1 });
    const res = await client.chat({ model: "m", prompt: "p" });
    expect(res).toEqual({ choices: [{ message: { content: "ok" } }] });
  });

  it("throws ContentError when 200 body is missing expected payload via extractor", async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({}), { status: 200 }));
    const client = new OpenRouter();
    await expect(
      client.generateImage({ model: "m", prompt: "p", seed: 1 }),
    ).rejects.toBeInstanceOf(ContentError);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npm test -- openrouter
```
Expected: FAIL (module not found).

- [ ] **Step 3: Implement src/openrouter.ts**

`src/openrouter.ts`:
```ts
const API_BASE = "https://openrouter.ai/api/v1";

export class AuthError extends Error {}
export class RateLimitError extends Error {}
export class ServerError extends Error {}
export class ContentError extends Error {}

export interface OpenRouterOptions {
  apiKey?: string;
  maxRetries?: number;
  backoffBaseMs?: number;
}

interface ChatRequest {
  model: string;
  prompt: string;
  images?: string[]; // base64 data URLs
  seed?: number;
}

interface ImageRequest {
  model: string;
  prompt: string;
  seed: number;
  referenceImage?: Buffer;
}

interface VideoRequest {
  model: string;
  prompt: string;
  seed: number;
  referenceImage: Buffer;
}

export class OpenRouter {
  private readonly apiKey: string;
  private readonly maxRetries: number;
  private readonly backoffBaseMs: number;

  constructor(opts: OpenRouterOptions = {}) {
    const key = opts.apiKey ?? process.env["OPEN-ROUTER_KEY"];
    if (!key) throw new AuthError("OPEN-ROUTER_KEY env var not set");
    this.apiKey = key;
    this.maxRetries = opts.maxRetries ?? 3;
    this.backoffBaseMs = opts.backoffBaseMs ?? 500;
  }

  async chat(req: ChatRequest): Promise<any> {
    const body = {
      model: req.model,
      messages: [{ role: "user", content: req.prompt }],
      ...(req.seed !== undefined ? { seed: req.seed } : {}),
    };
    return this.requestJson("/chat/completions", body);
  }

  async generateImage(req: ImageRequest): Promise<Buffer> {
    const content: any[] = [{ type: "text", text: req.prompt }];
    if (req.referenceImage) {
      content.push({
        type: "image_url",
        image_url: { url: `data:image/png;base64,${req.referenceImage.toString("base64")}` },
      });
    }
    const body = {
      model: req.model,
      messages: [{ role: "user", content }],
      modalities: ["image", "text"],
      seed: req.seed,
    };
    const json = await this.requestJson("/chat/completions", body);
    const image = this.extractImage(json);
    if (!image) throw new ContentError("No image returned from model");
    return image;
  }

  async generateVideo(req: VideoRequest): Promise<Buffer> {
    const body = {
      model: req.model,
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: req.prompt },
            {
              type: "image_url",
              image_url: { url: `data:image/png;base64,${req.referenceImage.toString("base64")}` },
            },
          ],
        },
      ],
      modalities: ["video", "text"],
      seed: req.seed,
    };
    const json = await this.requestJson("/chat/completions", body);
    const url = this.extractVideoUrl(json);
    if (!url) throw new ContentError("No video URL returned from model");
    const res = await fetch(url);
    if (!res.ok) throw new ContentError(`Failed to download video: ${res.status}`);
    return Buffer.from(await res.arrayBuffer());
  }

  private extractImage(json: any): Buffer | null {
    const msg = json?.choices?.[0]?.message;
    if (!msg) return null;
    const url: string | undefined =
      msg.images?.[0]?.image_url?.url ?? msg.images?.[0]?.url ?? msg.image_url ?? undefined;
    if (!url) return null;
    if (url.startsWith("data:")) {
      const b64 = url.split(",")[1];
      return Buffer.from(b64, "base64");
    }
    return null;
  }

  private extractVideoUrl(json: any): string | null {
    const msg = json?.choices?.[0]?.message;
    return msg?.videos?.[0]?.video_url?.url ?? msg?.video_url ?? null;
  }

  private async requestJson(path: string, body: unknown): Promise<any> {
    let lastErr: Error | null = null;
    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      const res = await fetch(`${API_BASE}${path}`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });
      const reqId = res.headers.get("x-request-id") ?? "unknown";
      if (res.status === 401 || res.status === 403) {
        throw new AuthError(`OpenRouter auth failed (${res.status}) req=${reqId}`);
      }
      if (res.status === 429) {
        lastErr = new RateLimitError(`Rate limited req=${reqId}`);
      } else if (res.status >= 500) {
        lastErr = new ServerError(`OpenRouter ${res.status} req=${reqId}`);
      } else if (!res.ok) {
        const txt = await res.text();
        throw new ContentError(`OpenRouter ${res.status} req=${reqId}: ${txt}`);
      } else {
        return res.json();
      }
      if (attempt < this.maxRetries) {
        await new Promise((r) => setTimeout(r, this.backoffBaseMs * Math.pow(2, attempt)));
      }
    }
    throw lastErr ?? new ServerError("Unknown OpenRouter failure");
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npm test -- openrouter
```
Expected: 4 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/openrouter.ts test/openrouter.test.ts
git commit -m "feat: add OpenRouter HTTP client with typed errors and retries"
```

---

## Task 5: Reference stage

**Files:**
- Create: `src/stages/reference.ts`
- Create: `test/stages/reference.test.ts`

- [ ] **Step 1: Write the failing test**

`test/stages/reference.test.ts`:
```ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { runReference } from "../../src/stages/reference.js";
import { Cache } from "../../src/cache.js";

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "ref-"));
});
afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

describe("runReference", () => {
  it("calls OpenRouter generateImage with prompt+seed and writes PNG", async () => {
    const fakePng = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
    const generateImage = vi.fn().mockResolvedValue(fakePng);
    const cache = new Cache(path.join(dir, ".cache"));
    const out = await runReference({
      character: { name: "hero", reference: { prompt: "p", seed: 42 } },
      workDir: dir,
      cache,
      openRouter: { generateImage } as any,
    });
    expect(generateImage).toHaveBeenCalledWith({
      model: "openai/gpt-5.4-image-2",
      prompt: "p",
      seed: 42,
    });
    const onDisk = await readFile(out.path);
    expect(onDisk.equals(fakePng)).toBe(true);
  });

  it("uses cache on second call", async () => {
    const generateImage = vi.fn().mockResolvedValue(Buffer.from([1, 2, 3]));
    const cache = new Cache(path.join(dir, ".cache"));
    const input = {
      character: { name: "hero", reference: { prompt: "p", seed: 42 } },
      workDir: dir,
      cache,
      openRouter: { generateImage } as any,
    };
    await runReference(input);
    await runReference(input);
    expect(generateImage).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npm test -- reference
```
Expected: FAIL.

- [ ] **Step 3: Implement src/stages/reference.ts**

`src/stages/reference.ts`:
```ts
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
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npm test -- reference
```
Expected: 2 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/stages/reference.ts test/stages/reference.test.ts
git commit -m "feat: add reference stage (Image 2)"
```

---

## Task 6: Video stage

**Files:**
- Create: `src/stages/video.ts`
- Create: `test/stages/video.test.ts`

- [ ] **Step 1: Write the failing test**

`test/stages/video.test.ts`:
```ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { runVideo } from "../../src/stages/video.js";
import { Cache } from "../../src/cache.js";

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "vid-"));
});
afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

describe("runVideo", () => {
  it("calls generateVideo with prompt+seed+referenceImage and writes MP4", async () => {
    const fakeMp4 = Buffer.from([0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70]);
    const ref = Buffer.from([0x89, 0x50]);
    const generateVideo = vi.fn().mockResolvedValue(fakeMp4);
    const cache = new Cache(path.join(dir, ".cache"));
    const out = await runVideo({
      characterName: "hero",
      action: { name: "idle", prompt: "p", frameCount: 8, frameDurationMs: 125, seed: 100 },
      referenceBytes: ref,
      workDir: dir,
      cache,
      openRouter: { generateVideo } as any,
    });
    expect(generateVideo).toHaveBeenCalledWith({
      model: "bytedance-seed/seed-2.0-lite",
      prompt: "p",
      seed: 100,
      referenceImage: ref,
    });
    const onDisk = await readFile(out.path);
    expect(onDisk.equals(fakeMp4)).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npm test -- video
```
Expected: FAIL.

- [ ] **Step 3: Implement src/stages/video.ts**

`src/stages/video.ts`:
```ts
import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { Cache } from "../cache.js";
import type { Action } from "../config.js";

export const VIDEO_VERSION = 1;
export const VIDEO_MODEL = "bytedance-seed/seed-2.0-lite";

export interface VideoInput {
  characterName: string;
  action: Action;
  referenceBytes: Buffer;
  workDir: string;
  cache: Cache;
  openRouter: {
    generateVideo(req: { model: string; prompt: string; seed: number; referenceImage: Buffer }): Promise<Buffer>;
  };
}

export interface VideoOutput {
  path: string;
  bytes: Buffer;
  cached: boolean;
}

export async function runVideo(input: VideoInput): Promise<VideoOutput> {
  const { action, referenceBytes, workDir, cache, openRouter } = input;
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
  const bytes = await openRouter.generateVideo({
    model: VIDEO_MODEL,
    prompt: action.prompt,
    seed: action.seed,
    referenceImage: referenceBytes,
  });
  await cache.put(key, bytes);
  await writeFile(filePath, bytes);
  return { path: filePath, bytes, cached: false };
}
```

The `characterName` field of `VideoInput` is currently unused inside the function (only the action name appears in the file path); it's kept on the interface for future per-character work directories.

- [ ] **Step 4: Run tests to verify they pass**

```bash
npm test -- video
```
Expected: 1 test passes.

- [ ] **Step 5: Commit**

```bash
git add src/stages/video.ts test/stages/video.test.ts
git commit -m "feat: add video stage (Seedance)"
```

---

## Task 7: Frame extraction stage

**Files:**
- Create: `src/stages/extract.ts`
- Create: `test/stages/extract.test.ts`

- [ ] **Step 1: Write the failing test**

`test/stages/extract.test.ts`:
```ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtemp, mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { runExtract, computeFfmpegArgs } from "../../src/stages/extract.js";
import { Cache } from "../../src/cache.js";

let dir: string;
beforeEach(async () => { dir = await mkdtemp(path.join(tmpdir(), "ext-")); });
afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

describe("computeFfmpegArgs", () => {
  it("samples N evenly spaced frames", () => {
    const args = computeFfmpegArgs("in.mp4", "out", 8, 120);
    const vf = args[args.indexOf("-vf") + 1];
    // step = floor(120/8) = 15
    expect(vf).toContain("not(mod(n\\,15))");
  });
});

describe("runExtract", () => {
  it("invokes ffmpeg runner and returns frame paths", async () => {
    const ffmpeg = vi.fn(async (_args: string[], outDir: string) => {
      await mkdir(outDir, { recursive: true });
      for (let i = 0; i < 8; i++) {
        await writeFile(path.join(outDir, `frame-${String(i).padStart(3, "0")}.png`), Buffer.from([i]));
      }
    });
    const probe = vi.fn().mockResolvedValue(120);
    const cache = new Cache(path.join(dir, ".cache"));
    const out = await runExtract({
      videoPath: path.join(dir, "in.mp4"),
      actionName: "idle",
      frameCount: 8,
      workDir: dir,
      cache,
      ffmpeg,
      probeFrameCount: probe,
    });
    expect(out.frames).toHaveLength(8);
    const files = await readdir(path.join(dir, "03-raw-frames", "idle"));
    expect(files).toHaveLength(8);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npm test -- extract
```
Expected: FAIL.

- [ ] **Step 3: Implement src/stages/extract.ts**

`src/stages/extract.ts`:
```ts
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
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npm test -- extract
```
Expected: 2 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/stages/extract.ts test/stages/extract.test.ts
git commit -m "feat: add ffmpeg-based frame extraction stage"
```

---

## Task 8: Clean / align stage

**Files:**
- Create: `src/stages/clean.ts`
- Create: `test/stages/clean.test.ts`

- [ ] **Step 1: Write the failing test**

`test/stages/clean.test.ts`:
```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import sharp from "sharp";
import { runClean } from "../../src/stages/clean.js";
import { Cache } from "../../src/cache.js";

let dir: string;
beforeEach(async () => { dir = await mkdtemp(path.join(tmpdir(), "clean-")); });
afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

async function makeFrame(filePath: string, charColor: [number, number, number]) {
  // 200x200 magenta with a 40x80 colored character rectangle bottom-center
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
    await import("node:fs/promises").then((m) => m.mkdir(rawDir, { recursive: true }));
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

    // Check feet-anchor pixel (32, 60) is opaque (character's bottom edge sits here)
    const { data } = await sharp(out.frames[0]).raw().toBuffer({ resolveWithObject: true });
    const anchorIdx = (60 * 64 + 32) * 4;
    expect(data[anchorIdx + 3]).toBeGreaterThan(128);

    // Check top-left corner is transparent
    expect(data[3]).toBe(0);
  });

  it("fails when more than 25% of frames are dropped", async () => {
    const rawDir = path.join(dir, "raw");
    await import("node:fs/promises").then((m) => m.mkdir(rawDir, { recursive: true }));
    const frames: string[] = [];
    // All-magenta frames (no character) → all dropped
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
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npm test -- clean
```
Expected: FAIL.

- [ ] **Step 3: Implement src/stages/clean.ts**

`src/stages/clean.ts`:
```ts
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

  // Scale to fit cell if too large
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

  // hash all input frames + output settings
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
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npm test -- clean
```
Expected: 2 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/stages/clean.ts test/stages/clean.test.ts
git commit -m "feat: add chroma-key clean and feet-center align stage"
```

---

## Task 9: Pack stage

**Files:**
- Create: `src/stages/pack.ts`
- Create: `test/stages/pack.test.ts`

- [ ] **Step 1: Write the failing test**

`test/stages/pack.test.ts`:
```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, mkdir, rm, writeFile, readFile } from "node:fs/promises";
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
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npm test -- pack
```
Expected: FAIL.

- [ ] **Step 3: Implement src/stages/pack.ts**

`src/stages/pack.ts`:
```ts
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
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npm test -- pack
```
Expected: 1 test passes.

- [ ] **Step 5: Commit**

```bash
git add src/stages/pack.ts test/stages/pack.test.ts
git commit -m "feat: add spritesheet pack stage"
```

---

## Task 10: Emit stage (codegen + preview scaffold)

**Files:**
- Create: `src/stages/emit.ts`
- Create: `src/templates/animations.ts.tmpl`
- Create: `preview/index.html`
- Create: `preview/package.json`
- Create: `preview/vite.config.ts`
- Create: `preview/src/main.ts`
- Create: `test/stages/emit.test.ts`

- [ ] **Step 1: Create the preview scaffold (checked in, copied at emit time)**

`preview/index.html`:
```html
<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>Sprite Preview</title>
    <style>
      body { margin: 0; background: #111; color: #eee; font-family: system-ui; }
      #ui { position: absolute; top: 8px; left: 8px; z-index: 10; }
      button { margin-right: 4px; padding: 6px 10px; }
    </style>
  </head>
  <body>
    <div id="ui">
      <button data-anim="idle">idle</button>
      <button data-anim="run">run</button>
      <button data-anim="attack">attack</button>
    </div>
    <canvas id="game"></canvas>
    <script type="module" src="/src/main.ts"></script>
  </body>
</html>
```

`preview/package.json`:
```json
{
  "name": "sprite-preview",
  "private": true,
  "version": "0.0.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build"
  },
  "dependencies": {
    "excalibur": "^0.30.0"
  },
  "devDependencies": {
    "typescript": "^5.6.0",
    "vite": "^5.4.0"
  }
}
```

`preview/vite.config.ts`:
```ts
import { defineConfig } from "vite";

export default defineConfig({
  server: { port: 5173, open: true },
});
```

`preview/src/main.ts`:
```ts
import { Engine, Actor, Color, Vector, DisplayMode } from "excalibur";
import { heroAnimations, heroAnchor } from "./animations";

const engine = new Engine({
  canvasElementId: "game",
  displayMode: DisplayMode.FillScreen,
  backgroundColor: Color.fromHex("#222"),
  pixelArt: true,
  antialiasing: false,
});

const actor = new Actor({
  pos: new Vector(engine.drawWidth / 2, engine.drawHeight / 2),
  width: 64,
  height: 64,
  anchor: new Vector(heroAnchor.x, heroAnchor.y),
});
actor.graphics.use(heroAnimations.idle);
engine.add(actor);

document.querySelectorAll<HTMLButtonElement>("button[data-anim]").forEach((btn) => {
  btn.addEventListener("click", () => {
    const name = btn.dataset.anim as keyof typeof heroAnimations;
    actor.graphics.use(heroAnimations[name]);
  });
});

engine.start();
```

- [ ] **Step 2: Create the codegen template**

`src/templates/animations.ts.tmpl`:
```ts
import { ImageSource, SpriteSheet, Animation, range } from "excalibur";
import sheetUrl from "./__SHEET__";

export const heroImage = new ImageSource(sheetUrl);

export const heroSheet = SpriteSheet.fromImageSource({
  image: heroImage,
  grid: { rows: 1, columns: __COLUMNS__, spriteWidth: __W__, spriteHeight: __H__ },
});

export const heroAnimations = {
__ANIMATIONS__
};

export const heroAnchor = { x: __AX__, y: __AY__ };
```

- [ ] **Step 3: Write the failing test**

`test/stages/emit.test.ts`:
```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, mkdir, rm, writeFile, readFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { runEmit } from "../../src/stages/emit.js";

let dir: string;
beforeEach(async () => { dir = await mkdtemp(path.join(tmpdir(), "emit-")); });
afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

describe("runEmit", () => {
  it("writes sheet, metadata, animations.ts, and preview scaffold", async () => {
    const sheetSrc = path.join(dir, "hero.png");
    const metaSrc = path.join(dir, "hero.json");
    await writeFile(sheetSrc, Buffer.from([1, 2, 3]));
    const metadata = {
      image: "hero.png",
      frameWidth: 64,
      frameHeight: 64,
      anchor: { x: 0.5, y: 0.9375 },
      animations: {
        idle:   { row: 0, startFrame: 0, frameCount: 8, frameDurationMs: 125 },
        run:    { row: 0, startFrame: 8, frameCount: 8, frameDurationMs: 80 },
        attack: { row: 0, startFrame: 16, frameCount: 8, frameDurationMs: 60 },
      },
    };
    await writeFile(metaSrc, JSON.stringify(metadata));

    const outDir = path.join(dir, "out");
    await runEmit({
      sheetPath: sheetSrc,
      metadataPath: metaSrc,
      outputDir: outDir,
      previewTemplateDir: path.join(process.cwd(), "preview"),
    });

    const files = await readdir(outDir);
    expect(files).toEqual(expect.arrayContaining(["hero.png", "hero.json", "animations.ts", "preview"]));
    const animsTs = await readFile(path.join(outDir, "animations.ts"), "utf8");
    expect(animsTs).toContain("range(0, 7)");
    expect(animsTs).toContain("range(8, 15)");
    expect(animsTs).toContain("range(16, 23)");
    expect(animsTs).toContain('"./hero.png"');
    expect(animsTs).toContain("x: 0.5");

    const previewMain = await readFile(path.join(outDir, "preview", "src", "main.ts"), "utf8");
    expect(previewMain).toContain("heroAnimations");

    // animations.ts should also be inside preview/src so vite can import it
    const previewAnims = await readFile(path.join(outDir, "preview", "src", "animations.ts"), "utf8");
    expect(previewAnims).toContain("heroAnimations");
  });
});
```

- [ ] **Step 4: Run tests to verify they fail**

```bash
npm test -- emit
```
Expected: FAIL.

- [ ] **Step 5: Implement src/stages/emit.ts**

`src/stages/emit.ts`:
```ts
import { copyFile, cp, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

export const EMIT_VERSION = 1;

interface AnimMeta {
  row: number;
  startFrame: number;
  frameCount: number;
  frameDurationMs: number;
}

interface Metadata {
  image: string;
  frameWidth: number;
  frameHeight: number;
  anchor: { x: number; y: number };
  animations: Record<string, AnimMeta>;
}

export interface EmitInput {
  sheetPath: string;
  metadataPath: string;
  outputDir: string;
  previewTemplateDir: string;
}

export interface EmitOutput {
  animationsTsPath: string;
  sheetPath: string;
  metadataPath: string;
  previewDir: string;
}

function renderAnimations(metadata: Metadata): string {
  const lines: string[] = [];
  for (const [name, a] of Object.entries(metadata.animations)) {
    const end = a.startFrame + a.frameCount - 1;
    lines.push(`  ${name}: Animation.fromSpriteSheet(heroSheet, range(${a.startFrame}, ${end}), ${a.frameDurationMs}),`);
  }
  return lines.join("\n");
}

async function renderAnimationsTs(templatePath: string, metadata: Metadata, sheetRelPath: string): Promise<string> {
  const tmpl = await readFile(templatePath, "utf8");
  const total = Object.values(metadata.animations).reduce((n, a) => n + a.frameCount, 0);
  return tmpl
    .replaceAll("__SHEET__", sheetRelPath)
    .replaceAll("__COLUMNS__", String(total))
    .replaceAll("__W__", String(metadata.frameWidth))
    .replaceAll("__H__", String(metadata.frameHeight))
    .replaceAll("__ANIMATIONS__", renderAnimations(metadata))
    .replaceAll("__AX__", String(metadata.anchor.x))
    .replaceAll("__AY__", String(metadata.anchor.y));
}

export async function runEmit(input: EmitInput): Promise<EmitOutput> {
  const { sheetPath, metadataPath, outputDir, previewTemplateDir } = input;
  await mkdir(outputDir, { recursive: true });
  const metadata: Metadata = JSON.parse(await readFile(metadataPath, "utf8"));

  const outSheet = path.join(outputDir, path.basename(sheetPath));
  const outMeta = path.join(outputDir, path.basename(metadataPath));
  await copyFile(sheetPath, outSheet);
  await copyFile(metadataPath, outMeta);

  const templatePath = path.join(
    path.dirname(new URL(import.meta.url).pathname),
    "..",
    "templates",
    "animations.ts.tmpl",
  );
  const animsTs = await renderAnimationsTs(templatePath, metadata, `./${path.basename(sheetPath)}`);
  const animsTsPath = path.join(outputDir, "animations.ts");
  await writeFile(animsTsPath, animsTs);

  const previewDir = path.join(outputDir, "preview");
  await cp(previewTemplateDir, previewDir, { recursive: true });
  // copy sheet + animations.ts into preview/src so vite imports resolve
  await mkdir(path.join(previewDir, "src"), { recursive: true });
  await copyFile(outSheet, path.join(previewDir, "src", path.basename(sheetPath)));
  await writeFile(path.join(previewDir, "src", "animations.ts"), animsTs);

  return { animationsTsPath: animsTsPath, sheetPath: outSheet, metadataPath: outMeta, previewDir };
}
```

- [ ] **Step 6: Run tests to verify they pass**

```bash
npm test -- emit
```
Expected: 1 test passes.

- [ ] **Step 7: Commit**

```bash
git add src/stages/emit.ts src/templates/animations.ts.tmpl preview/ test/stages/emit.test.ts
git commit -m "feat: add emit stage and preview scaffold"
```

---

## Task 11: Pipeline orchestrator

**Files:**
- Create: `src/pipeline.ts`
- Create: `test/pipeline.test.ts`

- [ ] **Step 1: Write the failing integration test**

`test/pipeline.test.ts`:
```ts
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
    const generateImage = vi.fn().mockResolvedValue(refPng);
    const generateVideo = vi.fn().mockResolvedValue(Buffer.from([0, 1, 2]));

    // mock ffmpeg/probe so we don't depend on system ffmpeg
    const ffmpeg = vi.fn(async (_args: string[], outDir: string) => {
      await mkdir(outDir, { recursive: true });
      for (let i = 0; i < 4; i++) {
        await writeFile(path.join(outDir, `frame-${String(i).padStart(3, "0")}.png`), refPng);
      }
    });
    const probe = vi.fn().mockResolvedValue(120);

    const result = await runPipeline({
      config: cfg,
      workDir: path.join(dir, "work"),
      cacheDir: path.join(dir, ".cache"),
      previewTemplateDir: path.join(process.cwd(), "preview"),
      openRouter: { generateImage, generateVideo } as any,
      ffmpeg, probe,
    });

    expect(generateImage).toHaveBeenCalledTimes(1);
    expect(generateVideo).toHaveBeenCalledTimes(3);
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
    const generateImage = vi.fn().mockResolvedValue(refPng);
    const generateVideo = vi.fn().mockResolvedValue(Buffer.from([0, 1, 2]));
    const ffmpeg = vi.fn(async (_args: string[], outDir: string) => {
      await mkdir(outDir, { recursive: true });
      for (let i = 0; i < 4; i++) {
        await writeFile(path.join(outDir, `frame-${String(i).padStart(3, "0")}.png`), refPng);
      }
    });
    const probe = vi.fn().mockResolvedValue(120);

    const args = {
      config: cfg,
      workDir: path.join(dir, "work"),
      cacheDir: path.join(dir, ".cache"),
      previewTemplateDir: path.join(process.cwd(), "preview"),
      openRouter: { generateImage, generateVideo } as any,
      ffmpeg, probe,
    };

    await runPipeline(args);
    await runPipeline(args);
    expect(generateImage).toHaveBeenCalledTimes(1);
    expect(generateVideo).toHaveBeenCalledTimes(3);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npm test -- pipeline
```
Expected: FAIL (module not found).

- [ ] **Step 3: Implement src/pipeline.ts**

`src/pipeline.ts`:
```ts
import { Cache } from "./cache.js";
import type { Config } from "./config.js";
import { runReference } from "./stages/reference.js";
import { runVideo } from "./stages/video.js";
import { runExtract, FfmpegRunner, ProbeRunner } from "./stages/extract.js";
import { runClean } from "./stages/clean.js";
import { runPack } from "./stages/pack.js";
import { runEmit } from "./stages/emit.js";

export interface PipelineInput {
  config: Config;
  workDir: string;
  cacheDir: string;
  previewTemplateDir: string;
  openRouter: {
    generateImage(req: { model: string; prompt: string; seed: number }): Promise<Buffer>;
    generateVideo(req: { model: string; prompt: string; seed: number; referenceImage: Buffer }): Promise<Buffer>;
  };
  ffmpeg?: FfmpegRunner;
  probe?: ProbeRunner;
  log?: (line: string) => void;
}

export interface PipelineResult {
  sheetPath: string;
  metadataPath: string;
  animationsTsPath: string;
  previewDir: string;
}

export async function runPipeline(input: PipelineInput): Promise<PipelineResult> {
  const log = input.log ?? (() => {});
  const cache = new Cache(input.cacheDir);
  const charWorkDir = `${input.workDir}/${input.config.character.name}`;

  const t0 = Date.now();
  const ref = await runReference({
    character: input.config.character,
    workDir: charWorkDir,
    cache,
    openRouter: input.openRouter,
  });
  log(`[reference] ${input.config.character.name} ${ref.cached ? "cached" : "running"} (${((Date.now() - t0) / 1000).toFixed(1)}s)`);

  const packActions = [];
  for (const action of input.config.actions) {
    const tv = Date.now();
    const vid = await runVideo({
      characterName: input.config.character.name,
      action,
      referenceBytes: ref.bytes,
      workDir: charWorkDir,
      cache,
      openRouter: input.openRouter,
    });
    log(`[video] ${action.name} ${vid.cached ? "cached" : "running"} (${((Date.now() - tv) / 1000).toFixed(1)}s)`);

    const te = Date.now();
    const ex = await runExtract({
      videoPath: vid.path,
      actionName: action.name,
      frameCount: action.frameCount,
      workDir: charWorkDir,
      cache,
      ffmpeg: input.ffmpeg,
      probeFrameCount: input.probe,
    });
    log(`[extract] ${action.name} ${ex.cached ? "cached" : "running"} (${((Date.now() - te) / 1000).toFixed(1)}s)`);

    const tc = Date.now();
    const cl = await runClean({
      frames: ex.frames,
      actionName: action.name,
      workDir: charWorkDir,
      cache,
      output: input.config.output,
    });
    log(`[clean] ${action.name} ${cl.cached ? "cached" : "running"} (${((Date.now() - tc) / 1000).toFixed(1)}s)`);

    packActions.push({ name: action.name, frames: cl.frames, frameDurationMs: action.frameDurationMs });
  }

  const tp = Date.now();
  const packed = await runPack({
    characterName: input.config.character.name,
    actions: packActions,
    workDir: charWorkDir,
    output: input.config.output,
  });
  log(`[pack] ${input.config.character.name} running (${((Date.now() - tp) / 1000).toFixed(1)}s)`);

  const tm = Date.now();
  const emitted = await runEmit({
    sheetPath: packed.sheetPath,
    metadataPath: packed.metadataPath,
    outputDir: input.config.output.directory,
    previewTemplateDir: input.previewTemplateDir,
  });
  log(`[emit] ${input.config.character.name} running (${((Date.now() - tm) / 1000).toFixed(1)}s)`);

  return {
    sheetPath: emitted.sheetPath,
    metadataPath: emitted.metadataPath,
    animationsTsPath: emitted.animationsTsPath,
    previewDir: emitted.previewDir,
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npm test -- pipeline
```
Expected: 2 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/pipeline.ts test/pipeline.test.ts
git commit -m "feat: add pipeline orchestrator"
```

---

## Task 12: CLI entry

**Files:**
- Create: `src/cli.ts`
- Create: `test/cli.test.ts`

- [ ] **Step 1: Write the failing test**

`test/cli.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

describe("cli", () => {
  it("rejects an invalid config with a non-zero exit code", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "cli-"));
    const cfg = path.join(dir, "bad.yaml");
    writeFileSync(cfg, "character: {}\n");
    const res = spawnSync("node", ["--import", "tsx", "src/cli.ts", "build", cfg], {
      env: { ...process.env, "OPEN-ROUTER_KEY": "x" },
      encoding: "utf8",
    });
    expect(res.status).not.toBe(0);
    expect(res.stderr).toMatch(/invalid|config/i);
  });

  it("prints --help", () => {
    const res = spawnSync("node", ["--import", "tsx", "src/cli.ts", "--help"], {
      env: { ...process.env, "OPEN-ROUTER_KEY": "x" },
      encoding: "utf8",
    });
    expect(res.status).toBe(0);
    expect(res.stdout).toMatch(/build/);
  });
});
```

- [ ] **Step 2: Add tsx as a dev dependency**

```bash
npm install -D tsx
```

- [ ] **Step 3: Run tests to verify they fail**

```bash
npm test -- cli
```
Expected: FAIL.

- [ ] **Step 4: Implement src/cli.ts**

`src/cli.ts`:
```ts
#!/usr/bin/env node
import { Command } from "commander";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig } from "./config.js";
import { OpenRouter } from "./openrouter.js";
import { runPipeline } from "./pipeline.js";

const program = new Command();
program
  .name("sprite-compiler")
  .description("Compile a character.yaml into an Excalibur.js spritesheet via OpenRouter")
  .version("0.1.0");

program
  .command("build")
  .argument("<config>", "path to character.yaml")
  .option("--force", "ignore cache and re-run all stages", false)
  .option("--work-dir <dir>", "intermediate artifact directory", "work")
  .option("--cache-dir <dir>", "cache directory", ".sprite-cache")
  .action(async (configPath: string, opts: { force: boolean; workDir: string; cacheDir: string }) => {
    try {
      const cfg = await loadConfig(configPath);
      const openRouter = new OpenRouter();
      const previewTemplateDir = path.resolve(
        path.dirname(fileURLToPath(import.meta.url)),
        "..",
        "preview",
      );
      const result = await runPipeline({
        config: cfg,
        workDir: opts.workDir,
        cacheDir: opts.force ? path.join(opts.cacheDir, `force-${Date.now()}`) : opts.cacheDir,
        previewTemplateDir,
        openRouter,
        log: (line) => console.log(line),
      });
      console.log(`done → ${result.sheetPath}`);
      console.log(`      ${result.metadataPath}`);
      console.log(`      ${result.animationsTsPath}`);
      console.log(`      ${result.previewDir}`);
    } catch (err) {
      console.error((err as Error).message);
      process.exit(1);
    }
  });

program.parseAsync(process.argv);
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
npm test -- cli
```
Expected: 2 tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/cli.ts test/cli.test.ts package.json package-lock.json
git commit -m "feat: add CLI entry point"
```

---

## Task 13: Build verification

**Files:** none new — verify the whole project builds + tests pass.

- [ ] **Step 1: Run full test suite**

```bash
npm test
```
Expected: all suites pass.

- [ ] **Step 2: Build TypeScript**

```bash
npm run build
```
Expected: `dist/` produced with no errors.

- [ ] **Step 3: Smoke the CLI without network**

```bash
node --import tsx src/cli.ts --help
```
Expected: usage text including `build`.

- [ ] **Step 4: Commit if any build/config tweaks were needed**

```bash
git status
# if there are tracked changes:
git add -A && git commit -m "chore: build verification"
```

---

## Task 14: README with usage instructions

**Files:**
- Create: `README.md`
- Create: `examples/character.yaml`

- [ ] **Step 1: Create examples/character.yaml**

`examples/character.yaml`: copy the full config from the spec's Configuration section.

- [ ] **Step 2: Create README.md**

`README.md`:
```markdown
# sprite-compiler

Turns a `character.yaml` into an Excalibur.js spritesheet, metadata JSON,
animation code, and a runnable preview app — using OpenRouter
(`openai/gpt-5.4-image-2` + `bytedance-seed/seed-2.0-lite`) for AI generation.

## Requirements

- Node ≥ 20
- `ffmpeg` and `ffprobe` on PATH
- `OPEN-ROUTER_KEY` env var

## Install

\`\`\`bash
npm install
npm run build
\`\`\`

## Use

\`\`\`bash
export OPEN-ROUTER_KEY=sk-or-v1-...
node dist/cli.js build examples/character.yaml
\`\`\`

Outputs land in `./out/`:

- `hero.png` — spritesheet
- `hero.json` — metadata
- `animations.ts` — generated Excalibur code
- `preview/` — runnable Vite + Excalibur scene

\`\`\`bash
cd out/preview
npm install
npm run dev
\`\`\`

Open `http://localhost:5173` to see idle / run / attack cycle.

## How it works

Six-stage pipeline; each stage is content-addressed and cached under
`.sprite-cache/`. Re-running after only changing post-processing
reuses the API outputs.

1. **Reference** — Image 2 generates a side-view character reference.
2. **Video** — Seedance generates a short motion draft from the reference + prompt.
3. **Extract** — ffmpeg samples N evenly spaced frames.
4. **Clean** — chroma-key removes the magenta background; alpha-bbox crop;
   place at feet-center on a 64 × 64 transparent canvas.
5. **Pack** — composite all action frames into one horizontal strip.
6. **Emit** — render `animations.ts` and copy the preview scaffold.

Pass `--force` to ignore the cache.

## Limits (MVP)

- One character per config
- Three actions: `idle`, `run`, `attack`
- Single direction (facing right)
- 64 × 64 frames
- Uniform frame sampling; no pose-aware selection
```

- [ ] **Step 3: Commit**

```bash
git add README.md examples/character.yaml
git commit -m "docs: add README and example config"
```

---

## Task 15: Final integration check

- [ ] **Step 1: Verify full suite**

```bash
npm test
```
Expected: all tests pass.

- [ ] **Step 2: Verify clean git tree**

```bash
git status
```
Expected: nothing to commit, working tree clean.
