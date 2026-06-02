// TunerPro XDF MATH expressions describe the raw→engineering conversion
// for a constant or axis. Grammar observed in real-world files:
//
//   expression: term (('+' | '-') term)*
//   term:       factor (('*' | '/') factor)*
//   factor:     '-' factor | '(' expression ')' | NUMBER | IDENT
//   NUMBER:     /-?[0-9]+(\.[0-9]+)?([eE][+-]?[0-9]+)?/
//   IDENT:      X, Y, Z   (axis/cell variables)
//
// Real samples: "X", "0.75*X-48.0", "X*0.01", "X-100", "X+0".
// Strictly arithmetic — no calls, no power op. If TunerPro.exe ends up
// supporting a richer grammar, add the new tokens here.

export type Expr =
  | { kind: "num"; value: number }
  | { kind: "var"; name: string }
  | { kind: "neg"; arg: Expr }
  | { kind: "binop"; op: "+" | "-" | "*" | "/"; left: Expr; right: Expr };

export class MathParseError extends Error {
  constructor(
    message: string,
    public readonly source: string,
    public readonly position: number,
  ) {
    super(`${message} at position ${position} of "${source}"`);
    this.name = "MathParseError";
  }
}

class Parser {
  private pos = 0;
  constructor(private readonly src: string) {}

  parse(): Expr {
    const expr = this.parseExpr();
    this.skipWs();
    if (this.pos < this.src.length) {
      throw new MathParseError(`Unexpected "${this.src[this.pos]}"`, this.src, this.pos);
    }
    return expr;
  }

  private parseExpr(): Expr {
    let left = this.parseTerm();
    while (true) {
      this.skipWs();
      const ch = this.src[this.pos];
      if (ch !== "+" && ch !== "-") return left;
      this.pos++;
      const right = this.parseTerm();
      left = { kind: "binop", op: ch, left, right };
    }
  }

  private parseTerm(): Expr {
    let left = this.parseFactor();
    while (true) {
      this.skipWs();
      const ch = this.src[this.pos];
      if (ch !== "*" && ch !== "/") return left;
      this.pos++;
      const right = this.parseFactor();
      left = { kind: "binop", op: ch, left, right };
    }
  }

  private parseFactor(): Expr {
    this.skipWs();
    const ch = this.src[this.pos];
    if (ch === undefined) {
      throw new MathParseError("Unexpected end of expression", this.src, this.pos);
    }
    if (ch === "-") {
      this.pos++;
      return { kind: "neg", arg: this.parseFactor() };
    }
    if (ch === "+") {
      this.pos++;
      return this.parseFactor();
    }
    if (ch === "(") {
      this.pos++;
      const inner = this.parseExpr();
      this.skipWs();
      if (this.src[this.pos] !== ")") {
        throw new MathParseError("Expected ')'", this.src, this.pos);
      }
      this.pos++;
      return inner;
    }
    if (/[0-9.]/.test(ch)) {
      return this.parseNumber();
    }
    if (/[A-Za-z_]/.test(ch)) {
      return this.parseIdent();
    }
    throw new MathParseError(`Unexpected "${ch}"`, this.src, this.pos);
  }

  private parseNumber(): Expr {
    const start = this.pos;
    while (this.pos < this.src.length && /[0-9.]/.test(this.src[this.pos])) {
      this.pos++;
    }
    // Optional exponent.
    if (
      this.pos < this.src.length &&
      (this.src[this.pos] === "e" || this.src[this.pos] === "E")
    ) {
      this.pos++;
      if (this.src[this.pos] === "+" || this.src[this.pos] === "-") this.pos++;
      while (this.pos < this.src.length && /[0-9]/.test(this.src[this.pos])) {
        this.pos++;
      }
    }
    const text = this.src.slice(start, this.pos);
    const value = Number(text);
    if (!Number.isFinite(value)) {
      throw new MathParseError(`Invalid number "${text}"`, this.src, start);
    }
    return { kind: "num", value };
  }

  private parseIdent(): Expr {
    const start = this.pos;
    while (this.pos < this.src.length && /[A-Za-z0-9_]/.test(this.src[this.pos])) {
      this.pos++;
    }
    return { kind: "var", name: this.src.slice(start, this.pos).toUpperCase() };
  }

  private skipWs(): void {
    while (this.pos < this.src.length && /\s/.test(this.src[this.pos])) {
      this.pos++;
    }
  }
}

export function parseMath(src: string): Expr {
  return new Parser(src).parse();
}

/**
 * Evaluate an expression with a single named variable (X by default).
 * Throws if an unknown variable is referenced.
 */
export function evalMath(expr: Expr, vars: Record<string, number>): number {
  switch (expr.kind) {
    case "num":
      return expr.value;
    case "var": {
      const v = vars[expr.name];
      if (typeof v !== "number") {
        throw new Error(`Unbound variable "${expr.name}"`);
      }
      return v;
    }
    case "neg":
      return -evalMath(expr.arg, vars);
    case "binop": {
      const l = evalMath(expr.left, vars);
      const r = evalMath(expr.right, vars);
      switch (expr.op) {
        case "+":
          return l + r;
        case "-":
          return l - r;
        case "*":
          return l * r;
        case "/":
          return l / r;
      }
    }
  }
}

/**
 * Compile to a `(raw) => engineering` function. The MATH variable is
 * conventionally `X`; axis equations occasionally use other names but
 * we stay generic.
 */
export function compileMath(src: string, varName = "X"): (x: number) => number {
  const ast = parseMath(src);
  return (x: number) => evalMath(ast, { [varName.toUpperCase()]: x });
}

/**
 * Detect linear form `aX + b` and return the coefficients. Returns null
 * if the expression is non-linear in `varName` (e.g. contains X*X, X/X,
 * or another unknown variable). Constants alone return { a: 0, b: c }.
 */
export function linearize(
  expr: Expr,
  varName = "X",
): { a: number; b: number } | null {
  const v = varName.toUpperCase();
  switch (expr.kind) {
    case "num":
      return { a: 0, b: expr.value };
    case "var":
      return expr.name === v ? { a: 1, b: 0 } : null;
    case "neg": {
      const inner = linearize(expr.arg, v);
      if (!inner) return null;
      // Negating 0 yields -0 in IEEE-754; normalise so equality tests
      // and downstream consumers don't see two distinct "zeros".
      return {
        a: inner.a === 0 ? 0 : -inner.a,
        b: inner.b === 0 ? 0 : -inner.b,
      };
    }
    case "binop": {
      const l = linearize(expr.left, v);
      const r = linearize(expr.right, v);
      if (!l || !r) return null;
      switch (expr.op) {
        case "+":
          return { a: l.a + r.a, b: l.b + r.b };
        case "-":
          return { a: l.a - r.a, b: l.b - r.b };
        case "*":
          // (a1 X + b1)(a2 X + b2) is linear only if one side has a==0.
          if (l.a === 0) return { a: l.b * r.a, b: l.b * r.b };
          if (r.a === 0) return { a: r.b * l.a, b: r.b * l.b };
          return null;
        case "/":
          // Numerator may include X; denominator must not.
          if (r.a !== 0) return null;
          if (r.b === 0) return null;
          return { a: l.a / r.b, b: l.b / r.b };
      }
    }
  }
}

/**
 * Build the inverse `(engineering) => raw` from a linear expression.
 * Returns null when the expression isn't invertible (non-linear, or
 * constant with no X dependency — write-back would be ambiguous).
 */
export function invertLinear(src: string, varName = "X"): ((y: number) => number) | null {
  const ast = parseMath(src);
  const lin = linearize(ast, varName);
  if (!lin || lin.a === 0) return null;
  const { a, b } = lin;
  return (y: number) => (y - b) / a;
}
