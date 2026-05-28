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
