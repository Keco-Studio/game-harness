import { describe, it, expect } from "vitest";
import { version } from "../src/index.js";

describe("package", () => {
  it("exports a version string", () => {
    expect(typeof version).toBe("string");
    expect(version.length).toBeGreaterThan(0);
  });
});
