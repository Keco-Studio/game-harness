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
    await cache.corruptForTest(key);
    expect(await cache.get(key)).toBeNull();
  });
});
