import { describe, it, expect } from "vitest";
import { resolveAddress, parseXdf } from "./index";

describe("resolveAddress", () => {
  it("adds when subtract=false", () => {
    expect(resolveAddress(0x100, { offset: 0x40, subtract: false })).toBe(0x140);
  });
  it("subtracts when subtract=true", () => {
    expect(resolveAddress(0x100, { offset: 0x40, subtract: true })).toBe(0xc0);
  });
});

describe("parseXdf", () => {
  it("throws until Milestone 2 lands", () => {
    expect(() => parseXdf("<XDFFORMAT/>")).toThrow();
  });
});
