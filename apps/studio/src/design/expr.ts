/**
 * The design expression language (lighting-and-backgrounds §3.3; grammar in xds/designs.py).
 *
 * `check` parses with a small recursive-descent parser for exactly the grammar the Python gate
 * accepts, so both sides reject the same things (expr-eval alone accepts more: `and`, `^`, `?:`…).
 * `evaluate` then hands the checked text to `expr-eval`, configured with only our functions.
 */
import { Parser } from "expr-eval";
import * as color from "./color";

export type ExprValue = number | string | boolean;
export type Scope = Record<string, unknown>;

/** name → [min args, max args] (max null = variadic). Mirrors designs.FUNCTIONS. */
export const FUNCTIONS: Record<string, [number, number | null]> = {
  min: [1, null], max: [1, null], clamp: [3, 3], round: [1, 2], floor: [1, 1], ceil: [1, 1],
  abs: [1, 1], sin: [1, 1], cos: [1, 1], sqrt: [1, 1], pow: [2, 2], lerp: [3, 3], cond: [3, 3],
  tone: [2, 3], shade: [2, 2], mix: [3, 3], alpha: [2, 2], hue: [2, 2],
};

export class ExprError extends Error {
  kind: "syntax" | "name";
  constructor(kind: "syntax" | "name", message: string) {
    super(message);
    this.kind = kind;
  }
}

// --- tokenizer + grammar check ---------------------------------------------------------------

type Tok =
  | { t: "num"; v: string }
  | { t: "str"; v: string }
  | { t: "name"; v: string }
  | { t: "op"; v: string }
  | { t: "end" };

const OPS = ["==", "!=", "<=", ">=", "<", ">", "+", "-", "*", "/", "%", "(", ")", ","];

function tokenize(src: string): Tok[] {
  const toks: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (c === " " || c === "\t" || c === "\n" || c === "\r") {
      i++;
      continue;
    }
    if (/[0-9]/.test(c) || (c === "." && /[0-9]/.test(src[i + 1] ?? ""))) {
      const m = /^[0-9]+(\.[0-9]+)?/.exec(src.slice(i));
      if (!m) throw new ExprError("syntax", `bad number at ${i}`);
      const after = src[i + m[0].length] ?? "";
      if (/[A-Za-z_0-9.]/.test(after)) throw new ExprError("syntax", `bad number at ${i}`);
      toks.push({ t: "num", v: m[0] });
      i += m[0].length;
      continue;
    }
    if (c === "'" || c === '"') {
      const end = src.indexOf(c, i + 1);
      if (end < 0) throw new ExprError("syntax", "unterminated string");
      const body = src.slice(i + 1, end);
      if (body.includes("\n") || body.includes("\\")) throw new ExprError("syntax", "unsupported string");
      toks.push({ t: "str", v: body });
      i = end + 1;
      continue;
    }
    if (/[A-Za-z_]/.test(c)) {
      const m = /^[A-Za-z_][A-Za-z_0-9]*(\.[A-Za-z_][A-Za-z_0-9]*)*/.exec(src.slice(i))!;
      if (src[i + m[0].length] === ".") throw new ExprError("syntax", `bad name at ${i}`);
      toks.push({ t: "name", v: m[0] });
      i += m[0].length;
      continue;
    }
    const op = OPS.find((o) => src.startsWith(o, i));
    if (!op) throw new ExprError("syntax", `unexpected '${c}' at ${i}`);
    // reject `**`, `//`, `=` alone etc. by the next-token rules below
    toks.push({ t: "op", v: op });
    i += op.length;
  }
  toks.push({ t: "end" });
  return toks;
}

const KEYWORDS = new Set(["and", "or", "not", "if", "else", "in", "is", "lambda"]);

/** Parse for the grammar only; returns the dotted names read. Throws ExprError("syntax"). */
function parseNames(src: string): string[] {
  const toks = tokenize(src);
  let p = 0;
  const names: string[] = [];
  const peek = () => toks[p];
  const isOp = (v: string) => {
    const t = toks[p];
    return t.t === "op" && t.v === v;
  };
  const expect = (v: string) => {
    if (!isOp(v)) throw new ExprError("syntax", `expected '${v}'`);
    p++;
  };

  function expr() {
    sum();
    const t = peek();
    if (t.t === "op" && ["==", "!=", "<", "<=", ">", ">="].includes(t.v)) {
      p++;
      sum();
      const n = peek();
      if (n.t === "op" && ["==", "!=", "<", "<=", ">", ">="].includes(n.v)) throw new ExprError("syntax", "chained comparison");
    }
  }
  function sum() {
    product();
    while (isOp("+") || isOp("-")) {
      p++;
      product();
    }
  }
  function product() {
    unary();
    while (isOp("*") || isOp("/") || isOp("%")) {
      p++;
      unary();
    }
  }
  function unary() {
    if (isOp("-") || isOp("+")) {
      p++;
      unary();
      return;
    }
    atom();
  }
  function atom() {
    const t = peek();
    if (t.t === "num" || t.t === "str") {
      p++;
      return;
    }
    if (t.t === "name") {
      if (KEYWORDS.has(t.v)) throw new ExprError("syntax", `'${t.v}' is not supported`);
      p++;
      if (isOp("(")) {
        const spec = FUNCTIONS[t.v];
        if (!spec) throw new ExprError("syntax", `unknown function '${t.v}'`);
        p++;
        let argc = 0;
        if (!isOp(")")) {
          expr();
          argc++;
          while (isOp(",")) {
            p++;
            expr();
            argc++;
          }
        }
        expect(")");
        if (argc < spec[0] || (spec[1] !== null && argc > spec[1])) {
          throw new ExprError("syntax", `${t.v}() takes ${spec[0]}${spec[1] === spec[0] ? "" : `..${spec[1] ?? "n"}`} arguments`);
        }
        return;
      }
      names.push(t.v);
      return;
    }
    if (isOp("(")) {
      p++;
      expr();
      expect(")");
      return;
    }
    throw new ExprError("syntax", "expected a value");
  }

  if (peek().t === "end") throw new ExprError("syntax", "empty expression");
  expr();
  if (peek().t !== "end") throw new ExprError("syntax", "unexpected text after the expression");
  return names;
}

function lookup(scope: Scope, dotted: string): { found: boolean; value: unknown } {
  let cur: unknown = scope;
  for (const part of dotted.split(".")) {
    if (cur === null || typeof cur !== "object" || !Object.prototype.hasOwnProperty.call(cur, part)) {
      return { found: false, value: undefined };
    }
    cur = (cur as Record<string, unknown>)[part];
  }
  return { found: true, value: cur };
}

/** Grammar + names check. A name is known when it resolves to a non-object value in `scope`. */
export function check(src: string, scope: Scope): void {
  for (const n of parseNames(src)) {
    const r = lookup(scope, n);
    if (!r.found || (r.value !== null && typeof r.value === "object")) throw new ExprError("name", `unknown name '${n}'`);
  }
}

// --- evaluation with expr-eval ----------------------------------------------------------------

function numArg(v: unknown): number {
  if (typeof v !== "number") throw new Error(`expected a number, got ${JSON.stringify(v)}`);
  return v;
}

function makeParser(): Parser {
  const parser = new Parser({ allowMemberAccess: true });
  const p = parser as unknown as { unaryOps: Record<string, unknown>; functions: Record<string, unknown>; consts: Record<string, unknown> };
  p.unaryOps = { "-": (x: unknown) => -numArg(x), "+": (x: unknown) => numArg(x) };
  p.consts = {};
  p.functions = {
    min: (...a: unknown[]) => Math.min(...a.map(numArg)),
    max: (...a: unknown[]) => Math.max(...a.map(numArg)),
    clamp: (x: unknown, lo: unknown, hi: unknown) => Math.min(Math.max(numArg(x), numArg(lo)), numArg(hi)),
    round: (x: unknown, d: unknown = 0) => {
      const f = 10 ** Math.trunc(numArg(d));
      return Math.floor(numArg(x) * f + 0.5) / f;
    },
    floor: (x: unknown) => Math.floor(numArg(x)),
    ceil: (x: unknown) => Math.ceil(numArg(x)),
    abs: (x: unknown) => Math.abs(numArg(x)),
    sin: (x: unknown) => Math.sin(numArg(x)),
    cos: (x: unknown) => Math.cos(numArg(x)),
    sqrt: (x: unknown) => Math.sqrt(numArg(x)),
    pow: (a: unknown, b: unknown) => Math.pow(numArg(a), numArg(b)),
    lerp: (a: unknown, b: unknown, t: unknown) => numArg(a) + (numArg(b) - numArg(a)) * numArg(t),
    cond: (t: unknown, a: unknown, b: unknown) => (t ? a : b),
    tone: color.tone,
    shade: color.shade,
    mix: color.mix,
    alpha: color.alpha,
    hue: color.hue,
  };
  return parser;
}

const parser = makeParser();
const compiled = new Map<string, ReturnType<Parser["parse"]>>();

/** Check, then evaluate `src` in `scope`. Throws ExprError for bad syntax/names, Error for runtime errors. */
export function evaluate(src: string, scope: Scope): ExprValue {
  check(src, scope);
  let e = compiled.get(src);
  if (!e) {
    e = parser.parse(src);
    compiled.set(src, e);
  }
  return e.evaluate(scope as never) as ExprValue;
}

/** Write a value into SVG text like JavaScript's String(v). */
export function formatValue(v: unknown): string {
  if (typeof v === "number") return String(Number.isInteger(v) ? v : Number(v.toPrecision(12)));
  return String(v);
}

const PLACEHOLDER = /\{\{([\s\S]*?)\}\}/g;

export function hasPlaceholder(s: string): boolean {
  return s.includes("{{");
}

/**
 * Replace every `{{ expr }}` in `text`. A string that is exactly one placeholder returns the raw
 * value (so `data-xds-count` can read a number); otherwise values are formatted into the text.
 */
export function interpolate(text: string, scope: Scope): ExprValue | string {
  const only = /^\s*\{\{([\s\S]*?)\}\}\s*$/.exec(text);
  if (only && !only[1].includes("{{")) return evaluate(only[1], scope);
  return text.replace(PLACEHOLDER, (_, src: string) => formatValue(evaluate(src, scope)));
}
