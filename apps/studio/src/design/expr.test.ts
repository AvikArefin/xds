import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { evaluate, ExprError, interpolate } from "./expr";
import { mix, tone } from "./color";

const fixture = JSON.parse(
  readFileSync(fileURLToPath(new URL("../../../../tests/fixtures/design-expressions.json", import.meta.url)), "utf8"),
) as {
  context: { width: number; height: number; subject: Record<string, number>; brand: Record<string, string>; params: Record<string, unknown> };
  cases: { expr: string; ok: boolean; value?: unknown; error?: "syntax" | "name"; names?: Record<string, unknown> }[];
};

function scopeFor(names: Record<string, unknown> = {}) {
  const c = fixture.context;
  return { ...c.params, width: c.width, height: c.height, subject: c.subject, brand: c.brand, ...names };
}

describe("design expressions (tests/fixtures/design-expressions.json)", () => {
  for (const c of fixture.cases) {
    it(`${JSON.stringify(c.expr)} → ${c.ok ? JSON.stringify(c.value ?? "ok") : c.error}`, () => {
      if (c.ok) {
        const v = evaluate(c.expr, scopeFor(c.names));
        if (c.value === undefined) {
          expect(typeof v === "string" && /^#[0-9a-f]{6}([0-9a-f]{2})?$/.test(v)).toBe(true);
        } else if (typeof c.value === "number") {
          expect(typeof v).toBe("number");
          expect(Math.abs((v as number) - c.value)).toBeLessThan(1e-9);
        } else {
          expect(v).toBe(c.value);
        }
      } else {
        let err: unknown = null;
        try {
          evaluate(c.expr, scopeFor(c.names));
        } catch (e) {
          err = e;
        }
        expect(err).toBeInstanceOf(ExprError);
        expect((err as ExprError).kind).toBe(c.error);
      }
    });
  }
});

describe("color functions", () => {
  it("keeps lightness ordering and stays in gamut", () => {
    expect(tone("#ff5a1f", 0.98, 0.3)).toMatch(/^#[0-9a-f]{6}$/);
    expect(mix("#000000", "#ffffff", 0)).toBe("#000000");
    expect(mix("#000000", "#ffffff", 1)).toBe("#ffffff");
  });
});

describe("interpolate", () => {
  it("returns the raw value for a lone placeholder and formats mixed text", () => {
    expect(interpolate("{{ width / 2 }}", scopeFor())).toBe(540);
    expect(interpolate("translate({{width/2}}, {{ subject.cy }})", scopeFor())).toBe("translate(540, 700)");
  });
});
