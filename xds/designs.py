"""Ground designs: `designs/<id>.svg` files that hold artwork plus a knob manifest.

A design is an ordinary SVG with three additions, all resolved by the browser
(`apps/studio/src/design/resolve.ts`) and checked here, without a browser:

1. **Manifest.** `<metadata id="xds-design">` contains JSON matching `DesignManifest`
   (`models.py`): the params a ground node can set, and named variants.

2. **Placeholders.** `{{ expr }}` anywhere in an attribute value or in text. An attribute that is
   exactly one placeholder takes the value as is; otherwise each placeholder is replaced by its
   value as text (numbers formatted like JavaScript's `String(x)`, booleans as `true`/`false`).

3. **Loops.** An element with `data-xds-repeat="i"` and `data-xds-count="{{ expr }}"` is repeated
   `count` times. In each copy, `i` is the copy's index (0 .. count-1) and `n` is the count; both
   are visible in the element's own attributes and in all its descendants. The count expression
   itself is evaluated in the *outer* scope; it is floored and clamped to 0..500. The variable
   name is any identifier that is not already a known name; nested loops must use different
   names (`i`, `j`, …) and `n` always means the innermost count. Both `data-xds-*` attributes are
   removed from the output. Give repeated elements' ids an `{{i}}` suffix so they stay unique.

**Expression language** (lighting-and-backgrounds §3.3). The grammar both sides accept:

    expr     := compare
    compare  := sum [ ("==" | "!=" | "<" | "<=" | ">" | ">=") sum ]     (not chained)
    sum      := product { ("+" | "-") product }
    product  := unary { ("*" | "/" | "%") unary }
    unary    := ("-" | "+") unary | atom
    atom     := NUMBER | STRING | name | call | "(" expr ")"
    name     := IDENT { "." IDENT }            e.g. width, subject.cx, brand.paper, glow
    call     := FUNCTION "(" [ expr { "," expr } ] ")"
    NUMBER   := digits [ "." digits ]          (no exponent, hex, or underscores)
    STRING   := '…' or "…"                     (single line; for color literals like '#1a1a1a')

Nothing else: no `and`/`or`/`not`, no `^` or `**`, no ternary (use `cond(test, a, b)`), no
member access on anything but names, no indexing. `%` and `round` follow JavaScript
(`-7 % 3 == -1`; `round(2.5) == 3`).

Known names: `width`, `height`, `subject.{x,y,w,h,cx,cy,floor}`, `brand.<token>` for every
brand color, the manifest's param names, and the loop variables in scope.

Functions (`FUNCTIONS`): math `min max clamp round floor ceil abs sin cos sqrt pow lerp cond`;
color (OKLCH, via culori in the browser) `tone(color, lightness, chroma?)`, `shade(color, dL)`,
`mix(a, b, t)` (interpolated in OKLab), `alpha(color, a)`, `hue(color, degrees)`. Color results
are gamut-mapped to sRGB by reducing chroma and written as `#rrggbb` (`#rrggbbaa` when alpha < 1).

**Color params** take either a hex string (`#rrggbb`) or the name of a brand color token
(`"paper"`). The resolver replaces a token name by its hex before evaluating, so inside an
expression a color param is always a hex string. Starters use neutral hex defaults so they work
in any project; set a token name on the node to follow the brand.
"""

from __future__ import annotations

import ast
import io
import json
import math
import re
import shutil
import tokenize
import xml.etree.ElementTree as ET
from collections.abc import Iterator
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from pydantic import ValidationError

from .models import DesignManifest, DesignParam, Finding, GroundNode, Project

STARTERS_DIR = Path(__file__).parent / "resources" / "designs"
SVG_NS = "http://www.w3.org/2000/svg"
PLACEHOLDER = re.compile(r"\{\{(.*?)\}\}", re.S)
MAX_REPEAT = 500
SUBJECT_KEYS = ("x", "y", "w", "h", "cx", "cy", "floor")
HEX = re.compile(r"^#[0-9a-fA-F]{6}$")

# name → (min args, max args or None for "any number")
FUNCTIONS: dict[str, tuple[int, int | None]] = {
    "min": (1, None), "max": (1, None), "clamp": (3, 3), "round": (1, 2), "floor": (1, 1),
    "ceil": (1, 1), "abs": (1, 1), "sin": (1, 1), "cos": (1, 1), "sqrt": (1, 1),
    "pow": (2, 2), "lerp": (3, 3), "cond": (3, 3),
    "tone": (2, 3), "shade": (2, 2), "mix": (3, 3), "alpha": (2, 2), "hue": (2, 2),
}
RESERVED = {"width", "height", "subject", "brand", "n", *FUNCTIONS}

_OPS = {"+", "-", "*", "/", "%", "(", ")", ",", ".", "==", "!=", "<", "<=", ">", ">="}
_NUMBER = re.compile(r"^(\d+(\.\d+)?)$")
_BINOPS = (ast.Add, ast.Sub, ast.Mult, ast.Div, ast.Mod)
_CMPOPS = (ast.Eq, ast.NotEq, ast.Lt, ast.LtE, ast.Gt, ast.GtE)


class ExpressionError(ValueError):
    pass


# --- expressions -----------------------------------------------------------------------------

def base_names(brand_tokens: list[str] | set[str] = ()) -> set[str]:
    """The names every design can read: canvas size, subject bounds and brand colors."""
    return ({"width", "height"} | {f"subject.{k}" for k in SUBJECT_KEYS}
            | {f"brand.{t}" for t in brand_tokens})


def _check_tokens(expr: str) -> None:
    """Reject Python-only syntax the AST would accept (`**`, `0x1`, `r''`, `"a" "b"`, keywords)."""
    try:
        tokens = list(tokenize.generate_tokens(io.StringIO(expr).readline))
    except (tokenize.TokenError, IndentationError, SyntaxError) as e:
        raise ExpressionError(f"does not parse: {e}") from e
    prev = None
    for tok in tokens:
        if tok.type in (tokenize.NEWLINE, tokenize.NL, tokenize.ENDMARKER, tokenize.INDENT,
                        tokenize.DEDENT):
            continue
        if tok.type == tokenize.OP and tok.string not in _OPS:
            raise ExpressionError(f"operator '{tok.string}' is not supported")
        if tok.type == tokenize.NUMBER and not _NUMBER.match(tok.string):
            raise ExpressionError(f"number '{tok.string}' is not supported (use plain decimals)")
        if tok.type == tokenize.STRING:
            if tok.string[0] not in "'\"" or tok.string[:3] in ("'''", '"""'):
                raise ExpressionError(f"string {tok.string} is not supported (use '…' or \"…\")")
            if prev == tokenize.STRING:
                raise ExpressionError("two strings in a row")
        if tok.type == tokenize.NAME and tok.string in _KEYWORDS:
            raise ExpressionError(f"'{tok.string}' is not supported"
                                  + (" (use cond(test, a, b))" if tok.string == "if" else ""))
        if tok.type not in (tokenize.OP, tokenize.NUMBER, tokenize.STRING, tokenize.NAME):
            raise ExpressionError(f"unexpected '{tok.string}'")
        prev = tok.type


_KEYWORDS = {"and", "or", "not", "if", "else", "in", "is", "lambda", "True", "False", "None",
             "for", "await", "yield", "async"}


def _dotted(node: ast.AST) -> str | None:
    if isinstance(node, ast.Name):
        return node.id
    if isinstance(node, ast.Attribute):
        base = _dotted(node.value)
        return f"{base}.{node.attr}" if base else None
    return None


def parse(expr: str) -> ast.expr:
    """Parse one placeholder body into a restricted AST, or raise ExpressionError."""
    if not expr.strip():
        raise ExpressionError("empty expression")
    if "\n" in expr.strip():
        raise ExpressionError("expressions are one line")
    _check_tokens(expr)
    try:
        tree = ast.parse(expr.strip(), mode="eval").body
    except SyntaxError as e:
        raise ExpressionError(f"does not parse: {e.msg}") from e
    _validate(tree)
    return tree


def _validate(node: ast.AST) -> None:
    if isinstance(node, ast.Constant):
        if isinstance(node.value, bool) or not isinstance(node.value, (int, float, str)):
            raise ExpressionError(f"literal {node.value!r} is not supported")
    elif isinstance(node, (ast.Name, ast.Attribute)):
        if _dotted(node) is None:
            raise ExpressionError("member access works on names only")
    elif isinstance(node, ast.BinOp):
        if not isinstance(node.op, _BINOPS):
            raise ExpressionError("only + - * / % are supported")
        _validate(node.left)
        _validate(node.right)
    elif isinstance(node, ast.UnaryOp):
        if not isinstance(node.op, (ast.USub, ast.UAdd)):
            raise ExpressionError("only unary - and + are supported")
        _validate(node.operand)
    elif isinstance(node, ast.Compare):
        if len(node.ops) != 1 or not isinstance(node.ops[0], _CMPOPS):
            raise ExpressionError("one comparison (== != < <= > >=) at a time")
        _validate(node.left)
        _validate(node.comparators[0])
    elif isinstance(node, ast.Call):
        name = node.func.id if isinstance(node.func, ast.Name) else None
        if name not in FUNCTIONS:
            raise ExpressionError(f"unknown function '{_dotted(node.func) or '?'}'")
        if node.keywords or any(isinstance(a, ast.Starred) for a in node.args):
            raise ExpressionError(f"{name}() takes plain positional arguments")
        lo, hi = FUNCTIONS[name]
        if len(node.args) < lo or (hi is not None and len(node.args) > hi):
            want = f"{lo}" if lo == hi else f"{lo}+" if hi is None else f"{lo}-{hi}"
            raise ExpressionError(f"{name}() takes {want} arguments, got {len(node.args)}")
        for a in node.args:
            _validate(a)
    else:
        raise ExpressionError(f"{type(node).__name__} is not supported")


def names_in(tree: ast.AST) -> list[str]:
    """The (dotted) variable names an expression reads, in order."""
    out: list[str] = []

    def walk(node: ast.AST) -> None:
        if isinstance(node, (ast.Name, ast.Attribute)):
            out.append(_dotted(node) or "?")
        elif isinstance(node, ast.Call):
            for a in node.args:
                walk(a)
        else:
            for child in ast.iter_child_nodes(node):
                walk(child)

    walk(tree)
    return out


def check_expression(expr: str, names: set[str]) -> tuple[str, str] | None:
    """`None` if the expression is valid; else `(code, message)` with code
    `DESIGN_BAD_EXPRESSION` (syntax) or `DESIGN_UNKNOWN_PARAM` (a name that isn't known)."""
    try:
        tree = parse(expr)
    except ExpressionError as e:
        return "DESIGN_BAD_EXPRESSION", f"{{{{{expr.strip()}}}}}: {e}"
    unknown = [n for n in names_in(tree) if n not in names]
    if unknown:
        return "DESIGN_UNKNOWN_PARAM", f"{{{{{expr.strip()}}}}}: unknown name '{unknown[0]}'"
    return None


# --- evaluation (a Python mirror of resolve.ts, used for previews and tests) -----------------

def evaluate(expr: str | ast.expr, scope: dict[str, Any]) -> Any:
    """Evaluate an expression. `scope` maps (dotted) names to values; colors are hex strings."""
    tree = parse(expr) if isinstance(expr, str) else expr
    return _eval(tree, scope)


def _eval(node: ast.AST, scope: dict[str, Any]) -> Any:
    if isinstance(node, ast.Constant):
        return node.value
    if isinstance(node, (ast.Name, ast.Attribute)):
        name = _dotted(node)
        if name not in scope:
            raise ExpressionError(f"unknown name '{name}'")
        return scope[name]
    if isinstance(node, ast.UnaryOp):
        v = _num(_eval(node.operand, scope))
        return -v if isinstance(node.op, ast.USub) else v
    if isinstance(node, ast.BinOp):
        a, b = _num(_eval(node.left, scope)), _num(_eval(node.right, scope))
        op = node.op
        if isinstance(op, ast.Add):
            return a + b
        if isinstance(op, ast.Sub):
            return a - b
        if isinstance(op, ast.Mult):
            return a * b
        if b == 0:
            return math.nan if isinstance(op, ast.Mod) or a == 0 else math.copysign(math.inf, a)
        return a / b if isinstance(op, ast.Div) else math.fmod(a, b)
    if isinstance(node, ast.Compare):
        a, b = _eval(node.left, scope), _eval(node.comparators[0], scope)
        return {ast.Eq: lambda: a == b, ast.NotEq: lambda: a != b, ast.Lt: lambda: a < b,
                ast.LtE: lambda: a <= b, ast.Gt: lambda: a > b,
                ast.GtE: lambda: a >= b}[type(node.ops[0])]()
    if isinstance(node, ast.Call):
        name = node.func.id  # type: ignore[attr-defined]
        if name == "cond":  # lazy, like a ternary
            test = _eval(node.args[0], scope)
            return _eval(node.args[1] if test else node.args[2], scope)
        args = [_eval(a, scope) for a in node.args]
        return _CALLS[name](*args)
    raise ExpressionError(f"{type(node).__name__} is not supported")


def _num(v: Any) -> float:
    if isinstance(v, bool) or not isinstance(v, (int, float)):
        raise ExpressionError(f"expected a number, got {v!r}")
    return v


def _js_round(x: float, digits: float = 0) -> float:
    f = 10 ** int(digits)
    return math.floor(_num(x) * f + 0.5) / f


_CALLS: dict[str, Any] = {
    "min": lambda *a: min(_num(x) for x in a), "max": lambda *a: max(_num(x) for x in a),
    "clamp": lambda x, lo, hi: min(max(_num(x), _num(lo)), _num(hi)),
    "round": _js_round, "floor": lambda x: math.floor(_num(x)),
    "ceil": lambda x: math.ceil(_num(x)), "abs": lambda x: abs(_num(x)),
    "sin": lambda x: math.sin(_num(x)), "cos": lambda x: math.cos(_num(x)),
    "sqrt": lambda x: math.sqrt(_num(x)), "pow": lambda a, b: math.pow(_num(a), _num(b)),
    "lerp": lambda a, b, t: _num(a) + (_num(b) - _num(a)) * _num(t),
}


def format_value(v: Any) -> str:
    """Write a value into SVG text like JavaScript's String(v)."""
    if isinstance(v, bool):
        return "true" if v else "false"
    if isinstance(v, float):
        if math.isnan(v):
            return "NaN"
        if math.isinf(v):
            return "Infinity" if v > 0 else "-Infinity"
        return str(int(v)) if v.is_integer() else repr(round(v, 10))
    return str(v)


# --- OKLCH color functions (the Python mirror of culori) -------------------------------------

def _parse_color(c: Any) -> tuple[float, float, float, float]:
    if not isinstance(c, str) or not re.match(r"^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$", c):
        raise ExpressionError(f"expected a hex color, got {c!r}")
    h = c[1:]
    if len(h) == 3:
        h = "".join(ch * 2 for ch in h)
    rgb = [int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    a = int(h[6:8], 16) / 255 if len(h) == 8 else 1.0
    return rgb[0], rgb[1], rgb[2], a


def _to_linear(v: float) -> float:
    return v / 12.92 if abs(v) <= 0.04045 else math.copysign(((abs(v) + 0.055) / 1.055) ** 2.4, v)


def _to_srgb(v: float) -> float:
    return 12.92 * v if abs(v) <= 0.0031308 else math.copysign(1.055 * abs(v) ** (1 / 2.4) - 0.055, v)


def _cbrt(x: float) -> float:
    return math.copysign(abs(x) ** (1 / 3), x)


def _rgb_to_oklab(r: float, g: float, b: float) -> tuple[float, float, float]:
    r, g, b = _to_linear(r), _to_linear(g), _to_linear(b)
    l_ = _cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b)
    m_ = _cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b)
    s_ = _cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b)
    return (0.2104542553 * l_ + 0.7936177850 * m_ - 0.0040720468 * s_,
            1.9779984951 * l_ - 2.4285922050 * m_ + 0.4505937099 * s_,
            0.0259040371 * l_ + 0.7827717662 * m_ - 0.8086757660 * s_)


def _oklab_to_rgb(L: float, a: float, b: float) -> tuple[float, float, float]:
    l_ = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3
    m_ = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3
    s_ = (L - 0.0894841775 * a - 1.2914855480 * b) ** 3
    return (_to_srgb(4.0767416621 * l_ - 3.3077115913 * m_ + 0.2309699292 * s_),
            _to_srgb(-1.2684380046 * l_ + 2.6097574011 * m_ - 0.3413193965 * s_),
            _to_srgb(-0.0041960863 * l_ - 0.7034186147 * m_ + 1.7076147010 * s_))


def _to_lch(c: Any) -> tuple[float, float, float, float]:
    r, g, b, alpha = _parse_color(c)
    L, A, B = _rgb_to_oklab(r, g, b)
    return L, math.hypot(A, B), math.degrees(math.atan2(B, A)) % 360, alpha


def _from_lch(L: float, C: float, H: float, alpha: float) -> str:
    """OKLCH → hex, reducing chroma until the color is inside sRGB."""
    L = min(max(L, 0.0), 1.0)

    def rgb(c: float) -> tuple[float, float, float]:
        return _oklab_to_rgb(L, c * math.cos(math.radians(H)), c * math.sin(math.radians(H)))

    def inside(c: float) -> bool:
        return all(-1e-6 <= v <= 1 + 1e-6 for v in rgb(c))

    C = max(C, 0.0)
    if not inside(C):
        lo, hi = 0.0, C
        for _ in range(30):
            mid = (lo + hi) / 2
            lo, hi = (mid, hi) if inside(mid) else (lo, mid)
        C = lo
    return _hex(*rgb(C), alpha)


def _hex(r: float, g: float, b: float, alpha: float = 1.0) -> str:
    def byte(v: float) -> str:
        return f"{int(math.floor(min(max(v, 0.0), 1.0) * 255 + 0.5)):02x}"

    return "#" + byte(r) + byte(g) + byte(b) + (byte(alpha) if alpha < 1 else "")


def _tone(c: Any, lightness: Any, chroma: Any = None) -> str:
    L, C, H, a = _to_lch(c)
    return _from_lch(_num(lightness), C if chroma is None else _num(chroma), H, a)


def _shade(c: Any, dl: Any) -> str:
    L, C, H, a = _to_lch(c)
    return _from_lch(L + _num(dl), C, H, a)


def _hue(c: Any, deg: Any) -> str:
    L, C, H, a = _to_lch(c)
    return _from_lch(L, C, (H + _num(deg)) % 360, a)


def _alpha(c: Any, a: Any) -> str:
    r, g, b, _ = _parse_color(c)
    return _hex(r, g, b, min(max(_num(a), 0.0), 1.0))


def _mix(c1: Any, c2: Any, t: Any) -> str:
    t = min(max(_num(t), 0.0), 1.0)
    r1, g1, b1, a1 = _parse_color(c1)
    r2, g2, b2, a2 = _parse_color(c2)
    p, q = _rgb_to_oklab(r1, g1, b1), _rgb_to_oklab(r2, g2, b2)
    L, A, B = (x + (y - x) * t for x, y in zip(p, q))
    C, H = math.hypot(A, B), math.degrees(math.atan2(B, A)) % 360
    return _from_lch(L, C, H, a1 + (a2 - a1) * t)


_CALLS.update(tone=_tone, shade=_shade, hue=_hue, alpha=_alpha, mix=_mix)


# --- the SVG file ----------------------------------------------------------------------------

@dataclass
class Design:
    id: str
    svg: str
    manifest: DesignManifest | None
    tree: ET.Element | None
    error: str | None = None


def _local(tag: Any) -> str:
    return tag.rsplit("}", 1)[-1] if isinstance(tag, str) else ""


def _metadata(root: ET.Element) -> ET.Element | None:
    return next((el for el in root.iter() if _local(el.tag) == "metadata"
                 and el.get("id") == "xds-design"), None)


def parse_design(design_id: str, text: str) -> Design:
    """Parse the SVG and its manifest. Errors land in `.error` (the DESIGN_INVALID message)."""
    try:
        root = ET.fromstring(text)
    except ET.ParseError as e:
        return Design(design_id, text, None, None, f"not well-formed SVG: {e}")
    if _local(root.tag) != "svg":
        return Design(design_id, text, None, root, "the root element must be <svg>")
    meta = _metadata(root)
    if meta is None:
        return Design(design_id, text, DesignManifest(), root, None)
    try:
        manifest = DesignManifest.model_validate(json.loads(meta.text or "{}"))
    except json.JSONDecodeError as e:
        return Design(design_id, text, None, root, f"manifest is not valid JSON: {e}")
    except ValidationError as e:
        first = e.errors(include_url=False)[0]
        where = ".".join(str(x) for x in first["loc"])
        return Design(design_id, text, None, root, f"manifest {where}: {first['msg']}")
    problem = _manifest_problem(manifest)
    return Design(design_id, text, None if problem else manifest, root, problem)


def _manifest_problem(m: DesignManifest) -> str | None:
    names = [p.name for p in m.params]
    if dupes := sorted({n for n in names if names.count(n) > 1}):
        return f"duplicate param names: {', '.join(dupes)}"
    if clash := sorted(set(names) & RESERVED):
        return f"param names clash with built-in names: {', '.join(clash)}"
    for p in m.params:
        if p.type == "select" and not p.options:
            return f"select param '{p.name}' needs options"
    variants = [v.name for v in m.variants or []]
    if dupes := sorted({n for n in variants if variants.count(n) > 1}):
        return f"duplicate variant names: {', '.join(dupes)}"
    return None


def read(root: Path, design_id: str) -> Design:
    path = root / "designs" / f"{design_id}.svg"
    return parse_design(design_id, path.read_text(encoding="utf-8"))


def load_all(root: Path) -> dict[str, dict[str, Any]]:
    """Every design in `designs/`, as the API's `DesignInfo`: `{ id, svg, manifest, error? }`."""
    out: dict[str, dict[str, Any]] = {}
    base = root / "designs"
    for path in sorted(base.glob("*.svg")) if base.is_dir() else []:
        d = parse_design(path.stem, path.read_text(encoding="utf-8"))
        info: dict[str, Any] = {
            "id": d.id, "svg": d.svg,
            "manifest": d.manifest.model_dump(mode="json", by_alias=True, exclude_none=True)
            if d.manifest else None,
        }
        if d.error:
            info["error"] = d.error
        out[d.id] = info
    return out


# --- placeholders and loops ------------------------------------------------------------------

@dataclass
class Placeholder:
    expr: str
    where: str  # "<rect fill>" / "<text> text"
    loop_names: frozenset[str]


def _texts(el: ET.Element) -> Iterator[tuple[str, str]]:
    for k, v in el.attrib.items():
        if _local(k) not in ("data-xds-repeat", "data-xds-count"):
            yield f"<{_local(el.tag)} {_local(k)}>", v
    if el.text:
        yield f"<{_local(el.tag)}> text", el.text


def placeholders(tree: ET.Element) -> tuple[list[Placeholder], list[str]]:
    """All placeholders with the loop variables in scope, plus loop-syntax problems."""
    found: list[Placeholder] = []
    problems: list[str] = []

    def walk(el: ET.Element, loops: frozenset[str]) -> None:
        if el is not tree and _local(el.tag) == "metadata" and el.get("id") == "xds-design":
            return
        var, count = el.get("data-xds-repeat"), el.get("data-xds-count")
        inner = loops
        if var is not None or count is not None:
            tag = _local(el.tag)
            if var is None or count is None:
                problems.append(f"<{tag}> needs both data-xds-repeat and data-xds-count")
            else:
                if not re.match(r"^[A-Za-z_][A-Za-z0-9_]*$", var) or var in RESERVED:
                    problems.append(f"<{tag}> data-xds-repeat='{var}' must be a new identifier")
                m = PLACEHOLDER.fullmatch(count.strip())
                if not m:
                    problems.append(f"<{tag}> data-xds-count must be one {{{{ expression }}}}")
                else:
                    found.append(Placeholder(m.group(1), f"<{tag} data-xds-count>", loops))
                inner = loops | {var, "n"}
        for where, text in _texts(el):
            for m in PLACEHOLDER.finditer(text):
                found.append(Placeholder(m.group(1), where, inner))
        for child in el:
            walk(child, inner)
            if child.tail:
                for m in PLACEHOLDER.finditer(child.tail):
                    found.append(Placeholder(m.group(1), f"<{_local(el.tag)}> text", inner))

    walk(tree, frozenset())
    return found, problems


# --- values ----------------------------------------------------------------------------------

def value_problem(param: DesignParam, value: Any, brand_tokens: set[str] | None) -> str | None:
    """Why `value` doesn't fit `param`, or None. `brand_tokens=None` skips the token check."""
    t = param.type
    if t == "number":
        if isinstance(value, bool) or not isinstance(value, (int, float)):
            return f"'{param.name}' takes a number, got {value!r}"
        if param.min is not None and value < param.min:
            return f"'{param.name}' = {value} is below its minimum {param.min}"
        if param.max is not None and value > param.max:
            return f"'{param.name}' = {value} is above its maximum {param.max}"
    elif t == "boolean":
        if not isinstance(value, bool):
            return f"'{param.name}' takes true or false, got {value!r}"
    elif t == "select":
        if value not in (param.options or []):
            return f"'{param.name}' must be one of {param.options}, got {value!r}"
    elif t == "color":
        if not isinstance(value, str):
            return f"'{param.name}' takes a hex color or a brand color name, got {value!r}"
        if not HEX.match(value) and brand_tokens is not None and value not in brand_tokens:
            return (f"'{param.name}' = {value!r} is neither #rrggbb nor a brand color "
                    f"({', '.join(sorted(brand_tokens))})")
    elif t == "text":
        if not isinstance(value, str):
            return f"'{param.name}' takes text, got {value!r}"
    return None


def manifest_findings(d: Design, brand_tokens: set[str] | None) -> list[tuple[str, str]]:
    """Problems inside one design file, as `(code, message)` pairs."""
    if d.error or d.manifest is None or d.tree is None:
        return [("DESIGN_INVALID", d.error or "unreadable design")]
    m = d.manifest
    params = {p.name: p for p in m.params}
    out: list[tuple[str, str]] = []
    for p in m.params:
        if problem := value_problem(p, p.default, brand_tokens):
            out.append(("DESIGN_VALUE_TYPE", f"default of {problem}"))
    for v in m.variants or []:
        for k, val in v.values.items():
            if k not in params:
                out.append(("DESIGN_UNKNOWN_PARAM", f"variant '{v.name}' sets unknown param '{k}'"))
            elif problem := value_problem(params[k], val, brand_tokens):
                out.append(("DESIGN_VALUE_TYPE", f"variant '{v.name}': {problem}"))
    found, loop_problems = placeholders(d.tree)
    out += [("DESIGN_BAD_EXPRESSION", p) for p in loop_problems]
    known = (base_names(brand_tokens) if brand_tokens is not None else base_names()) | set(params)
    for ph in found:
        names = known | ph.loop_names
        if brand_tokens is None:  # no project: accept any brand.<token>
            names = names | {n for n in _safe_names(ph.expr) if n.startswith("brand.")}
        if problem := check_expression(ph.expr, names):
            out.append((problem[0], f"{ph.where}: {problem[1]}"))
    return out


def _safe_names(expr: str) -> list[str]:
    try:
        return names_in(parse(expr))
    except ExpressionError:
        return []


# --- the gate --------------------------------------------------------------------------------

def _finding(rule: str, path: str, message: str, *, nodes: list[str], slide_id: str | None,
             fix: str = "") -> Finding:
    return Finding(rule=rule, family="check", severity="error", path=path, message=message,
                   fix=fix, nodes=nodes, slide_id=slide_id)


_FIXES = {
    "DESIGN_INVALID": "Fix the JSON in <metadata id=\"xds-design\"> (see docs/data-models.md §4).",
    "DESIGN_UNKNOWN_PARAM": "Declare the param in the manifest, or use a known name "
                            "(width, height, subject.*, brand.<token>).",
    "DESIGN_BAD_EXPRESSION": "Use the expression language of lighting-and-backgrounds §3.3.",
    "DESIGN_VALUE_TYPE": "Give a value of the param's type within its min/max.",
}


def check(root: Path, project: Project,
          used: dict[str, list[tuple[str, GroundNode, str]]]) -> list[Finding]:
    """Check every design a ground node uses, and every node's `variant` and `values`.

    `used` maps a design id to `(json path, node, slide id)` for each ground node using it.
    Missing files are UNKNOWN_DESIGN, reported by project.check_references.
    """
    tokens = {c.name for c in project.brand.colors}
    out: list[Finding] = []
    for design_id, uses in sorted(used.items()):
        path = root / "designs" / f"{design_id}.svg"
        if not path.exists():
            continue
        d = read(root, design_id)
        node_ids = [n.id for _, n, _ in uses]
        first_slide = uses[0][2] if uses else None
        for code, msg in manifest_findings(d, tokens):
            out.append(_finding(code, f"designs/{design_id}.svg", f"designs/{design_id}.svg {msg}",
                                nodes=node_ids, slide_id=first_slide, fix=_FIXES[code]))
        if d.manifest is not None:
            for json_path, node, slide_id in uses:
                out += _node_findings(d, node, json_path, slide_id, tokens)
    return out


def _node_findings(d: Design, node: GroundNode, json_path: str, slide_id: str,
                   tokens: set[str]) -> list[Finding]:
    assert d.manifest is not None
    params = {p.name: p for p in d.manifest.params}
    variants = {v.name for v in d.manifest.variants or []}
    kw: dict[str, Any] = {"nodes": [node.id], "slide_id": slide_id}
    out: list[Finding] = []
    if node.data.variant is not None and node.data.variant not in variants:
        out.append(_finding(
            "DESIGN_UNKNOWN_PARAM", f"{json_path}.data.variant",
            f"Design '{d.id}' has no variant '{node.data.variant}'.",
            fix=f"Use one of: {', '.join(sorted(variants)) or '(none declared)'}.", **kw))
    for key, value in (node.data.values or {}).items():
        vp = f"{json_path}.data.values.{key}"
        if key not in params:
            out.append(_finding("DESIGN_UNKNOWN_PARAM", vp,
                                f"Design '{d.id}' has no param '{key}'.",
                                fix=f"Params: {', '.join(params) or '(none)'}.", **kw))
        elif problem := value_problem(params[key], value, tokens):
            out.append(_finding("DESIGN_VALUE_TYPE", vp, problem, fix=_FIXES["DESIGN_VALUE_TYPE"],
                                **kw))
    return out


# --- starters --------------------------------------------------------------------------------

def starters() -> list[str]:
    return sorted(p.stem for p in STARTERS_DIR.glob("*.svg"))


def add_starter(root: Path, name: str) -> str:
    """Copy starter `name` into `designs/`. Returns the new design id (`name`, or `name-2`, …)."""
    from .project import XdsError

    src = STARTERS_DIR / f"{name}.svg"
    if not src.exists():
        raise XdsError("UNKNOWN_STARTER", f"No starter design '{name}'.", status=404,
                       details={"starters": starters()})
    (root / "designs").mkdir(exist_ok=True)
    design_id, k = name, 2
    while (root / "designs" / f"{design_id}.svg").exists():
        design_id, k = f"{name}-{k}", k + 1
    shutil.copyfile(src, root / "designs" / f"{design_id}.svg")
    return design_id


# --- resolving (preview; the browser's resolve.ts is the real renderer) ----------------------

def default_context(width: float, height: float, subject: dict[str, float] | None = None,
                    brand: dict[str, str] | None = None) -> dict[str, Any]:
    """The flat scope for a canvas; `subject` falls back to the centered default (§3.2)."""
    s = subject or {"x": width * 0.3, "y": height * 0.3, "w": width * 0.4, "h": height * 0.4,
                    "cx": width / 2, "cy": height / 2, "floor": height * 0.7}
    scope: dict[str, Any] = {"width": width, "height": height}
    scope.update({f"subject.{k}": s[k] for k in SUBJECT_KEYS})
    scope.update({f"brand.{k}": v for k, v in (brand or {}).items()})
    return scope


def effective_values(manifest: DesignManifest, variant: str | None = None,
                     values: dict[str, Any] | None = None,
                     brand: dict[str, str] | None = None) -> dict[str, Any]:
    """defaults ← variant ← node values, with color token names replaced by their hex."""
    out = {p.name: p.default for p in manifest.params}
    for v in manifest.variants or []:
        if v.name == variant:
            out.update(v.values)
    out.update(values or {})
    for p in manifest.params:
        if p.type == "color" and isinstance(out[p.name], str) and not HEX.match(out[p.name]):
            out[p.name] = (brand or {}).get(out[p.name], out[p.name])
    return out


def resolve(svg_text: str, scope: dict[str, Any]) -> str:
    """Expand loops and placeholders. `scope` = default_context(...) | effective_values(...)."""
    ET.register_namespace("", SVG_NS)
    ET.register_namespace("xlink", "http://www.w3.org/1999/xlink")
    tree = ET.fromstring(svg_text)
    _resolve_children(tree, scope)
    _subst_element(tree, scope)
    return ET.tostring(tree, encoding="unicode")


def _subst(text: str, scope: dict[str, Any]) -> str:
    m = PLACEHOLDER.fullmatch(text.strip())
    if m:
        return format_value(evaluate(m.group(1), scope))
    return PLACEHOLDER.sub(lambda mm: format_value(evaluate(mm.group(1), scope)), text)


def _subst_element(el: ET.Element, scope: dict[str, Any]) -> None:
    if _local(el.tag) == "metadata":
        return
    for k, v in list(el.attrib.items()):
        el.set(k, _subst(v, scope))
    if el.text:
        el.text = _subst(el.text, scope)


def _resolve_children(parent: ET.Element, scope: dict[str, Any]) -> None:
    for idx, child in reversed(list(enumerate(parent))):
        if child.tail:
            child.tail = _subst(child.tail, scope)
        if _local(child.tag) == "metadata":
            continue
        var = child.get("data-xds-repeat")
        if var is None:
            _subst_element(child, scope)
            _resolve_children(child, scope)
            continue
        count = int(min(max(math.floor(_num(evaluate(
            PLACEHOLDER.fullmatch(child.get("data-xds-count", "").strip()).group(1),  # type: ignore[union-attr]
            scope))), 0), MAX_REPEAT))
        parent.remove(child)
        for i in reversed(range(count)):
            copy = ET.fromstring(ET.tostring(child))
            copy.attrib.pop("data-xds-repeat", None)
            copy.attrib.pop("data-xds-count", None)
            inner = {**scope, var: i, "n": count}
            _subst_element(copy, inner)
            _resolve_children(copy, inner)
            copy.tail = child.tail
            parent.insert(idx, copy)
