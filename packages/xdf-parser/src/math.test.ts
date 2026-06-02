import { describe, it, expect } from "vitest";
import {
  parseMath,
  evalMath,
  compileMath,
  linearize,
  invertLinear,
  MathParseError,
} from "./math";

describe("parseMath", () => {
  it("parses bare X", () => {
    expect(parseMath("X")).toEqual({ kind: "var", name: "X" });
  });

  it("parses a number", () => {
    expect(parseMath("3.14")).toEqual({ kind: "num", value: 3.14 });
  });

  it("respects operator precedence", () => {
    // 1 + 2 * 3 → 1 + (2 * 3), not (1 + 2) * 3
    const ast = parseMath("1+2*3");
    expect(evalMath(ast, {})).toBe(7);
  });

  it("respects parentheses", () => {
    const ast = parseMath("(1+2)*3");
    expect(evalMath(ast, {})).toBe(9);
  });

  it("handles unary minus", () => {
    expect(evalMath(parseMath("-5"), {})).toBe(-5);
    expect(evalMath(parseMath("-X"), { X: 3 })).toBe(-3);
  });

  it("handles scientific notation", () => {
    expect(evalMath(parseMath("1.5e2"), {})).toBe(150);
    expect(evalMath(parseMath("1e-3"), {})).toBe(0.001);
  });

  it("tolerates whitespace", () => {
    expect(evalMath(parseMath("  1 +  2  "), {})).toBe(3);
  });

  it("rejects unexpected tokens", () => {
    expect(() => parseMath("1 @ 2")).toThrow(MathParseError);
  });

  it("rejects mismatched parentheses", () => {
    expect(() => parseMath("(1+2")).toThrow(MathParseError);
  });
});

describe("compileMath — real XDF expressions", () => {
  it("identity X", () => {
    const f = compileMath("X");
    expect(f(42)).toBe(42);
  });

  it("0.75*X-48.0 (coolant temp scale)", () => {
    const f = compileMath("0.75*X-48.0");
    expect(f(0)).toBe(-48);
    expect(f(64)).toBe(0);
    expect(f(255)).toBeCloseTo(143.25, 5);
  });

  it("X*0.01 (seconds scale)", () => {
    const f = compileMath("X*0.01");
    expect(f(100)).toBeCloseTo(1.0, 5);
  });

  it("throws on unbound variable", () => {
    expect(() => compileMath("Y")(1)).toThrow();
  });
});

describe("linearize", () => {
  it("X → (1, 0)", () => {
    expect(linearize(parseMath("X"))).toEqual({ a: 1, b: 0 });
  });
  it("constant → (0, c)", () => {
    expect(linearize(parseMath("42"))).toEqual({ a: 0, b: 42 });
  });
  it("0.75*X-48 → (0.75, -48)", () => {
    expect(linearize(parseMath("0.75*X-48"))).toEqual({ a: 0.75, b: -48 });
  });
  it("X*0.01 → (0.01, 0)", () => {
    expect(linearize(parseMath("X*0.01"))).toEqual({ a: 0.01, b: 0 });
  });
  it("X/100 → (0.01, 0)", () => {
    const lin = linearize(parseMath("X/100"));
    expect(lin?.a).toBeCloseTo(0.01, 10);
    expect(lin?.b).toBe(0);
  });
  it("-X → (-1, 0)", () => {
    expect(linearize(parseMath("-X"))).toEqual({ a: -1, b: 0 });
  });
  it("rejects X*X", () => {
    expect(linearize(parseMath("X*X"))).toBeNull();
  });
  it("rejects 1/X", () => {
    expect(linearize(parseMath("1/X"))).toBeNull();
  });
  it("rejects unknown variable", () => {
    expect(linearize(parseMath("Y"))).toBeNull();
  });
});

describe("invertLinear", () => {
  it("inverts 0.75*X-48.0", () => {
    const inv = invertLinear("0.75*X-48.0");
    expect(inv).not.toBeNull();
    expect(inv!(0)).toBeCloseTo(64, 5);
    expect(inv!(-48)).toBe(0);
  });

  it("inverts X", () => {
    const inv = invertLinear("X");
    expect(inv!(7)).toBe(7);
  });

  it("returns null for constant (no X)", () => {
    expect(invertLinear("42")).toBeNull();
  });

  it("returns null for non-linear", () => {
    expect(invertLinear("X*X")).toBeNull();
  });
});
